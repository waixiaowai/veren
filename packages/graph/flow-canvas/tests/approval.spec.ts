/**
 * 画布运行投影的授权面：awaiting-approval 状态、挂起中的请求、落定后的审计，
 * 以及运行中才挂载的订阅者（hydration）能直接读到等待状态。
 *
 * The canvas run projection's approval face: the awaiting-approval status, the
 * pending request, the settled audit, and a subscriber that attaches mid-wait
 * (hydration) seeing the suspended state immediately.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core';
import { registerNodeHandler, type NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api';
import { apply as enginePlugin, FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine';
import { apply as approvalPlugin } from '@deepseek-ai/dsh-graph-flow-approval';
import { apply as canvasPlugin, FlowCanvasToken } from '../src/index.js';
import type { CanvasNodeStatusChange } from '../src/index.js';

/** 等待一次授权的节点 / a node that waits for one approval */
const approvalNode: NodeHandler = {
    type: 'approval-node',
    version: 1,
    config: z.object({}) as NodeHandler['config'],
    execute: async (_input, nctx) => {
        const outcome = await nctx.approval.request({ kind: 'custom', action: 'ship', reason: 'prod change' });
        if (outcome.decision === 'deny') throw Object.assign(new Error('denied'), { code: 'NODE_PERMISSION_DENIED' });
        return { shipped: true };
    },
};

/** 最小授权画布组合 / the minimal approval canvas stack */
async function makeStack() {
    const ctx = new Context();
    await ctx.plugin(kernelPlugin);
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5000 });
    await ctx.plugin({ inject: [], apply: approvalPlugin } as never, { timeoutMs: 5000 });
    await ctx.plugin(canvasPlugin);
    registerNodeHandler(ctx, approvalNode);
    return {
        ctx,
        engine: ctx.get(FlowEngineToken)!,
        canvas: ctx.get(FlowCanvasToken)!,
        approval: ctx.get(FlowApprovalToken)!,
    };
}

/** 等挂起请求 / wait for the pending request */
async function waitPending(approval: { pending(): readonly { id: string }[] }) {
    for (let index = 0; index < 200; index += 1) {
        const [request] = approval.pending();
        if (request !== undefined) return request;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('no approval became pending');
}

describe('canvas run projection: approvals', () => {
    it('shows awaiting-approval with the pending request and keeps the audit after allow', async () => {
        const { engine, canvas, approval } = await makeStack();
        await engine.registerFlow({ id: 'ship', nodes: [{ id: 'gate', type: 'approval-node' }], edges: [] });
        const changes: CanvasNodeStatusChange[] = [];
        const projection = canvas.run('ship', {}, (change) => changes.push(change));
        const request = await waitPending(approval);
        const live = projection.snapshot();
        expect(live.nodes['gate']).toMatchObject({
            status: 'awaiting-approval',
            approvals: [{ request: { action: 'ship', reason: 'prod change' } }],
        });
        // 状态流里也有等待态与审计（画布不轮询）/ the stream carries the wait and audit too (no polling)
        expect(changes.some((change) => change.status === 'awaiting-approval'
            && change.approvals?.[0]?.request.id === request.id)).toBe(true);

        approval.answer(request.id, { runId: projection.runId, decision: 'allow', actor: 'alice' });
        const final = await projection.finished;
        expect(final.status).toBe('completed');
        expect(final.nodes['gate']).toMatchObject({
            status: 'completed',
            approvals: [{ outcome: { decision: 'allow', decidedBy: 'alice' } }],
        });
        expect(final.result!.nodes['gate']!.approvals).toHaveLength(1);
    });

    it('hydrates a subscriber that attaches mid-wait with the suspended status', async () => {
        const { engine, canvas, approval } = await makeStack();
        await engine.registerFlow({ id: 'ship-late', nodes: [{ id: 'gate', type: 'approval-node' }], edges: [] });
        const handle = engine.run('ship-late');
        await waitPending(approval);
        const projection = canvas.watch(handle);
        expect(projection.snapshot().nodes['gate']!.status).toBe('awaiting-approval');
        const request = approval.pending()[0]!;
        approval.answer(request.id, { runId: handle.runId, decision: 'allow' });
        const final = await projection.finished;
        expect(final.nodes['gate']!.status).toBe('completed');
    });

    it('settles the node as cancelled when the run is cancelled mid-wait', async () => {
        const { engine, canvas, approval } = await makeStack();
        await engine.registerFlow({ id: 'ship-cancel', nodes: [{ id: 'gate', type: 'approval-node' }], edges: [] });
        const projection = canvas.run('ship-cancel');
        await waitPending(approval);
        projection.handle.cancel();
        const final = await projection.finished;
        expect(final.status).toBe('cancelled');
        expect(final.nodes['gate']!.status).toBe('cancelled');
        expect(final.nodes['gate']!.approvals![0]!.outcome).toMatchObject({ via: 'cancel' });
    });
});
