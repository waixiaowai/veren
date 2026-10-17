/**
 * flow 引擎单测：编译期错误、输入映射、mock、重试、超时、onError 策略、
 * 运行清单与运行详情。
 * Flow engine unit tests: compile-time errors, input mapping, mocks, retry,
 * timeout, onError policies, the run list and run details.
 */

import { describe, expect, it } from 'vitest';
import z from '@deepseek-ai/schemastery';
import type { FlowDefinition, NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import { FlowEngineService, flowError, FlowError } from '../src/index.js';
import { flakyHandler, makeEngine, sleep } from './helpers.js';

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

    it('rejects errorBranch without a declared error port', async () => {
        const { engine } = makeEngine();
        await expect(engine.registerFlow({
            id: 'bad-error-branch',
            nodes: [{ id: 'gate', type: 'fail', onError: 'errorBranch' }, { id: 'normal', type: 'noop' }],
            edges: [{ from: 'gate', to: 'normal' }],
        })).rejects.toMatchObject({ code: 'NODE_CONFIG_INVALID' });
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
        // A 引用 B：此时 B 未注册，先成功 / A references B: B is unknown yet, so it succeeds
        await engine.registerFlow({ id: 'fa', nodes: [{ id: 's', type: 'subflow', config: { flow: 'fb' } }], edges: [] });
        // B 引用 A：形成互引用环 / B references A: a mutual reference cycle
        await expect(engine.registerFlow({ id: 'fb', nodes: [{ id: 's', type: 'subflow', config: { flow: 'fa' } }], edges: [] }))
            .rejects.toMatchObject({ code: 'FLOW_REFERENCE_CYCLE' });
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
        registry.register(flakyHandler(attempts, 2));
        await engine.registerFlow({
            id: 'retrying',
            nodes: [{ id: 'a', type: 'flaky', retry: { tries: 3, backoffMs: 1 } }],
            edges: [],
        });
        const result = await engine.run('retrying').awaitCompletion();
        expect(result.status).toBe('completed');
        // 尝试序号来自 nctx.attempt / the attempt numbers come from nctx.attempt
        expect(attempts).toEqual([1, 2, 3]);
        expect(result.nodes['a']!.output).toEqual({ attempt: 3 });
    });

    it('stops retrying at the configured tries upper bound', async () => {
        const { engine, registry } = makeEngine();
        const attempts: number[] = [];
        // failTimes = Number.MAX_SAFE_INTEGER → 每次尝试都失败 /
        // failTimes = Number.MAX_SAFE_INTEGER → every attempt fails
        registry.register(flakyHandler(attempts, Number.MAX_SAFE_INTEGER));
        await engine.registerFlow({
            id: 'bounded',
            nodes: [{ id: 'a', type: 'flaky', retry: { tries: 2 } }],
            edges: [],
        });
        const result = await engine.run('bounded').awaitCompletion();
        expect(result.status).toBe('failed');
        expect(attempts).toEqual([1, 2]);
        expect(result.nodes['a']!.error!.code).toBe('NODE_FAILED');
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

describe('flow list and run detail', () => {
    it('lists registered flows sorted by id with their shape', async () => {
        const { engine } = makeEngine();
        await engine.registerFlow({ id: 'zeta', nodes: [{ id: 'a', type: 'noop' }], edges: [] });
        await engine.registerFlow({
            id: 'alpha',
            nodes: [{ id: 'a', type: 'echo', config: { message: 'hi' } }, { id: 'b', type: 'noop' }],
            edges: [{ from: 'a', to: 'b' }],
            output: { said: '${a.message}' },
        });
        expect(engine.listFlows()).toEqual([
            { id: 'alpha', nodes: 2, edges: 1, outputs: ['said'] },
            { id: 'zeta', nodes: 1, edges: 0, outputs: [] },
        ]);
        await engine.unregisterFlow('alpha');
        expect(engine.listFlows().map((flow) => flow.id)).toEqual(['zeta']);
    });

    it('reports one run by id: status while running, result once finished', async () => {
        const { engine, registry } = makeEngine();
        registry.register({
            type: 'hold',
            version: 1,
            config: z.object({}) as NodeHandler['config'],
            execute: (_input, nctx) => new Promise((resolve) => {
                nctx.signal.addEventListener('abort', () => resolve('done'), { once: true });
            }),
        });
        await engine.registerFlow({ id: 'tracked', nodes: [{ id: 'a', type: 'hold' }], edges: [], output: { out: '${a.out}' } });
        expect(engine.getRun('unknown-run' as never)).toBeUndefined();
        const handle = engine.run('tracked');
        const live = engine.getRun(handle.runId)!;
        expect(live).toMatchObject({ flowId: 'tracked', runId: handle.runId, status: 'running' });
        expect(live.result).toBeUndefined();
        handle.cancel();
        await handle.awaitCompletion();
        const done = engine.getRun(handle.runId)!;
        expect(done.status).toBe('cancelled');
        expect(done.result?.runId).toBe(handle.runId);
    });
});
