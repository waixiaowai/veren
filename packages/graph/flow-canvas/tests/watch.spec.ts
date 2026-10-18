/**
 * 运行投影测试：按节点状态流、失败/跳过/取消、最终快照一致性与监听器清理。
 * 每个用例自建 Context，保证并发安全（单独跑才过 = 缺陷）。
 *
 * Run projection tests: per-node status streams, failure/skip/cancel,
 * final-snapshot consistency and listener cleanup. Every case builds its own
 * Context so specs stay concurrency-safe.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core';
import { registerNodeHandler, type NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import { apply as enginePlugin, FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine';
import { apply as canvasPlugin, FlowCanvasToken, type CanvasNodeStatusChange, type CanvasRunProjection } from '../src/index.js';

/** 最小组合：内核 + 引擎 + 画布数据源 / the minimal kernel + engine + canvas stack */
async function makeStack() {
    const ctx = new Context();
    await ctx.plugin(kernelPlugin);
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5000 });
    await ctx.plugin(canvasPlugin);
    return {
        ctx,
        engine: ctx.get(FlowEngineToken)!,
        canvas: ctx.get(FlowCanvasToken)!,
    };
}

/** 慢节点：让兄弟分支真实并发 / a slow node so the sibling really runs concurrently */
const slowHandler: NodeHandler = {
    type: 'slow',
    version: 1,
    config: z.object({}) as NodeHandler['config'],
    execute: () => new Promise((resolve) => setTimeout(() => resolve({ done: true }), 60)),
};

/** 可取消节点：真实启动后等 abort / a cancellable node: starts for real, then waits for abort */
const holdHandler: NodeHandler = {
    type: 'hold',
    version: 1,
    config: z.object({}) as NodeHandler['config'],
    execute: (_input, nctx) => new Promise((resolve) => {
        nctx.signal.addEventListener('abort', () => resolve({ done: true }), { once: true });
    }),
};

/** 读事件服务上的监听器数量（测试用内部诊断面）/ read the listener count (test-only diagnostics) */
function listenerCount(ctx: Context, name: string): number {
    const hooks = (ctx.events as unknown as { _hooks: Record<string, unknown[]> })._hooks;
    return hooks[name]?.length ?? 0;
}

/** 按节点分组状态序列 / group status names per node */
function perNode(changes: CanvasNodeStatusChange[]): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const change of changes) (result[change.nodeId] ??= []).push(change.status);
    return result;
}

describe('canvas run projection', () => {
    it('streams pending → ready → running → completed | failed | skipped and matches the final result', async () => {
        const { ctx, engine, canvas } = await makeStack();
        registerNodeHandler(ctx, slowHandler);
        await engine.registerFlow({
            id: 'failure-flow',
            nodes: [
                { id: 'bad', type: 'fail' },
                { id: 'sib', type: 'slow' },
                { id: 'join', type: 'noop' },
            ],
            edges: [
                { from: 'bad', to: 'join' },
                { from: 'sib', to: 'join' },
            ],
        });

        const changes: CanvasNodeStatusChange[] = [];
        const projection = canvas.run('failure-flow', {}, (change) => changes.push(change));
        const final = await projection.finished;
        const result = await projection.handle.awaitCompletion();

        // 每个节点都从 pending 播种；初始快照不依赖轮询
        // Every node starts from pending; the initial snapshot needs no polling.
        expect(changes.filter((change) => change.status === 'pending').map((change) => change.nodeId).sort())
            .toEqual(['bad', 'join', 'sib']);
        const streams = perNode(changes);
        expect(streams['bad']).toEqual(['pending', 'ready', 'running', 'failed']);
        expect(streams['sib']).toEqual(['pending', 'ready', 'running', 'completed']);
        expect(streams['join']).toEqual(['pending', 'skipped']);
        expect(changes.find((change) => change.nodeId === 'bad' && change.status === 'failed')!.error)
            .toMatchObject({ code: 'NODE_FAILED' });

        // 最终快照与 RunResult 一致（同一份节点记录与状态）
        // The final snapshot matches the RunResult record-for-record.
        expect(final.status).toBe('failed');
        expect(final.result).toEqual(result);
        expect(final.nodes['bad']).toMatchObject({ status: 'failed', error: { code: 'NODE_FAILED' } });
        expect(final.nodes['sib']).toMatchObject({ status: 'completed' });
        expect(final.nodes['join']).toMatchObject({ status: 'skipped', skipReason: 'upstream-failure' });
        expect(final.nodes['bad']!.startedAt).toBeTypeOf('number');
        expect(final.nodes['bad']!.endedAt).toBeTypeOf('number');
    });

    it('projects an inactive conditional edge as skipped with upstream-condition', async () => {
        const { engine, canvas } = await makeStack();
        await engine.registerFlow({
            id: 'condition-flow',
            nodes: [
                { id: 'a', type: 'echo' },
                { id: 'take', type: 'noop' },
                { id: 'drop', type: 'noop' },
            ],
            edges: [
                { from: 'a', to: 'take', when: () => true },
                { from: 'a', to: 'drop', when: () => false },
            ],
        });

        const changes: CanvasNodeStatusChange[] = [];
        const final = await canvas.run('condition-flow', {}, (change) => changes.push(change)).finished;
        expect(final.status).toBe('completed');
        expect(final.nodes['take']!.status).toBe('completed');
        expect(final.nodes['drop']).toMatchObject({ status: 'skipped', skipReason: 'upstream-condition' });
        expect(perNode(changes)['drop']).toEqual(['pending', 'skipped']);
    });

    it('projects cancel as cancelled for running and never-started nodes', async () => {
        const { ctx, engine, canvas } = await makeStack();
        registerNodeHandler(ctx, holdHandler);
        await engine.registerFlow({
            id: 'cancel-flow',
            nodes: [
                { id: 'hold', type: 'hold' },
                { id: 'never', type: 'noop' },
            ],
            edges: [{ from: 'hold', to: 'never' }],
        });
        const changes: CanvasNodeStatusChange[] = [];
        const projection = canvas.run('cancel-flow', {}, (change) => changes.push(change));
        // hold 真正启动后再取消 / cancel only after hold really started
        for (let i = 0; i < 50 && !changes.some((change) => change.nodeId === 'hold' && change.status === 'running'); i++) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        projection.handle.cancel();
        const final = await projection.finished;
        expect(final.status).toBe('cancelled');
        expect(final.nodes['hold']!.status).toBe('cancelled');
        expect(final.nodes['never']!.status).toBe('cancelled');
        expect(perNode(changes)['never']).toEqual(['pending', 'cancelled']);
        // 取消不是失败 / a cancel is not a failure
        expect(changes.some((change) => change.status === 'failed')).toBe(false);
    });

    it('returns a consistent final snapshot when watching an already-finished run', async () => {
        const { engine, canvas } = await makeStack();
        await engine.registerFlow({
            id: 'late-watch',
            nodes: [
                { id: 'a', type: 'noop' },
                { id: 'b', type: 'noop' },
            ],
            edges: [{ from: 'a', to: 'b' }],
        });
        const handle = engine.run('late-watch');
        const result = await handle.awaitCompletion();
        const projection = canvas.watch(handle);
        const immediate = projection.snapshot();
        expect(immediate.status).toBe(result.status);
        expect(immediate.result).toEqual(result);
        for (const [id, record] of Object.entries(result.nodes)) {
            const expected: Record<string, unknown> = { id, status: record.status };
            if (record.skipReason !== undefined) expected.skipReason = record.skipReason;
            if (record.startedAt !== undefined) expected.startedAt = record.startedAt;
            if (record.endedAt !== undefined) expected.endedAt = record.endedAt;
            if (record.error) expected.error = record.error;
            if (record.recovered) expected.recovered = record.recovered;
            expect(immediate.nodes[id]).toEqual(expected);
        }
        expect((await projection.finished).result).toEqual(result);
    });

    it('keeps the errorBranch failure fact on the draw surface', async () => {
        const { engine, canvas } = await makeStack();
        await engine.registerFlow({
            id: 'errorbranch-recovered',
            nodes: [
                { id: 'gate', type: 'fail', onError: 'errorBranch' },
                { id: 'recover', type: 'noop' },
                { id: 'normal', type: 'noop' },
            ],
            edges: [
                { from: 'gate', to: 'recover', port: 'error' },
                { from: 'gate', to: 'normal' },
            ],
        });
        const changes: CanvasNodeStatusChange[] = [];
        const final = await canvas.run('errorbranch-recovered', {}, (change) => changes.push(change)).finished;
        expect(final.status).toBe('completed');
        // 失败事实保留，但完成语义与端口行为不变
        // The failure fact is preserved while completion and port behavior stay unchanged.
        expect(final.nodes['gate']).toMatchObject({ status: 'completed', recovered: { code: 'NODE_FAILED' } });
        expect(final.result!.nodes['gate']!.recovered).toEqual({ code: 'NODE_FAILED', message: 'node failed' });
        expect(changes.find((change) => change.nodeId === 'gate' && change.status === 'completed')!.recovered)
            .toEqual({ code: 'NODE_FAILED', message: 'node failed' });
        expect(final.nodes['recover']!.status).toBe('completed');
        expect(final.nodes['normal']).toMatchObject({ status: 'skipped', skipReason: 'upstream-condition' });
    });

    it('removes its listeners when the run ends (no leak into the next run)', async () => {
        const { ctx, engine, canvas } = await makeStack();
        await engine.registerFlow({ id: 'cleanup-flow', nodes: [{ id: 'a', type: 'noop' }], edges: [] });
        const baseline = {
            status: listenerCount(ctx, 'flow/node-status'),
            end: listenerCount(ctx, 'flow/run-end'),
        };
        const projection = canvas.run('cleanup-flow');
        expect(listenerCount(ctx, 'flow/node-status')).toBe(baseline.status + 1);
        expect(listenerCount(ctx, 'flow/run-end')).toBe(baseline.end + 1);
        await projection.finished;
        expect(listenerCount(ctx, 'flow/node-status')).toBe(baseline.status);
        expect(listenerCount(ctx, 'flow/run-end')).toBe(baseline.end);
    });

    it('dispose() is idempotent and unhooks an early subscription', async () => {
        const { ctx, engine, canvas } = await makeStack();
        registerNodeHandler(ctx, slowHandler);
        await engine.registerFlow({ id: 'dispose-flow', nodes: [{ id: 'a', type: 'slow' }], edges: [] });
        const baseline = listenerCount(ctx, 'flow/node-status');
        const projection = canvas.run('dispose-flow');
        expect(listenerCount(ctx, 'flow/node-status')).toBe(baseline + 1);
        projection.dispose();
        projection.dispose();
        expect(listenerCount(ctx, 'flow/node-status')).toBe(baseline);
        // 停止订阅不影响底层运行 / stopping the subscription does not cancel the run
        await projection.finished;
        expect(projection.handle.status()).toBe('completed');
    });

    it('keeps live events when the run is started from a child context', async () => {
        const { ctx, engine } = await makeStack();
        registerNodeHandler(ctx, slowHandler);
        await engine.registerFlow({
            id: 'rebind-flow',
            nodes: [{ id: 'a', type: 'slow' }, { id: 'b', type: 'noop' }],
            edges: [{ from: 'a', to: 'b' }],
        });
        const changes: CanvasNodeStatusChange[] = [];
        let projection: CanvasRunProjection | undefined;
        // A Remote call is a transient child context in Cordis: this reproduces
        // the Gateway's service rebind, where the listener must not follow the
        // caller context.
        const child = ctx.plugin({
            apply(scope) {
                projection = scope.get(FlowCanvasToken)!.run('rebind-flow', {}, (change) => changes.push(change));
            },
        });
        await child;
        await projection!.finished;
        expect(changes.some((change) => change.nodeId === 'a' && change.status === 'running')).toBe(true);
        expect(changes.some((change) => change.nodeId === 'a' && change.status === 'completed')).toBe(true);
    });
});
