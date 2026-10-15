/**
 * flow 引擎单测：编译期错误、输入映射、mock、重试、超时、onError 策略、
 * subflow 与 flow 事件。每个用例自建 Context，保证并发安全。
 *
 * Flow engine unit tests: compile-time errors, input mapping, mocks, retry,
 * timeout, onError policies, subflow and flow events. Every case builds its
 * own Context so specs stay concurrency-safe.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { GraphKernelService } from '@veren/graph-core';
import type { FlowDefinition, NodeHandler } from '@veren/graph-flow-api';
import { FlowEngineService, flowError, FlowError } from '../src/index.js';
import { NodeRegistryImpl } from '../src/registry.js';

/** 构建"内核 + 注册表 + 引擎"的最小组合 / build a minimal kernel + registry + engine stack */
function makeEngine(config: { nodeTimeoutMs?: number } = {}) {
    const ctx = new Context();
    const kernel = new GraphKernelService(ctx);
    const registry = new NodeRegistryImpl();
    const engine = new FlowEngineService(ctx, { nodeTimeoutMs: config.nodeTimeoutMs ?? 5000 }, kernel, registry);
    return { ctx, kernel, registry, engine };
}

/** 计数失败 handler：前 failTimes 次抛错 / a handler failing the first N attempts */
const flakyHandler = (attempts: number[]): NodeHandler => ({
    type: 'flaky',
    version: 1,
    config: z.object({}) as NodeHandler['config'],
    execute: () => {
        attempts.push(1);
        if (attempts.length < 3) throw new Error('flaky');
        return { attempt: attempts.length };
    },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('compile-time validation', () => {
    it('rejects unknown node types with NODE_TYPE_NOT_FOUND', async () => {
        const { engine } = makeEngine();
        const def: FlowDefinition = { id: 'f', nodes: [{ id: 'a', type: 'ghost' }], edges: [] };
        await expect(engine.registerFlow(def)).rejects.toMatchObject({ code: 'NODE_TYPE_NOT_FOUND' });
    });

    it('rejects invalid node configs with NODE_CONFIG_INVALID', async () => {
        const { engine, registry } = makeEngine();
        registry.register({
            type: 'strict',
            version: 1,
            config: z.object({ count: z.number() }),
            execute: () => ({}),
        });
        const def: FlowDefinition = {
            id: 'f',
            nodes: [{ id: 'a', type: 'strict', config: { count: 'NaN' } }],
            edges: [],
        };
        await expect(engine.registerFlow(def)).rejects.toMatchObject({ code: 'NODE_CONFIG_INVALID' });
    });

    it('detects graph cycles as FLOW_CYCLE_DETECTED and dangling edges loudly', async () => {
        const { engine, registry } = makeEngine();
        registry.register({
            type: 'noop',
            version: 1,
            config: z.object({}) as NodeHandler['config'],
            execute: (input) => input,
        });
        await expect(
            engine.registerFlow({
                id: 'cyc',
                nodes: [
                    { id: 'a', type: 'noop' },
                    { id: 'b', type: 'noop' },
                ],
                edges: [
                    { from: 'a', to: 'b' },
                    { from: 'b', to: 'a' },
                ],
            }),
        ).rejects.toMatchObject({ code: 'FLOW_CYCLE_DETECTED' });
        await expect(
            engine.registerFlow({
                id: 'dangling',
                nodes: [{ id: 'a', type: 'noop' }],
                edges: [{ from: 'a', to: 'ghost' }],
            }),
        ).rejects.toMatchObject({ code: 'GRAPH_DANGLING_EDGE' });
    });

    it('reports mutual subflow references as FLOW_REFERENCE_CYCLE', async () => {
        const { engine } = makeEngine();
        const sub = (flow: string): FlowDefinition => ({
            id: flow as FlowDefinition['id'],
            nodes: [{ id: 's', type: 'subflow', config: { flow } }],
            edges: [],
        });
        // A 引用 B：此时 B 未注册，先成功 / A references B: B is unknown yet, so it succeeds
        await engine.registerFlow({ id: 'fa', nodes: [{ id: 's', type: 'subflow', config: { flow: 'fb' } }], edges: [] });
        // B 引用 A：形成互引用环 / B references A: a mutual reference cycle
        await expect(engine.registerFlow({ id: 'fb', nodes: [{ id: 's', type: 'subflow', config: { flow: 'fa' } }], edges: [] }))
            .rejects.toMatchObject({ code: 'FLOW_REFERENCE_CYCLE' });
        void sub;
    });
});

describe('runs', () => {
    it('resolves explicit input mappings and output variables through the blackboard', async () => {
        const { engine } = makeEngine();
        await engine.registerFlow({
            id: 'pipeline',
            nodes: [
                { id: 'source', type: 'echo', config: { message: 'hello' } },
                { id: 'sink', type: 'noop', input: { said: '${source.message}' } },
            ],
            edges: [{ from: 'source', to: 'sink' }],
            output: { said: '${sink.said}' },
        });
        const result = await engine.run('pipeline').awaitCompletion();
        expect(result.status).toBe('completed');
        // noop 透传其输入 / noop passes its input through
        expect(result.nodes['sink']!.output).toEqual({ said: 'hello' });
        expect(result.output['said']).toEqual('hello');
    });

    it('mocks skip execution and produce pinned values', async () => {
        const { engine, registry } = makeEngine();
        const attempts: number[] = [];
        registry.register(flakyHandler(attempts));
        await engine.registerFlow({
            id: 'mocked',
            nodes: [{ id: 'a', type: 'flaky' }, { id: 'b', type: 'echo', config: { message: 'ran' } }],
            edges: [{ from: 'a', to: 'b' }],
        });
        const result = await engine.run('mocked', { mocks: { a: { attempt: 99 } } }).awaitCompletion();
        expect(result.nodes['a']!.output).toEqual({ attempt: 99 });
        // 下游仍按依赖执行，读到 mock 产出 / downstream still runs and reads the mocked output
        expect(result.nodes['b']!.output).toEqual({ out: {}, message: 'ran' });
        expect(attempts.length).toBe(0);
    });

    it('retries failures until success within the try budget', async () => {
        const { engine, registry } = makeEngine();
        const attempts: number[] = [];
        registry.register(flakyHandler(attempts));
        await engine.registerFlow({
            id: 'retrying',
            nodes: [{ id: 'a', type: 'flaky', retry: { tries: 3, backoffMs: 1 } }],
            edges: [],
        });
        const result = await engine.run('retrying').awaitCompletion();
        expect(result.status).toBe('completed');
        expect(attempts.length).toBe(3);
        expect(result.nodes['a']!.output).toEqual({ attempt: 3 });
    });

    it('times nodes out with NODE_TIMEOUT', async () => {
        const { engine, registry } = makeEngine({ nodeTimeoutMs: 20 });
        registry.register({
            type: 'sleepy',
            version: 1,
            config: z.object({}) as NodeHandler['config'],
            execute: () => sleep(500),
        });
        await engine.registerFlow({ id: 'slow', nodes: [{ id: 'a', type: 'sleepy' }], edges: [] });
        const result = await engine.run('slow').awaitCompletion();
        expect(result.status).toBe('failed');
        expect(result.nodes['a']!.error!.code).toBe('NODE_TIMEOUT');
        expect(result.error!.code).toBe('NODE_TIMEOUT');
    });

    it('onError fallback keeps the flow running with the declarative value', async () => {
        const { engine } = makeEngine();
        await engine.registerFlow({
            id: 'fallback',
            nodes: [
                { id: 'bad', type: 'fail', onError: 'fallback', fallbackValue: { message: 'safe' } },
                { id: 'next', type: 'noop', input: { got: '${bad.message}' } },
            ],
            edges: [{ from: 'bad', to: 'next' }],
        });
        const result = await engine.run('fallback').awaitCompletion();
        expect(result.status).toBe('completed');
        expect(result.nodes['bad']!.status).toBe('completed');
        expect(result.nodes['next']!.output).toEqual({ got: 'safe' });
    });

    it('onError errorBranch routes failures along the error port only', async () => {
        const { engine } = makeEngine();
        await engine.registerFlow({
            id: 'errorbranch',
            nodes: [
                { id: 'gate', type: 'fail', onError: 'errorBranch' },
                { id: 'recover', type: 'noop', input: { cause: '${gate.error}' } },
                { id: 'normal', type: 'echo' },
            ],
            edges: [
                { from: 'gate', to: 'recover', port: 'error' },
                { from: 'gate', to: 'normal' },
            ],
        });
        const result = await engine.run('errorbranch').awaitCompletion();
        expect(result.status).toBe('completed');
        expect(result.nodes['recover']!.status).toBe('completed');
        expect(result.nodes['recover']!.output).toEqual({ cause: { code: 'NODE_FAILED', message: 'node failed' } });
        expect(result.nodes['normal']!.status).toBe('skipped');
        expect(result.nodes['normal']!.skipReason).toBe('upstream-condition');
    });

    it('keeps the error port inactive when the node does not fail', async () => {
        const { engine } = makeEngine();
        await engine.registerFlow({
            id: 'healthy',
            nodes: [
                { id: 'gate', type: 'echo', onError: 'errorBranch' },
                { id: 'recover', type: 'noop' },
                { id: 'normal', type: 'noop', input: { said: '${gate.message}' } },
            ],
            edges: [
                { from: 'gate', to: 'recover', port: 'error' },
                { from: 'gate', to: 'normal' },
            ],
        });
        const result = await engine.run('healthy').awaitCompletion();
        expect(result.status).toBe('completed');
        expect(result.nodes['recover']!.status).toBe('skipped');
        expect(result.nodes['normal']!.status).toBe('completed');
        expect(result.nodes['normal']!.output).toEqual({ said: 'echo' });
    });
});

describe('subflow and events', () => {
    it('runs a referenced flow as a subflow node', async () => {
        const { engine } = makeEngine();
        await engine.registerFlow({
            id: 'child',
            nodes: [{ id: 'e', type: 'echo', config: { message: 'from-child' } }],
            edges: [],
            output: { said: '${e.message}' },
        });
        await engine.registerFlow({
            id: 'parent',
            nodes: [{ id: 'sub', type: 'subflow', config: { flow: 'child' } }],
            edges: [],
            output: { result: '${sub.out}' },
        });
        const result = await engine.run('parent').awaitCompletion();
        expect(result.status).toBe('completed');
        expect(result.output['result']).toMatchObject({ status: 'completed', output: { said: 'from-child' } });
    });

    it('flow/run-starting can refuse the run', async () => {
        const { ctx, engine } = makeEngine();
        ctx.on('flow/run-starting', () => true);
        await engine.registerFlow({ id: 'blocked', nodes: [{ id: 'a', type: 'echo' }], edges: [] });
        const result = await engine.run('blocked').awaitCompletion();
        expect(result.status).toBe('cancelled');
        expect(result.nodes['a']!.skipReason).toBe('run-rejected');
    });

    it('flow/run-end carries the blackboard snapshot', async () => {
        const { ctx, engine } = makeEngine();
        const ends: unknown[] = [];
        ctx.on('flow/run-end', (payload) => ends.push(payload));
        await engine.registerFlow({
            id: 'snapshot',
            nodes: [{ id: 'e', type: 'echo', config: { message: 'snap' } }],
            edges: [],
        });
        await engine.run('snapshot').awaitCompletion();
        expect(ends.length).toBe(1);
        expect(ends[0]).toMatchObject({ flowId: 'snapshot', status: 'completed', blackboard: { 'e.message': 'snap' } });
    });

    it('tracks run handles: status, cancel and listRuns', async () => {
        const { engine, registry } = makeEngine();
        registry.register({
            type: 'hold',
            version: 1,
            config: z.object({}) as NodeHandler['config'],
            execute: (_input, nctx) =>
                new Promise((resolve) => {
                    nctx.signal.addEventListener('abort', () => resolve('done'), { once: true });
                }),
        });
        await engine.registerFlow({
            id: 'cancellable',
            nodes: [{ id: 'a', type: 'hold' }, { id: 'b', type: 'noop' }],
            edges: [{ from: 'a', to: 'b' }],
        });
        const handle = engine.run('cancellable');
        expect(handle.status()).toBe('running');
        handle.cancel();
        const result = await handle.awaitCompletion();
        expect(handle.status()).toBe('cancelled');
        expect(result.status).toBe('cancelled');
        expect(engine.listRuns().length).toBe(1);
        expect(engine.listRuns()[0]!.status).toBe('cancelled');
    });

    it('rejects runs of unregistered flows with FLOW_NOT_FOUND', () => {
        const { engine } = makeEngine();
        expect(() => engine.run('nope')).toThrowError(expect.objectContaining({ code: 'FLOW_NOT_FOUND' }));
        expect(flowError('FLOW_NOT_FOUND', 'x')).toBeInstanceOf(FlowError);
    });
});
