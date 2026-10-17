/**
 * flow 语义单测：并行分支 fail-fast 与运行中取消。
 * 每个用例自建 Context，保证并发安全（单独跑才过 = 缺陷）。
 *
 * Flow semantics tests: parallel-branch fail-fast and mid-run cancel. Every
 * case builds its own Context so specs stay concurrency-safe.
 */

import { describe, expect, it } from 'vitest';
import z from '@deepseek-ai/schemastery';
import type { NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import { gate, makeEngine, slowFailHandler, slowHandler } from './helpers.js';

describe('parallel failure and cancel semantics', () => {
    it('fail-fast lets a running sibling finish and never marks it failed', async () => {
        const { ctx, engine, registry } = makeEngine();
        registry.register(slowHandler);
        registry.register(slowFailHandler);
        const events: string[] = [];
        ctx.on('flow/run-start', () => events.push('flow-start'));
        ctx.on('graph/node-error', (error) => events.push(`node-error:${error.nodeId}`));
        ctx.on('graph/run-start', () => events.push('start'));
        ctx.on('graph/run-end', (payload) => events.push(`end:${payload.status}`));
        ctx.on('flow/run-end', (payload) => events.push(`flow-end:${payload.status}`));
        await engine.registerFlow({
            id: 'parallel-fail',
            nodes: [
                { id: 'bad', type: 'slowFail' },
                { id: 'sib', type: 'slow' },
                { id: 'join', type: 'noop' },
            ],
            edges: [
                { from: 'bad', to: 'join' },
                { from: 'sib', to: 'join' },
            ],
        });
        const startedAt = Date.now();
        const result = await engine.run('parallel-fail').awaitCompletion();
        const elapsed = Date.now() - startedAt;
        expect(result.status).toBe('failed');
        expect(result.nodes['bad']!.status).toBe('failed');
        // 兄弟分支自然跑完，不被打成 FLOW_CANCELLED
        // The sibling branch finishes naturally and is not relabelled FLOW_CANCELLED.
        expect(result.nodes['sib']!.status).toBe('completed');
        expect(result.nodes['sib']!.error).toBeUndefined();
        expect(result.nodes['join']!.status).toBe('skipped');
        expect(result.nodes['join']!.skipReason).toBe('upstream-failure');
        // 事件序列精确：flow 起止包裹内核起止，只有失败节点的 node-error，没有兄弟的
        // Exact event order: the flow start/end wrap the kernel start/end; only the
        // failing node emits node-error and the sibling never does.
        expect(events).toEqual(['flow-start', 'start', 'node-error:bad', 'end:failed', 'flow-end:failed']);
        // 等兄弟的长任务自然结束（不是 abort 立即返回）
        // Waits for the long sibling to settle naturally (not aborted immediately).
        expect(elapsed).toBeGreaterThanOrEqual(70);
    });

    it('cancels a real running flow: every node lands cancelled and no node-error fires', async () => {
        const { ctx, engine, registry } = makeEngine();
        const started = gate();
        const events: string[] = [];
        ctx.on('graph/node-error', (error) => events.push(`node-error:${error.nodeId}`));
        registry.register({
            type: 'hold',
            version: 1,
            config: z.object({}) as NodeHandler['config'],
            execute: (_input, nctx) => {
                // 真实启动后再取消 / cancel only after the executor has really started
                started.open();
                return new Promise((resolve) => {
                    nctx.signal.addEventListener('abort', () => resolve('done'), { once: true });
                });
            },
        });
        await engine.registerFlow({
            id: 'live-cancel',
            nodes: [{ id: 'a', type: 'hold' }, { id: 'b', type: 'noop' }, { id: 'c', type: 'noop' }],
            edges: [
                { from: 'a', to: 'b' },
                { from: 'b', to: 'c' },
            ],
        });
        const handle = engine.run('live-cancel');
        await started.promise;
        expect(handle.status()).toBe('running');
        handle.cancel();
        const result = await handle.awaitCompletion();
        expect(result.status).toBe('cancelled');
        // 运行中取消：已启动的和未启动的下游都落 cancelled
        // A mid-run cancel: the started node and its never-started downstream are all cancelled.
        expect(result.nodes['a']!.status).toBe('cancelled');
        expect(result.nodes['b']!.status).toBe('cancelled');
        expect(result.nodes['c']!.status).toBe('cancelled');
        expect(result.nodes['a']!.error).toBeUndefined();
        // 取消不是失败 / a cancel is not a failure
        expect(events).toEqual([]);
    });
});
