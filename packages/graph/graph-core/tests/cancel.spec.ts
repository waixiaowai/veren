/**
 * 内核取消与失败传播语义：运行中 cancel、取消不是失败、fail-fast 等待
 * 兄弟分支自然结束、可替换失败策略。每个用例自建 Context，保证并发安全。
 *
 * Kernel cancel and failure-propagation semantics: mid-run cancel, a cancel
 * is not a failure, fail-fast waits for running siblings to settle, and the
 * replaceable failure strategy. Every case builds its own Context.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import {
    GraphNodeError,
    runGraph,
    type GExecutor,
    type Graph,
    type GraphNodeError as GraphNodeErrorType,
} from '../src/index.js';
import { line } from './helpers.js';

/** 一次性放行信号（测试用）/ a one-shot gate for tests */
function gate(): { promise: Promise<void>; open: () => void } {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => { open = resolve; });
    return { promise, open };
}

/** 失败节点 executor / an executor that fails named nodes */
function failingExecutor(failIds: string[], trace: string[] = []): GExecutor {
    return {
        async execute(node) {
            trace.push(node.id);
            if (failIds.includes(node.id)) throw new Error(`boom:${node.id}`);
            return { ok: true };
        },
    };
}

describe('cancel and failure propagation', () => {
    it('marks a running node and its not-yet-started downstream cancelled on a mid-run cancel', async () => {
        const ctx = new Context();
        const started = gate();
        const graph: Graph = {
            id: 'cancel',
            nodes: [{ id: 'slow' }, { id: 'never' }],
            edges: [{ from: 'slow', to: 'never' }],
        };
        const executor: GExecutor = {
            execute: (node, runCtx) =>
                new Promise((resolve) => {
                    // 记录真实启动，再等执行方自愿响应 abort /
                    // record the real start, then wait for the executor to opt in to the abort.
                    started.open();
                    runCtx.signal.addEventListener('abort', () => resolve(node.id), { once: true });
                }),
        };
        const handle = runGraph(graph, executor, { ctx });
        await started.promise;
        handle.cancel();
        const result = await handle.result;
        expect(result.status).toBe('cancelled');
        expect(result.nodes['slow']!.status).toBe('cancelled');
        // 验收要求 cancel 后各节点进入 cancelled，而不是 skipped/upstream-cancel
        // Acceptance requires every node to become cancelled, not skipped/upstream-cancel.
        expect(result.nodes['never']!.status).toBe('cancelled');
        expect(result.nodes['never']!.skipReason).toBeUndefined();
    });

    it('records a node that rejects while cancelling as cancelled instead of failed', async () => {
        const ctx = new Context();
        const started = gate();
        const events: string[] = [];
        ctx.on('graph/node-error', (error) => events.push(`error:${error.nodeId}`));
        // 非协作执行方：abort 后抛错（flow 层 withTimeout 的真实行为）/
        // A non-cooperative executor: throws after abort (the real flow-layer withTimeout behavior).
        const executor: GExecutor = {
            execute: (_node, runCtx) => {
                started.open();
                return new Promise((_resolve, reject) => {
                    runCtx.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
                });
            },
        };
        const handle = runGraph(line('b', ['a']), executor, { ctx });
        await started.promise;
        handle.cancel();
        const result = await handle.result;
        expect(result.status).toBe('cancelled');
        expect(result.nodes['a']!.status).toBe('cancelled');
        expect(result.nodes['a']!.error).toBeUndefined();
        expect(result.nodes['b']!.status).toBe('cancelled');
        // 取消不是失败，不发 node-error / a cancel is not a failure: no node-error events
        expect(events).toEqual([]);
    });

    it('fail-fast skips downstream, lets running siblings finish, fails the run', async () => {
        const ctx = new Context();
        const trace: string[] = [];
        const graph: Graph = {
            id: 'failfast',
            nodes: [{ id: 'bad' }, { id: 'down' }, { id: 'sibling' }, { id: 'join' }],
            edges: [
                { from: 'bad', to: 'down' },
                { from: 'sibling', to: 'join' },
                { from: 'down', to: 'join' },
            ],
        };
        const events: string[] = [];
        ctx.on('graph/node-error', (error: GraphNodeErrorType) => events.push(`error:${error.nodeId}`));
        ctx.on('graph/run-end', (payload) => events.push(`end:${payload.status}`));
        // 兄弟分支是长任务：证明内核等待它自然结束 / the sibling is a long task: proves the kernel waits for it
        const executor: GExecutor = {
            async execute(node) {
                trace.push(node.id);
                if (node.id === 'sibling') await new Promise((resolve) => setTimeout(resolve, 80));
                if (node.id === 'bad') throw new Error('boom');
                return { ok: true };
            },
        };
        const startedAt = Date.now();
        const result = await runGraph(graph, executor, { ctx }).result;
        const elapsed = Date.now() - startedAt;
        expect(result.status).toBe('failed');
        expect(result.nodes['bad']!.status).toBe('failed');
        expect(result.nodes['bad']!.error).toBeInstanceOf(GraphNodeError);
        expect(result.nodes['down']!.status).toBe('skipped');
        expect(result.nodes['down']!.skipReason).toBe('upstream-failure');
        expect(result.nodes['sibling']!.status).toBe('completed');
        expect(result.nodes['join']!.status).toBe('skipped');
        // 事件序列精确：兄弟不被误标失败，也没有多余的 node-error
        // Exact event order: the sibling is not mislabelled as failed and no extra node-error fires.
        expect(events).toEqual(['error:bad', 'end:failed']);
        expect(trace).toContain('sibling');
        // 长任务跑完才结束 run（不是被 abort 立刻打断）/
        // The run ends only after the long sibling settles (not cut short by the abort).
        expect(elapsed).toBeGreaterThanOrEqual(80);
    });

    it('supports a replaceable continue strategy', async () => {
        const ctx = new Context();
        const graph: Graph = {
            id: 'continue',
            nodes: [{ id: 'bad' }, { id: 'down' }],
            edges: [{ from: 'bad', to: 'down' }],
        };
        const result = await runGraph(graph, failingExecutor(['bad']), {
            ctx,
            onNodeFailure: () => 'continue',
        }).result;
        expect(result.status).toBe('completed');
        expect(result.nodes['bad']!.status).toBe('failed');
        expect(result.nodes['down']!.status).toBe('skipped');
    });
});
