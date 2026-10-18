/**
 * 运行中挂载测试：a 完成、b 运行中时 watch，snapshot 必须立即 hydration 成
 * completed/running；后续完成、再挂载都不能回退。
 *
 * Mid-run watch tests: attach while a is completed and b is running; the
 * snapshot must hydrate to completed/running immediately, and later stages
 * (finish + late watch) must never regress.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core';
import { registerNodeHandler, type NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import { apply as enginePlugin, FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine';
import {
    apply as canvasPlugin,
    FlowCanvasToken,
    type CanvasNodeStatusChange,
    type CanvasRunSnapshot,
} from '../src/index.js';

/** 最小组合：内核 + 引擎 + 画布数据源 / the minimal kernel + engine + canvas stack */
async function makeStack() {
    const ctx = new Context();
    await ctx.plugin(kernelPlugin);
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5000 });
    await ctx.plugin(canvasPlugin);
    return { ctx, engine: ctx.get(FlowEngineToken)!, canvas: ctx.get(FlowCanvasToken)! };
}

/** 一次性放行信号 / a one-shot gate */
function gate(): { promise: Promise<void>; open: () => void } {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => { open = resolve; });
    return { promise, open };
}

/** 运行投影的精确视图（用于阶段断言）/ an exact view of a run snapshot for stage assertions */
function viewOf(snapshot: CanvasRunSnapshot) {
    return { status: snapshot.status, a: snapshot.nodes['a']!.status, b: snapshot.nodes['b']!.status };
}

describe('mid-run watch hydration', () => {
    it('hydrates completed/running states and keeps every snapshot monotonic', async () => {
        const { ctx, engine, canvas } = await makeStack();
        const started = gate();
        const release = gate();
        registerNodeHandler(ctx, {
            type: 'hold-open',
            version: 1,
            config: z.object({}) as NodeHandler['config'],
            execute: () => {
                started.open();
                return release.promise.then(() => ({ done: true }));
            },
        });
        await engine.registerFlow({
            id: 'mid-watch',
            nodes: [{ id: 'a', type: 'noop' }, { id: 'b', type: 'hold-open' }],
            edges: [{ from: 'a', to: 'b' }],
        });
        const handle = engine.run('mid-watch');
        await started.promise;

        const changes: CanvasNodeStatusChange[] = [];
        const projection = canvas.watch(handle, (change) => changes.push(change));
        const mid = projection.snapshot();
        try {
            // a 已 completed、b 正在 running：挂载即 hydration，不能是 pending
            // a is completed and b is running: the watch hydrates them immediately, never pending.
            expect(viewOf(mid)).toEqual({ status: 'running', a: 'completed', b: 'running' });
            expect(mid.nodes['a']!.startedAt).toBeTypeOf('number');
            expect(mid.nodes['a']!.endedAt).toBeTypeOf('number');
            expect(mid.nodes['b']!.startedAt).toBeTypeOf('number');
            expect('error' in mid.nodes['a']!).toBe(false);
            // 人为迟到的 pending 事件不得把 completed 拉回去
            // A deliberately late pending event must not roll completed back.
            ctx.emit('flow/node-status', { flowId: handle.flowId, runId: handle.runId, nodeId: 'a', status: 'pending' });
            expect(projection.snapshot().nodes['a']!.status).toBe('completed');
        } finally {
            release.open();
        }

        const final = await projection.finished;
        const done = projection.snapshot();
        expect(viewOf(done)).toEqual({ status: 'completed', a: 'completed', b: 'completed' });
        expect(final.result).toEqual(await handle.awaitCompletion());

        // 完成后再挂载：仍然直接是终态 / watching after completion still hydrates the final state immediately
        const lateProjection = canvas.watch(handle);
        const late = lateProjection.snapshot();
        expect(viewOf(late)).toEqual({ status: 'completed', a: 'completed', b: 'completed' });
        await lateProjection.finished;

        // 挂载之后只应收到 b:completed；没有 pending/ready 倒退事件
        // After attaching, only b:completed should arrive; no pending/ready regression.
        expect(changes.map((change) => `${change.nodeId}:${change.status}`)).toEqual(['b:completed']);

        // 阶段快照的状态序全程不下降 / the status rank never decreases across snapshots
        const rank: Record<string, number> = { pending: 0, ready: 1, running: 2, completed: 3, failed: 3, skipped: 3, cancelled: 3 };
        for (const id of ['a', 'b']) {
            expect(rank[done.nodes[id]!.status]!).toBeGreaterThanOrEqual(rank[mid.nodes[id]!.status]!);
            expect(rank[late.nodes[id]!.status]!).toBeGreaterThanOrEqual(rank[done.nodes[id]!.status]!);
        }
    });
});
