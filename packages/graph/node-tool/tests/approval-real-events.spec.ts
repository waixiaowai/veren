/**
 * Tool-node approval over real events: the composed behavior of kernel +
 * engine + approval + tool node over a fake tools pipeline — the run suspends
 * on an ask and resumes on the human answer, denials and timeouts fail the
 * node with the stable code, cancelling releases the suspended call, and
 * concurrent approvals land on the right nodes with their audits.
 *
 * 真实事件路径上的 tool 节点授权：内核 + 引擎 + 授权 + tool 节点在假 tools 管线上的
 * 组合行为——运行在 ask 上挂起、由人工应答恢复；拒绝与超时以稳定错误码使节点失败；
 * 取消会释放挂起的调用；并发授权落在正确的节点上并留有审计。
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { provideValue } from '@veren/core';
import type { PreToolDecision, ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core';
import { apply as enginePlugin, FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine';
import { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api';
import type { FlowApprovalRequest } from '@deepseek-ai/dsh-graph-flow-api';
import { apply as approvalPlugin } from '@deepseek-ai/dsh-graph-flow-approval';
import * as nodeTool from '../src/index.js';
import { APPROVAL_CODES } from '../src/index.js';
import { failure, success } from './approval-helpers.ts';

/** 真实事件路径的假 tools 管线：执行 pre-execute waterfall，ask 由节点插件消费 */
function fakeTools(ctx: Context, decide: (call: ToolExecutionInput) => PreToolDecision = () => ({ kind: 'ask', reason: 'policy asks' })) {
    const calls: ToolExecutionInput[] = [];
    const execute = async (call: ToolExecutionInput): Promise<ToolExecutionResult> => {
        calls.push(call);
        const exec = {
            callId: call.callId,
            name: call.name,
            arguments: call.arguments,
            signal: call.signal,
        };
        const decision = await ctx.waterfall(
            'tools/pre-execute',
            exec as never,
            () => Promise.resolve(decide(call)),
        ) as PreToolDecision;
        if (decision.kind === 'deny') return failure(decision.reason, decision.info?.code);
        if (decision.kind === 'cancel') return failure('cancelled');
        return success({ tool: call.name, arguments: call.arguments });
    };
    return { execute, calls };
}

/** 内核 + 引擎 + 授权 + tool 节点 + 假 tools 管线 / kernel + engine + approval + tool node + fake pipeline */
async function makeStack(options: { approvalTimeoutMs?: number; decide?: (call: ToolExecutionInput) => PreToolDecision } = {}) {
    const ctx = new Context();
    const tools = fakeTools(ctx, options.decide);
    provideValue(ctx, 'tools' as never, tools as never);
    await ctx.plugin(kernelPlugin);
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5000 });
    const approvalFiber = ctx.plugin(
        { inject: [], apply: approvalPlugin } as never,
        { timeoutMs: options.approvalTimeoutMs ?? 5000 },
    );
    await approvalFiber;
    await ctx.plugin({ inject: nodeTool.inject, apply: nodeTool.apply } as never);
    return { ctx, engine: ctx.get(FlowEngineToken)!, approval: ctx.get(FlowApprovalToken)!, tools };
}

/** 等挂起的请求数达到 count / wait until `count` requests are pending */
async function waitPending(approval: { pending(): readonly FlowApprovalRequest[] }, count = 1): Promise<FlowApprovalRequest[]> {
    for (let index = 0; index < 300; index += 1) {
        const pending = approval.pending();
        if (pending.length >= count) return pending;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`expected ${count} pending approval(s)`);
}

describe('tool node approval (real events)', () => {
    it('suspends on an ask, allows the call, completes, and records the audit', async () => {
        const { engine, approval } = await makeStack();
        await engine.registerFlow({
            id: 'ask-flow',
            nodes: [{ id: 'run', type: 'tool', config: { tool: 'gated' } }],
            edges: [],
        });
        const handle = engine.run('ask-flow');
        const [request] = await waitPending(approval);
        expect(request).toMatchObject({ action: 'gated', reason: 'policy asks', kind: 'tool' });
        expect(engine.getRun(handle.runId)!.nodes['run']!.status).toBe('awaiting-approval');
        approval.answer(request!.id, { runId: handle.runId, decision: 'allow', actor: 'alice' });
        const result = await handle.awaitCompletion();
        expect(result.status).toBe('completed');
        expect(result.nodes['run']!.approvals![0]!.outcome).toMatchObject({ decision: 'allow', decidedBy: 'alice' });
    });

    it('fails with NODE_PERMISSION_DENIED when the human denies the ask', async () => {
        const { engine, approval } = await makeStack();
        await engine.registerFlow({
            id: 'ask-deny',
            nodes: [{ id: 'run', type: 'tool', config: { tool: 'gated' } }],
            edges: [],
        });
        const handle = engine.run('ask-deny');
        const [request] = await waitPending(approval);
        approval.answer(request!.id, { runId: handle.runId, decision: 'deny', actor: 'bob' });
        const result = await handle.awaitCompletion();
        expect(result.status).toBe('failed');
        expect(result.nodes['run']!.error).toMatchObject({ code: APPROVAL_CODES.denied });
        expect(result.nodes['run']!.error!.message).toBe('the user rejected tool "gated"');
        expect(result.nodes['run']!.approvals![0]!.outcome).toMatchObject({ decision: 'deny', decidedBy: 'bob' });
    });

    it('auto-denies after the approval timeout', async () => {
        const { engine } = await makeStack({ approvalTimeoutMs: 25 });
        await engine.registerFlow({
            id: 'ask-timeout',
            nodes: [{ id: 'run', type: 'tool', config: { tool: 'gated' } }],
            edges: [],
        });
        const result = await engine.run('ask-timeout').awaitCompletion();
        expect(result.status).toBe('failed');
        expect(result.nodes['run']!.error).toMatchObject({ code: APPROVAL_CODES.timeout });
    });

    it('releases the suspended call when the run is cancelled', async () => {
        const { engine, approval } = await makeStack();
        await engine.registerFlow({
            id: 'ask-cancel',
            nodes: [{ id: 'run', type: 'tool', config: { tool: 'gated' } }],
            edges: [],
        });
        const handle = engine.run('ask-cancel');
        await waitPending(approval);
        handle.cancel();
        const result = await handle.awaitCompletion();
        expect(result.status).toBe('cancelled');
        expect(result.nodes['run']!.status).toBe('cancelled');
        expect(approval.pending()).toEqual([]);
    });

    it('keeps two concurrent tool approvals on the right nodes', async () => {
        const { engine, approval } = await makeStack();
        await engine.registerFlow({
            id: 'ask-two',
            nodes: [
                { id: 'left', type: 'tool', config: { tool: 'gated-left' } },
                { id: 'right', type: 'tool', config: { tool: 'gated-right' } },
            ],
            edges: [],
        });
        const handle = engine.run('ask-two');
        const pending = await waitPending(approval, 2);
        const left = pending.find((request) => request.action === 'gated-left')!;
        const right = pending.find((request) => request.action === 'gated-right')!;
        approval.answer(right.id, { runId: handle.runId, decision: 'deny', actor: 'bob' });
        approval.answer(left.id, { runId: handle.runId, decision: 'allow', actor: 'alice' });
        const result = await handle.awaitCompletion();
        expect(result.nodes['left']!.status).toBe('completed');
        expect(result.nodes['right']!.status).toBe('failed');
        expect(result.nodes['left']!.approvals![0]!.outcome).toMatchObject({ decision: 'allow', decidedBy: 'alice' });
        expect(result.nodes['right']!.approvals![0]!.outcome).toMatchObject({ decision: 'deny', decidedBy: 'bob' });
    });
});
