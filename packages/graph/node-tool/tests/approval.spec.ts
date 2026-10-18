/**
 * tool 节点授权：把 tools 管线的 `ask` 转成节点授权问题、显式 require 配置、
 * 稳定错误码、并发调用按 signal 精确匹配，以及真实事件路径上的组合行为。
 *
 * Tool-node approval: turning the tools pipeline's `ask` into a node approval
 * question, the explicit require config, stable error codes, per-signal
 * matching for concurrent calls, and the composed behavior over real events.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { provideValue } from '@veren/core';
import type { PreToolDecision, ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core';
import { apply as enginePlugin, FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine';
import { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api';
import type { FlowApprovalOutcome, FlowApprovalRequest, FlowNodeApprovalPort } from '@deepseek-ai/dsh-graph-flow-api';
import { apply as approvalPlugin } from '@deepseek-ai/dsh-graph-flow-approval';
import * as nodeTool from '../src/index.js';
import {
    APPROVAL_CODES,
    createApprovalGate,
    createToolHandler,
    summarizeArguments,
} from '../src/index.js';
import type { ActiveToolCall, ToolInvoker } from '../src/index.js';

/** 成功结果构造（补齐必填 content）/ build a success result (content required) */
const success = (value: unknown): ToolExecutionResult => ({ isError: false, value, content: [] } as ToolExecutionResult);

/** 失败结果构造（补齐必填 content）/ build a failure result (content required) */
const failure = (message: string, code?: string): ToolExecutionResult => ({
    isError: true,
    error: { message, info: code ? { name: 'FlowApproval', code } : undefined },
    content: [],
} as ToolExecutionResult);

/** 可编程授权面 / a programmable approval face */
function approvalPort(
    outcome: FlowApprovalOutcome | (() => Promise<FlowApprovalOutcome>),
    seen: FlowApprovalRequest['action'][] = [],
) {
    const request = async (input: { action: string }) => {
        seen.push(input.action);
        return typeof outcome === 'function' ? outcome() : outcome;
    };
    return { request } as FlowNodeApprovalPort & { request: typeof request };
}

/** 结果快捷构造 / outcome shortcuts */
const allow = (): FlowApprovalOutcome => ({ decision: 'allow', via: 'user', decidedBy: 'alice', decidedAt: 1 });
const deny = (): FlowApprovalOutcome => ({ decision: 'deny', via: 'user', decidedBy: 'bob', decidedAt: 2 });
const timeout = (): FlowApprovalOutcome => ({ decision: 'deny', via: 'timeout', decidedAt: 3 });

/** 一次构造 exec 的最少字段 / the minimal exec fields */
function execOf(signal: AbortSignal, name = 'gated', args: unknown = { command: 'echo hi' }) {
    return { name, arguments: args, signal, callId: 'call-1' } as never;
}

describe('approval gate', () => {
    it('turns a downstream ask into an allow decision for the flow call', async () => {
        const controller = new AbortController();
        const seen: string[] = [];
        const calls = new Map<AbortSignal, ActiveToolCall>([
            [controller.signal, { approval: approvalPort(allow(), seen), tool: 'gated' }],
        ]);
        const gate = createApprovalGate(calls);
        const decision = await gate(execOf(controller.signal), async () => ({ kind: 'ask', reason: 'policy asked' }));
        expect(decision).toEqual({ kind: 'allow' });
        expect(seen).toEqual(['gated']);
    });

    it('passes non-flow calls through untouched', async () => {
        const calls = new Map<AbortSignal, ActiveToolCall>();
        const gate = createApprovalGate(calls);
        const asked: PreToolDecision = { kind: 'ask', reason: 'agent policy' };
        await expect(gate(execOf(new AbortController().signal), async () => asked)).resolves.toBe(asked);
    });

    it('leaves the ask to the tools pipeline when the node has no approval face (fail-closed stays)', async () => {
        const controller = new AbortController();
        const calls = new Map<AbortSignal, ActiveToolCall>([[controller.signal, { tool: 'gated' }]]);
        const gate = createApprovalGate(calls);
        const asked: PreToolDecision = { kind: 'ask' };
        await expect(gate(execOf(controller.signal), async () => asked)).resolves.toBe(asked);
    });

    it('maps denial and timeout to stable codes with the human reason', async () => {
        const controller = new AbortController();
        const calls = new Map<AbortSignal, ActiveToolCall>([
            [controller.signal, { approval: approvalPort(deny()), tool: 'gated' }],
        ]);
        const gate = createApprovalGate(calls);
        await expect(gate(execOf(controller.signal), async () => ({ kind: 'ask' }))).resolves.toMatchObject({
            kind: 'deny',
            reason: 'the user rejected tool "gated"',
            info: { name: 'FlowApproval', code: APPROVAL_CODES.denied },
        });

        calls.set(controller.signal, { approval: approvalPort(timeout()), tool: 'gated' });
        await expect(gate(execOf(controller.signal), async () => ({ kind: 'ask' }))).resolves.toMatchObject({
            kind: 'deny',
            info: { code: APPROVAL_CODES.timeout },
        });
    });

    it('keeps concurrent signals independent', async () => {
        const left = new AbortController();
        const right = new AbortController();
        const calls = new Map<AbortSignal, ActiveToolCall>([
            [left.signal, { approval: approvalPort(async () => deny()), tool: 'left' }],
            [right.signal, { approval: approvalPort(async () => allow()), tool: 'right' }],
        ]);
        const gate = createApprovalGate(calls);
        const [leftDecision, rightDecision] = await Promise.all([
            gate(execOf(left.signal, 'left'), async () => ({ kind: 'ask' })),
            gate(execOf(right.signal, 'right'), async () => ({ kind: 'ask' })),
        ]);
        expect(leftDecision).toMatchObject({ kind: 'deny', info: { code: APPROVAL_CODES.denied } });
        expect(rightDecision).toEqual({ kind: 'allow' });
    });

    it('summarizes arguments readably and bounds them', () => {
        expect(summarizeArguments({ command: 'echo hi' })).toBe('{\n  "command": "echo hi"\n}');
        const long = summarizeArguments({ text: 'x'.repeat(5000) });
        expect(long.length).toBeLessThanOrEqual(1201);
        expect(long.endsWith('…')).toBe(true);
    });
});

describe('explicit approval config', () => {
    it('asks before the call and skips the tool on denial', async () => {
        let invoked = 0;
        const invoker: ToolInvoker = async () => {
            invoked += 1;
            return success({ ok: true });
        };
        const seen: string[] = [];
        const handler = createToolHandler(invoker);
        const config = (handler.config as unknown as (data: unknown) => unknown)({
            tool: 'danger',
            approval: { require: true, reason: 'writes outside', timeoutMs: 1000 },
        });
        const port = approvalPort(deny(), seen);
        const nctx = {
            config,
            signal: new AbortController().signal,
            attempt: 1,
            approval: port,
        };
        await expect(handler.execute({ path: '/etc' }, nctx as never)).rejects.toMatchObject({
            code: APPROVAL_CODES.denied,
        });
        expect(invoked).toBe(0);
        expect(seen).toEqual(['danger']);
    });

    it('proceeds after allow and still runs through the invoker', async () => {
        let invoked = 0;
        const invoker: ToolInvoker = async (call: ToolExecutionInput) => {
            invoked += 1;
            expect(call.name).toBe('danger');
            return success({ ok: true });
        };
        const handler = createToolHandler(invoker);
        const config = (handler.config as unknown as (data: unknown) => unknown)({
            tool: 'danger',
            approval: { require: true },
        });
        const result = await handler.execute({ path: '/tmp' }, {
            config,
            signal: new AbortController().signal,
            attempt: 1,
            approval: approvalPort(allow()),
        } as never);
        expect(result).toEqual({ ok: true });
        expect(invoked).toBe(1);
    });
});

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
