/**
 * 引擎授权语义：节点挂起（awaiting-approval）、同意后继续、拒绝/超时的稳定
 * 错误码、取消解除挂起、审计记录、并发互不串号，以及等待期间节点执行超时暂停。
 *
 * Engine approval semantics: node suspension (awaiting-approval), resume after
 * allow, stable deny/timeout codes, cancel releases the wait, audit records,
 * concurrent isolation, and the node execution timeout pausing during a wait.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { GraphKernelService } from '@deepseek-ai/dsh-graph-core';
import { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api';
import type { FlowApprovalRequest, FlowNodeStatusPayload, NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import { apply as approvalPlugin } from '@deepseek-ai/dsh-graph-flow-approval';
import { FlowEngineService, NodeRegistryImpl } from '../src/index.js';
import type { FlowEngine, FlowRunResult } from '../src/index.js';
import { slowFailHandler } from './helpers.js';

/** 授权节点：请求批准后返回，拒绝/超时按稳定 code 失败 / an approval node */
const approvalNode: NodeHandler = {
    type: 'approval-node',
    version: 1,
    config: z.object({ action: z.string().default('deploy') }) as NodeHandler['config'],
    execute: async (_input, nctx) => {
        const action = (nctx.config as { action: string }).action;
        const outcome = await nctx.approval.request({
            kind: 'custom',
            action,
            reason: `why ${action}`,
            summary: `{"action":"${action}"}`,
        });
        if (outcome.decision === 'deny') {
            const code = outcome.via === 'timeout' ? 'NODE_APPROVAL_TIMEOUT'
                : outcome.via === 'unavailable' ? 'NODE_APPROVAL_UNAVAILABLE'
                    : 'NODE_PERMISSION_DENIED';
            throw Object.assign(new Error(`${action}: ${outcome.via}`), { code });
        }
        return { allowed: action };
    },
};

/** 同一节点尝试并发两个请求：验证状态与审计不会因一个先答而提前回到 running */
const doubleApprovalNode: NodeHandler = {
    type: 'double-approval-node',
    version: 1,
    config: z.object({}) as NodeHandler['config'],
    execute: async (_input, nctx) => {
        const [first, second] = await Promise.all([
            nctx.approval.request({ kind: 'custom', action: 'first' }),
            nctx.approval.request({ kind: 'custom', action: 'second' }),
        ]);
        return { first: first.decision, second: second.decision };
    },
};

/** 最小授权组合：内核 + 引擎 + 授权服务 + 授权节点 / the minimal approval stack */
async function makeStack(options: { nodeTimeoutMs?: number; approvalTimeoutMs?: number } = {}) {
    const ctx = new Context();
    const kernel = new GraphKernelService(ctx);
    const registry = new NodeRegistryImpl();
    const engine = new FlowEngineService(ctx, { nodeTimeoutMs: options.nodeTimeoutMs ?? 5000 }, kernel, registry);
    const approvalFiber = ctx.plugin(
        { inject: [], apply: approvalPlugin } as never,
        { timeoutMs: options.approvalTimeoutMs ?? 5000 },
    );
    await approvalFiber;
    registry.register(approvalNode);
    const approval = ctx.get(FlowApprovalToken)!;
    const statuses: FlowNodeStatusPayload[] = [];
    ctx.on('flow/node-status', (payload) => statuses.push(payload));
    return { ctx, engine, registry, approval, statuses };
}

/** 等到恰好一条挂起请求 / wait for exactly one pending request */
async function waitPending(approval: { pending(): readonly FlowApprovalRequest[] }): Promise<FlowApprovalRequest> {
    for (let index = 0; index < 200; index += 1) {
        const [request] = approval.pending();
        if (request !== undefined) return request;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('no approval request became pending');
}

/** 事件监听器计数（测试用内部诊断面）/ event-listener count (test-only diagnostics) */
function listenerCount(ctx: Context, name: string): number {
    const hooks = (ctx.events as unknown as { _hooks: Record<string, unknown[]> })._hooks;
    return hooks[name]?.length ?? 0;
}

/** 等运行的实时记录到达某状态 / wait for the live run record to reach a status */
function statusesOf(statuses: FlowNodeStatusPayload[], nodeId: string): string[] {
    return statuses.filter((payload) => payload.nodeId === nodeId).map((payload) => payload.status);
}

/** 一次性挂起的运行 / one flow whose single node waits for approval */
async function runOne(engine: FlowEngine): Promise<{ runId: string; result: Promise<FlowRunResult>; cancel: () => void }> {
    await engine.registerFlow({
        id: 'approve-once',
        nodes: [{ id: 'gate', type: 'approval-node', config: { action: 'deploy' } }],
        edges: [],
    });
    const handle = engine.run('approve-once');
    return { runId: handle.runId, result: handle.awaitCompletion(), cancel: () => handle.cancel() };
}

describe('flow node approval', () => {
    it('suspends the node, resumes after allow, and records who/when', async () => {
        const { engine, approval, statuses } = await makeStack();
        const run = await runOne(engine);
        const request = await waitPending(approval);
        const detail = engine.getRun(run.runId as never)!;
        expect(detail.status).toBe('running');
        expect(detail.nodes['gate']).toMatchObject({
            status: 'awaiting-approval',
            approvals: [{ request: { action: 'deploy', reason: 'why deploy' } }],
        });

        expect(approval.answer(request.id, { runId: run.runId, decision: 'allow', actor: 'alice' })).toBe(true);
        const result = await run.result;
        expect(result.status).toBe('completed');
        expect(result.nodes['gate']!.status).toBe('completed');
        expect(result.nodes['gate']!.approvals).toEqual([
            {
                request: expect.objectContaining({ action: 'deploy', attempt: 1 }),
                outcome: expect.objectContaining({ decision: 'allow', via: 'user', decidedBy: 'alice' }),
            },
        ]);
        // 状态序列：运行中 → 等待授权 → 运行中 → 完成
        // Status sequence: running → awaiting approval → running → completed
        expect(statusesOf(statuses, 'gate')).toEqual(['pending', 'ready', 'running', 'awaiting-approval', 'running', 'completed']);
    });

    it('fails with the node code on denial and keeps the audit', async () => {
        const { engine, approval } = await makeStack();
        const run = await runOne(engine);
        const request = await waitPending(approval);
        approval.answer(request.id, { runId: run.runId, decision: 'deny', actor: 'bob' });
        const result = await run.result;
        expect(result.status).toBe('failed');
        expect(result.nodes['gate']!.error).toMatchObject({ code: 'NODE_PERMISSION_DENIED' });
        expect(result.error).toMatchObject({ code: 'NODE_PERMISSION_DENIED' });
        expect(result.nodes['gate']!.approvals![0]!.outcome).toMatchObject({
            decision: 'deny', via: 'user', decidedBy: 'bob',
        });
    });

    it('auto-denies on timeout and fails with NODE_APPROVAL_TIMEOUT', async () => {
        const { engine, approval } = await makeStack({ approvalTimeoutMs: 25 });
        const run = await runOne(engine);
        const result = await run.result;
        expect(result.status).toBe('failed');
        expect(result.nodes['gate']!.error).toMatchObject({ code: 'NODE_APPROVAL_TIMEOUT' });
        expect(approval.pending()).toEqual([]);
        expect(result.nodes['gate']!.approvals![0]!.outcome).toMatchObject({ via: 'timeout' });
    });

    it('releases a suspended node when the run is cancelled', async () => {
        const { engine, approval } = await makeStack();
        const run = await runOne(engine);
        const request = await waitPending(approval);
        run.cancel();
        const result = await run.result;
        expect(result.status).toBe('cancelled');
        expect(result.nodes['gate']!.status).toBe('cancelled');
        expect(approval.pending()).toEqual([]);
        expect(result.nodes['gate']!.approvals![0]!.outcome).toMatchObject({ via: 'cancel' });
        // 撤销后的迟到回答不再生效 / a late answer after withdrawal is refused
        expect(approval.answer(request.id, { runId: run.runId, decision: 'allow' })).toBe(false);
    });

    it('pauses the node execution timeout while waiting for a human', async () => {
        const { engine, approval } = await makeStack({ nodeTimeoutMs: 40, approvalTimeoutMs: 2000 });
        const run = await runOne(engine);
        const request = await waitPending(approval);
        // 超过节点预算 40ms 后仍然等着人 / still waiting well past the 40ms node budget
        await new Promise((resolve) => setTimeout(resolve, 90));
        expect(engine.getRun(run.runId as never)!.nodes['gate']!.status).toBe('awaiting-approval');
        approval.answer(request.id, { runId: run.runId, decision: 'allow' });
        const result = await run.result;
        expect(result.status).toBe('completed');
        expect(result.nodes['gate']!.error).toBeUndefined();
    });

    it('keeps two concurrent approvals on different nodes independent', async () => {
        const { engine, approval } = await makeStack();
        await engine.registerFlow({
            id: 'approve-two',
            nodes: [
                { id: 'left', type: 'approval-node', config: { action: 'left-action' } },
                { id: 'right', type: 'approval-node', config: { action: 'right-action' } },
            ],
            edges: [],
        });
        const running = engine.run('approve-two');
        const first = await waitPending(approval);
        for (let index = 0; index < 200 && approval.pending().length < 2; index += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const all = approval.pending();
        expect(all).toHaveLength(2);
        const right = all.find((request) => request.action === 'right-action')!;
        const left = all.find((request) => request.action === 'left-action')!;
        // 逆序回答：right 先，left 后 / answer in reverse order
        approval.answer(right.id, { runId: running.runId, decision: 'deny', actor: 'bob' });
        approval.answer(left.id, { runId: running.runId, decision: 'allow', actor: 'alice' });
        const result = await running.awaitCompletion();
        expect(result.nodes['left']!.status).toBe('completed');
        expect(result.nodes['right']!.status).toBe('failed');
        expect(result.nodes['left']!.approvals![0]!.outcome).toMatchObject({ decision: 'allow', decidedBy: 'alice' });
        expect(result.nodes['right']!.approvals![0]!.outcome).toMatchObject({ decision: 'deny', decidedBy: 'bob' });
        expect(first.runId).toBe(running.runId);
    });

    it('stays awaiting until every concurrent request of the same attempt settles', async () => {
        const { engine, registry, approval, statuses } = await makeStack();
        registry.register(doubleApprovalNode);
        await engine.registerFlow({ id: 'double', nodes: [{ id: 'gate', type: 'double-approval-node' }], edges: [] });
        const handle = engine.run('double');
        for (let index = 0; index < 200 && approval.pending().length < 2; index += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const pending = approval.pending();
        expect(pending.map((request) => request.action).sort()).toEqual(['first', 'second']);
        const first = pending.find((request) => request.action === 'first')!;
        approval.answer(first.id, { runId: handle.runId, decision: 'allow' });
        await new Promise((resolve) => setTimeout(resolve, 20));
        // 还有第二个请求挂着：节点必须仍是等待授权，不能提前回到 running。
        // One request is still open: the node must stay awaiting-approval.
        expect(engine.getRun(handle.runId)!.nodes['gate']!.status).toBe('awaiting-approval');
        const second = pending.find((request) => request.action === 'second')!;
        approval.answer(second.id, { runId: handle.runId, decision: 'deny' });
        const result = await handle.awaitCompletion();
        expect(result.status).toBe('completed');
        expect(result.nodes['gate']!.output).toEqual({ first: 'allow', second: 'deny' });
        expect(result.nodes['gate']!.approvals).toHaveLength(2);
        const sequence = statusesOf(statuses, 'gate');
        expect(sequence.filter((status) => status === 'awaiting-approval').length).toBeGreaterThanOrEqual(2);
        expect(sequence.at(-1)).toBe('completed');
    });

    it('removes the per-attempt approval listeners once the node settles', async () => {
        const { ctx, engine, approval } = await makeStack();
        const requested = listenerCount(ctx, 'flow/approval-requested');
        const decided = listenerCount(ctx, 'flow/approval-decided');
        const run = await runOne(engine);
        const request = await waitPending(approval);
        approval.answer(request.id, { runId: run.runId, decision: 'allow' });
        await run.result;
        expect(listenerCount(ctx, 'flow/approval-requested')).toBe(requested);
        expect(listenerCount(ctx, 'flow/approval-decided')).toBe(decided);
    });

    it('withdraws a pending approval when a sibling fails fast', async () => {
        const { engine, registry, approval } = await makeStack();
        registry.register(slowFailHandler);
        await engine.registerFlow({
            id: 'fail-fast-approval',
            nodes: [
                { id: 'bad', type: 'slowFail' },
                { id: 'gate', type: 'approval-node', config: { action: 'deploy' } },
            ],
            edges: [],
        });
        const running = engine.run('fail-fast-approval');
        await waitPending(approval);
        const result = await running.awaitCompletion();
        expect(result.status).toBe('failed');
        // 失败传播撤销挂起请求：不会留下一个没人会答的卡片。
        // Failure propagation withdraws the pending request: no card is left
        // waiting for an answer that can no longer change the run.
        expect(approval.pending()).toEqual([]);
        expect(result.nodes['bad']!.status).toBe('failed');
        expect(result.nodes['gate']!.approvals![0]!.outcome).toMatchObject({ via: 'cancel' });
    });

    it('denies as unavailable when no approval service is mounted (fail-closed stays)', async () => {        const ctx = new Context();
        const kernel = new GraphKernelService(ctx);
        const registry = new NodeRegistryImpl();
        const engine = new FlowEngineService(ctx, { nodeTimeoutMs: 5000 }, kernel, registry);
        registry.register(approvalNode);
        await engine.registerFlow({
            id: 'no-broker',
            nodes: [{ id: 'gate', type: 'approval-node' }],
            edges: [],
        });
        const result = await engine.run('no-broker').awaitCompletion();
        expect(result.status).toBe('failed');
        expect(result.nodes['gate']!.error).toMatchObject({ code: 'NODE_APPROVAL_UNAVAILABLE' });
    });
});
