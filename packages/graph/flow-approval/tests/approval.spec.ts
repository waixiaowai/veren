/**
 * 授权服务语义：一次性回答、按 run 隔离、超时自动拒绝、取消撤销、审计字段、
 * 并发请求互不串号，以及插件注册/卸载。
 *
 * Approval service semantics: single-use answers, run scoping, auto-deny
 * timeout, cancellation, audit fields, concurrent-request isolation, and
 * plugin registration/unregistration.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { FlowApprovalOutcome, FlowApprovalRequest } from '@deepseek-ai/dsh-graph-flow-api';
import { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api';
import {
    apply as approvalPlugin,
    ApprovalLifecycle,
    FlowApprovalService,
    type FlowApprovalConfig,
} from '../src/index.js';

/** 收集生命周期回调的测试替身 / a test double collecting lifecycle callbacks */
function lifecycle(timeoutMs = 0) {
    const opened: FlowApprovalRequest[] = [];
    const settled: Array<{ request: FlowApprovalRequest; outcome: FlowApprovalOutcome }> = [];
    const core = new ApprovalLifecycle({
        opened: (request) => opened.push(request),
        settled: (request, outcome) => settled.push({ request, outcome }),
    }, timeoutMs);
    return { core, opened, settled };
}

/** 一次请求的固定身份 / a fixed request identity */
function identity(runId: string, nodeId = 'node-a', attempt = 1) {
    return { flowId: 'flow-a' as never, runId: runId as never, nodeId: nodeId as never, attempt };
}

/** 等待一个 pending 请求（开放是同步的，这里只表达意图）/ wait for a pending request (opening is synchronous; this only expresses intent) */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ApprovalLifecycle', () => {
    it('suspends a request until the human answer and records who/when', async () => {
        const { core, opened, settled } = lifecycle();
        const pending = core.open({ kind: 'tool', action: 'bash', reason: 'writes files', summary: '{"command":"rm"}' }, identity('run-1'));
        expect(opened).toHaveLength(1);
        expect(opened[0]).toMatchObject({
            runId: 'run-1', nodeId: 'node-a', attempt: 1, kind: 'tool', action: 'bash',
            reason: 'writes files', summary: '{"command":"rm"}',
        });
        expect(opened[0]!.expiresAt).toBeUndefined();
        expect(core.pending()).toHaveLength(1);

        expect(core.answer(opened[0]!.id, { runId: 'run-1', decision: 'allow', actor: 'alice' })).toBe(true);
        const outcome = await pending;
        expect(outcome).toMatchObject({ decision: 'allow', via: 'user', decidedBy: 'alice' });
        expect(outcome.decidedAt).toBeGreaterThan(0);
        expect(core.pending()).toEqual([]);
        expect(settled).toHaveLength(1);
        expect(settled[0]!.outcome).toBe(outcome);
    });

    it('answers only the request of the same run and only once', async () => {
        const { core, opened } = lifecycle();
        const pending = core.open({ kind: 'node', action: 'deploy' }, identity('run-1'));
        const id = opened[0]!.id;
        expect(core.answer(id, { runId: 'run-2', decision: 'allow' })).toBe(false);
        expect(core.pending()).toHaveLength(1);
        expect(core.answer(id, { runId: 'run-1', decision: 'deny' })).toBe(true);
        expect(core.answer(id, { runId: 'run-1', decision: 'allow' })).toBe(false);
        await expect(pending).resolves.toMatchObject({ decision: 'deny', via: 'user' });
    });

    it('auto-denies on timeout with no actor and a recorded deadline', async () => {
        const { core, opened } = lifecycle(20);
        const pending = core.open({ kind: 'tool', action: 'pwsh' }, identity('run-t'));
        expect(opened[0]!.expiresAt).toBeGreaterThanOrEqual(opened[0]!.requestedAt + 20);
        const outcome = await pending;
        expect(outcome).toMatchObject({ decision: 'deny', via: 'timeout' });
        expect(outcome.decidedBy).toBeUndefined();
        expect(core.pending()).toEqual([]);
        expect(core.answer(opened[0]!.id, { runId: 'run-t', decision: 'allow' })).toBe(false);
    });

    it('lets a per-request timeout override the service default', async () => {
        const { core } = lifecycle(60_000);
        const outcome = await core.open({ kind: 'tool', action: 'bash', timeoutMs: 10 }, identity('run-o'));
        expect(outcome.via).toBe('timeout');
    });

    it('withdraws a pending request when the run signal aborts', async () => {
        const { core, opened } = lifecycle();
        const controller = new AbortController();
        const pending = core.open({ kind: 'tool', action: 'bash' }, { ...identity('run-c'), signal: controller.signal });
        controller.abort();
        await expect(pending).resolves.toMatchObject({ decision: 'deny', via: 'cancel' });
        expect(core.pending()).toEqual([]);
        expect(core.answer(opened[0]!.id, { runId: 'run-c', decision: 'allow' })).toBe(false);
    });

    it('does not raise a question for an already-cancelled run', async () => {
        const { core, opened } = lifecycle();
        const controller = new AbortController();
        controller.abort();
        const outcome = await core.open({ kind: 'tool', action: 'bash' }, { ...identity('run-x'), signal: controller.signal });
        expect(outcome.via).toBe('cancel');
        expect(opened).toEqual([]);
    });

    it('never auto-denies when the timeout is disabled', async () => {
        const { core } = lifecycle(0);
        void core.open({ kind: 'tool', action: 'bash' }, identity('run-n'));
        await tick();
        expect(core.pending()).toHaveLength(1);
    });

    it('keeps concurrent requests independent and answers them out of order', async () => {
        const { core, opened } = lifecycle();
        const first = core.open({ kind: 'tool', action: 'bash' }, identity('run-a', 'node-1'));
        const second = core.open({ kind: 'tool', action: 'pwsh' }, identity('run-b', 'node-2'));
        const [one, two] = opened;
        expect(core.pending()).toHaveLength(2);

        expect(core.answer(two!.id, { runId: 'run-b', decision: 'deny', actor: 'bob' })).toBe(true);
        await expect(second).resolves.toMatchObject({ decision: 'deny', decidedBy: 'bob' });
        expect(core.pending().map((request) => request.id)).toEqual([one!.id]);

        expect(core.answer(one!.id, { runId: 'run-a', decision: 'allow' })).toBe(true);
        await expect(first).resolves.toMatchObject({ decision: 'allow' });
        // 串号会让 first 拿到 deny 或 second 拿到 allow；这里两者互不影响。
        // A cross-wire would give first the deny or second the allow.
        expect(core.pending()).toEqual([]);
    });

    it('falls back to the canvas user when the actor is blank', async () => {
        const { core, opened } = lifecycle();
        const pending = core.open({ kind: 'tool', action: 'bash' }, identity('run-u'));
        core.answer(opened[0]!.id, { runId: 'run-u', decision: 'allow', actor: '   ' });
        await expect(pending).resolves.toMatchObject({ decidedBy: 'canvas-user' });
    });
});

describe('FlowApprovalService plugin', () => {
    it('provides the token, emits on the owner context, and unregisters with its fiber', async () => {
        const ctx = new Context();
        const requested: FlowApprovalRequest[] = [];
        const decided: Array<{ request: FlowApprovalRequest; outcome: FlowApprovalOutcome }> = [];
        ctx.on('flow/approval-requested', (request) => requested.push(request));
        ctx.on('flow/approval-decided', (payload) => decided.push(payload));

        const fiber = ctx.plugin({ inject: [], apply: approvalPlugin } as never, { timeoutMs: 0 } satisfies FlowApprovalConfig);
        await fiber;
        const service = ctx.get(FlowApprovalToken)!;
        expect(service).toBeInstanceOf(FlowApprovalService);

        const pending = service.open({ kind: 'tool', action: 'bash' }, identity('run-e'));
        expect(requested).toHaveLength(1);
        service.answer(requested[0]!.id, { runId: 'run-e', decision: 'allow', actor: 'eve' });
        await expect(pending).resolves.toMatchObject({ decidedBy: 'eve' });
        expect(decided).toHaveLength(1);
        expect(decided[0]!.outcome.decision).toBe('allow');

        await fiber.dispose();
        expect(ctx.get(FlowApprovalToken)).toBeUndefined();
    });

    it('emits a decided event with via timeout so a canvas can drop the card', async () => {
        const ctx = new Context();
        const decided: Array<{ outcome: FlowApprovalOutcome }> = [];
        ctx.on('flow/approval-decided', (payload) => decided.push(payload));
        const fiber = ctx.plugin({ inject: [], apply: approvalPlugin } as never, { timeoutMs: 10 });
        await fiber;
        await ctx.get(FlowApprovalToken)!.open({ kind: 'tool', action: 'bash' }, identity('run-to'));
        expect(decided).toHaveLength(1);
        expect(decided[0]!.outcome.via).toBe('timeout');
        await fiber.dispose();
    });

    it('uses a per-request timeout override (0 disables it)', async () => {
        const ctx = new Context();
        const fiber = ctx.plugin({ inject: [], apply: approvalPlugin } as never, { timeoutMs: 10 });
        await fiber;
        const service = ctx.get(FlowApprovalToken)!;
        void service.open({ kind: 'tool', action: 'bash', timeoutMs: 0 }, identity('run-z'));
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(service.pending()).toHaveLength(1);
        await fiber.dispose();
    });

    it('withdraws every pending request when the plugin unloads', async () => {
        const ctx = new Context();
        const fiber = ctx.plugin({ inject: [], apply: approvalPlugin } as never, { timeoutMs: 0 });
        await fiber;
        const service = ctx.get(FlowApprovalToken)!;
        const pending = service.open({ kind: 'tool', action: 'bash' }, identity('run-unload'));
        expect(service.pending()).toHaveLength(1);
        await fiber.dispose();
        await expect(pending).resolves.toMatchObject({ decision: 'deny', via: 'cancel' });
        expect(ctx.get(FlowApprovalToken)).toBeUndefined();
    });
});
