/**
 * 节点状态事件测试：内核在每次迁移时广播中性状态，订阅方拿到
 * pending → ready → running → completed | failed | skipped 与起止时间。
 *
 * Node status-event tests: the kernel broadcasts a neutral status on every
 * transition, so subscribers see pending → ready → running → completed |
 * failed | skipped plus timestamps.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { runGraph, type GExecutor, type Graph, type GraphNodeStatusPayload } from '../src/index.js';

/** 收集状态事件的辅助 / helper collecting status events */
function recordStatus(ctx: Context): GraphNodeStatusPayload[] {
    const events: GraphNodeStatusPayload[] = [];
    ctx.on('graph/node-status', (payload) => events.push(payload));
    return events;
}

/** 按节点分组状态名 / group status names per node */
function byNode(events: GraphNodeStatusPayload[]): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const event of events) (result[event.nodeId] ??= []).push(event.status);
    return result;
}

describe('graph node status events', () => {
    it('broadcasts every middle state with timestamps', async () => {
        const ctx = new Context();
        const events = recordStatus(ctx);
        const graph: Graph = { id: 'status', nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }] };
        const executor: GExecutor = { execute: async (node) => ({ id: node.id }) };
        const result = await runGraph(graph, executor, { ctx }).result;

        expect(result.status).toBe('completed');
        expect(byNode(events)['a']).toEqual(['pending', 'ready', 'running', 'completed']);
        expect(byNode(events)['b']).toEqual(['pending', 'ready', 'running', 'completed']);
        const running = events.find((event) => event.nodeId === 'a' && event.status === 'running')!;
        expect(running.startedAt).toBeTypeOf('number');
        const completed = events.find((event) => event.nodeId === 'a' && event.status === 'completed')!;
        expect(completed.endedAt).toBeTypeOf('number');
    });

    it('reports failure and downstream skip with reasons', async () => {
        const ctx = new Context();
        const events = recordStatus(ctx);
        const graph: Graph = { id: 'status-fail', nodes: [{ id: 'bad' }, { id: 'down' }], edges: [{ from: 'bad', to: 'down' }] };
        const executor: GExecutor = {
            execute: async (node) => {
                if (node.id === 'bad') throw new Error('boom');
                return true;
            },
        };
        const result = await runGraph(graph, executor, { ctx }).result;

        expect(result.status).toBe('failed');
        expect(byNode(events)['bad']).toEqual(['pending', 'ready', 'running', 'failed']);
        expect(byNode(events)['down']).toEqual(['pending', 'skipped']);
        const failed = events.find((event) => event.nodeId === 'bad' && event.status === 'failed')!;
        expect(failed.error).toMatchObject({ code: 'GRAPH_NODE_FAILED' });
        const skipped = events.find((event) => event.nodeId === 'down' && event.status === 'skipped')!;
        expect(skipped.skipReason).toBe('upstream-failure');
    });
});
