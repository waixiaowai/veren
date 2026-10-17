/**
 * subflow 组合测试：普通引用、并行引用同一子 flow、fail-fast 下运行中的
 * subflow 兄弟（含两层嵌套），以及 flow 事件。
 * 每个用例自建 Context，保证并发安全。
 *
 * Subflow composition tests: a plain reference, parallel references to the
 * same child flow, a running subflow sibling under fail-fast (including two
 * nested levels), and flow events. Every case builds its own Context.
 */

import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { NodeHandler, RunId } from '@deepseek-ai/dsh-graph-flow-api';
import { flowError, FlowError } from '../src/index.js';
import { gate, makeEngine, slowFailHandler, slowHandler } from './helpers.js';

/** 一次 flow/run-end 的摘要 / a summary of one flow/run-end */
interface FlowEnd {
    flowId: string;
    runId: string;
    status: string;
}

describe('subflow composition', () => {
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

    it('runs two parallel subflow nodes that reference the same child flow', async () => {
        const { engine } = makeEngine();
        await engine.registerFlow({
            id: 'shared-child',
            nodes: [{ id: 'e', type: 'echo', config: { message: 'child' } }],
            edges: [],
            output: { said: '${e.message}' },
        });
        await engine.registerFlow({
            id: 'fanout',
            nodes: [
                { id: 'left', type: 'subflow', config: { flow: 'shared-child' } },
                { id: 'right', type: 'subflow', config: { flow: 'shared-child' } },
            ],
            edges: [],
            output: { l: '${left.out}', r: '${right.out}' },
        });
        const result = await engine.run('fanout').awaitCompletion();
        expect(result.status).toBe('completed');
        // 同一子 flow 的并行引用不是递归，不能被误判为 FLOW_REFERENCE_CYCLE
        // Parallel references to the same child flow are not recursion and must not be misreported as FLOW_REFERENCE_CYCLE.
        expect(result.nodes['left']!.status).toBe('completed');
        expect(result.nodes['right']!.status).toBe('completed');
        expect(result.output['l']).toMatchObject({ status: 'completed', output: { said: 'child' } });
        expect(result.output['r']).toMatchObject({ status: 'completed', output: { said: 'child' } });
    });
});

describe('fail-fast and a running subflow sibling', () => {
    /** 记录父 flow 的精确事件序列和所有子 flow 的结束状态 / record exact parent events and every child end */
    function record(ctx: Context, parentId: string) {
        const parentEvents: string[] = [];
        const allNodeErrors: string[] = [];
        const childEnds: FlowEnd[] = [];
        ctx.on('flow/run-start', (payload) => {
            if (payload.flowId === parentId) parentEvents.push('flow-start');
        });
        ctx.on('graph/run-start', (meta) => {
            if (meta.graphId === parentId) parentEvents.push('start');
        });
        ctx.on('graph/node-error', (error) => {
            allNodeErrors.push(`error:${error.nodeId}`);
            if (error.graphId === parentId) parentEvents.push(`error:${error.nodeId}`);
        });
        ctx.on('graph/run-end', (payload) => {
            if (payload.graphId === parentId) parentEvents.push(`end:${payload.status}`);
        });
        ctx.on('flow/run-end', (payload) => {
            if (payload.flowId === parentId) parentEvents.push(`flow-end:${payload.status}`);
            else childEnds.push({ flowId: payload.flowId, runId: payload.runId, status: payload.status });
        });
        return { parentEvents, allNodeErrors, childEnds };
    }

    it('does not cancel the child run when fail-fast aborts the parent signal', async () => {
        const { ctx, engine, registry } = makeEngine();
        registry.register(slowHandler);
        registry.register(slowFailHandler);
        const recorded = record(ctx, 'parent-sub');
        await engine.registerFlow({
            id: 'slow-child',
            nodes: [{ id: 'slow', type: 'slow' }],
            edges: [],
            output: { done: '${slow.done}' },
        });
        await engine.registerFlow({
            id: 'parent-sub',
            nodes: [
                { id: 'bad', type: 'slowFail' },
                { id: 'sub', type: 'subflow', config: { flow: 'slow-child' } },
                { id: 'join', type: 'noop' },
            ],
            edges: [
                { from: 'bad', to: 'join' },
                { from: 'sub', to: 'join' },
            ],
            output: { child: '${sub.out}' },
        });
        const startedAt = Date.now();
        const result = await engine.run('parent-sub').awaitCompletion();
        const elapsed = Date.now() - startedAt;
        expect(result.status).toBe('failed');
        expect(result.nodes['bad']!.status).toBe('failed');
        // 兄弟 subflow 自然跑完：节点 completed、子 flow completed、无 node-error:sub
        // The subflow sibling finishes naturally: node completed, child run completed, no node-error:sub.
        expect(result.nodes['sub']!.status).toBe('completed');
        expect(result.nodes['sub']!.error).toBeUndefined();
        expect(result.nodes['join']!.status).toBe('skipped');
        expect(result.nodes['join']!.skipReason).toBe('upstream-failure');
        expect(recorded.parentEvents).toEqual(['flow-start', 'start', 'error:bad', 'end:failed', 'flow-end:failed']);
        expect(recorded.allNodeErrors).toEqual(['error:bad']);
        expect(recorded.childEnds).toHaveLength(1);
        expect(recorded.childEnds[0]).toMatchObject({ flowId: 'slow-child', status: 'completed' });
        const child = engine.getRun(recorded.childEnds[0]!.runId as RunId)!;
        expect(child.status).toBe('completed');
        // 子 flow 内部节点不被记 cancelled / no child node is recorded as cancelled
        expect(child.result!.nodes['slow']!.status).toBe('completed');
        // subflow 节点的产出照常携带子运行结果 / the subflow node output carries the child result
        expect(result.nodes['sub']!.output).toMatchObject({ out: { status: 'completed', output: { done: true } } });
        // 等子 flow 的慢任务跑完（不是 abort 立即返回）/ waits for the child's slow task (not aborted immediately)
        expect(elapsed).toBeGreaterThanOrEqual(70);
    });

    it('keeps two nested subflow levels running under a fail-fast parent', async () => {
        const { ctx, engine, registry } = makeEngine();
        registry.register(slowHandler);
        registry.register(slowFailHandler);
        const recorded = record(ctx, 'top');
        await engine.registerFlow({
            id: 'leaf',
            nodes: [{ id: 'slow', type: 'slow' }],
            edges: [],
            output: { done: '${slow.done}' },
        });
        await engine.registerFlow({
            id: 'mid',
            nodes: [{ id: 'inner', type: 'subflow', config: { flow: 'leaf' } }],
            edges: [],
            output: { leaf: '${inner.out}' },
        });
        await engine.registerFlow({
            id: 'top',
            nodes: [
                { id: 'bad', type: 'slowFail' },
                { id: 'sub', type: 'subflow', config: { flow: 'mid' } },
                { id: 'join', type: 'noop' },
            ],
            edges: [
                { from: 'bad', to: 'join' },
                { from: 'sub', to: 'join' },
            ],
        });
        const startedAt = Date.now();
        const result = await engine.run('top').awaitCompletion();
        const elapsed = Date.now() - startedAt;
        expect(result.status).toBe('failed');
        expect(result.nodes['sub']!.status).toBe('completed');
        expect(result.nodes['sub']!.error).toBeUndefined();
        expect(result.nodes['join']!.status).toBe('skipped');
        expect(recorded.parentEvents).toEqual(['flow-start', 'start', 'error:bad', 'end:failed', 'flow-end:failed']);
        expect(recorded.allNodeErrors).toEqual(['error:bad']);
        // 两层子 flow 都以 completed 结束，没有任何一层被父级 fail-fast 取消
        // Both nested child flows end completed; none is cancelled by the parent fail-fast.
        const byFlow = new Map(recorded.childEnds.map((end) => [end.flowId, end]));
        expect(byFlow.get('mid')).toMatchObject({ status: 'completed' });
        expect(byFlow.get('leaf')).toMatchObject({ status: 'completed' });
        expect(recorded.childEnds).toHaveLength(2);
        expect(elapsed).toBeGreaterThanOrEqual(70);
    });

    it('still cancels a running child run when the parent is externally cancelled', async () => {
        const { ctx, engine, registry } = makeEngine();
        const started = gate();
        registry.register({
            type: 'hold',
            version: 1,
            config: z.object({}) as NodeHandler['config'],
            execute: (_input, nctx) => {
                started.open();
                return new Promise((resolve) => {
                    nctx.signal.addEventListener('abort', () => resolve('done'), { once: true });
                });
            },
        });
        const recorded = record(ctx, 'cancel-parent');
        await engine.registerFlow({ id: 'cancel-child', nodes: [{ id: 'hold', type: 'hold' }], edges: [] });
        await engine.registerFlow({
            id: 'cancel-parent',
            nodes: [{ id: 'sub', type: 'subflow', config: { flow: 'cancel-child' } }],
            edges: [],
        });
        const handle = engine.run('cancel-parent');
        await started.promise;
        handle.cancel();
        const result = await handle.awaitCompletion();
        // 外部取消必须继续传播进子 flow（与 fail-fast 通知相反）/
        // An external cancel must still propagate into the child run (unlike a fail-fast notice).
        expect(result.status).toBe('cancelled');
        expect(result.nodes['sub']!.status).toBe('cancelled');
        expect(recorded.parentEvents).toEqual(['flow-start', 'start', 'end:cancelled', 'flow-end:cancelled']);
        expect(recorded.allNodeErrors).toEqual([]);
        expect(recorded.childEnds).toHaveLength(1);
        expect(recorded.childEnds[0]).toMatchObject({ flowId: 'cancel-child', status: 'cancelled' });
        expect(engine.getRun(recorded.childEnds[0]!.runId as RunId)!.result!.nodes['hold']!.status).toBe('cancelled');
    });
});

describe('subflow events and run handles', () => {
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
        const started = gate();
        registry.register({
            type: 'hold',
            version: 1,
            config: z.object({}) as NodeHandler['config'],
            execute: (_input, nctx) => {
                started.open();
                return new Promise((resolve) => {
                    nctx.signal.addEventListener('abort', () => resolve('done'), { once: true });
                });
            },
        });
        await engine.registerFlow({
            id: 'cancellable',
            nodes: [{ id: 'a', type: 'hold' }, { id: 'b', type: 'noop' }],
            edges: [{ from: 'a', to: 'b' }],
        });
        const handle = engine.run('cancellable');
        await started.promise;
        expect(handle.status()).toBe('running');
        handle.cancel();
        const result = await handle.awaitCompletion();
        expect(handle.status()).toBe('cancelled');
        expect(result.status).toBe('cancelled');
        expect(result.nodes['a']!.status).toBe('cancelled');
        expect(result.nodes['b']!.status).toBe('cancelled');
        expect(engine.listRuns().length).toBe(1);
        expect(engine.listRuns()[0]!.status).toBe('cancelled');
    });

    it('rejects runs of unregistered flows with FLOW_NOT_FOUND', () => {
        const { engine } = makeEngine();
        expect(() => engine.run('nope')).toThrowError(expect.objectContaining({ code: 'FLOW_NOT_FOUND' }));
        expect(flowError('FLOW_NOT_FOUND', 'x')).toBeInstanceOf(FlowError);
    });
});
