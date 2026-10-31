/**
 * Tool-node approval, unit half: the approval gate turns the tools pipeline's
 * `ask` into a node approval question (pass-through for non-flow calls and
 * nodes without an approval face, stable codes for deny/timeout, per-signal
 * matching for concurrent calls), the explicit require config asks before the
 * call, and argument summaries stay readable and bounded. The composed
 * behavior over real events lives in approval-real-events.spec.ts.
 *
 * tool 节点授权的「单元」半边：授权门把 tools 管线的 `ask` 转成节点授权问题（非 flow
 * 调用与无授权面节点原样放行、deny/timeout 的稳定错误码、并发调用按 signal 精确匹配）、
 * 显式 require 配置在调用前询问，参数摘要可读且有界。真实事件路径上的组合行为在
 * approval-real-events.spec.ts。
 */

import { describe, expect, it } from 'vitest';
import type { PreToolDecision, ToolExecutionInput } from '@deepseek-ai/dsh-tools';
import {
    APPROVAL_CODES,
    createApprovalGate,
    createToolHandler,
    summarizeArguments,
} from '../src/index.js';
import type { ActiveToolCall, ToolInvoker } from '../src/index.js';
import { allow, approvalPort, deny, success, timeout } from './approval-helpers.ts';

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
