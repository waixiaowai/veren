/**
 * @deepseek-ai/dsh-graph-flow-approval —— flow 节点授权服务。
 *
 * 它实现 flow-api 的 FlowApprovalBroker：节点 handler 的授权请求在这里真正挂起，
 * 直到界面回答、超时或运行取消。每条请求一次性有效、只对当前 run 的当前节点尝试，
 * 结果与回答者/时间一起作为审计事实广播（不改变任何全局策略）。
 *
 * @deepseek-ai/dsh-graph-flow-approval — the flow-node approval service.
 *
 * It implements flow-api's FlowApprovalBroker: a node handler's request really
 * suspends here until an interface answers, the timeout fires, or the run
 * cancels. Every request is single-use and scoped to one node attempt of one
 * run; the outcome plus actor/time is broadcast as the audit fact (it changes
 * no global policy).
 *
 * @module @deepseek-ai/dsh-graph-flow-approval
 */

import { randomUUID } from 'node:crypto';
import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api';
import type {
    FlowApprovalAnswer,
    FlowApprovalBroker,
    FlowApprovalOpenContext,
    FlowApprovalOutcome,
    FlowApprovalRequest,
    FlowNodeApprovalInput,
} from '@deepseek-ai/dsh-graph-flow-api';

export { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api';

/** 服务配置 / the service config */
export interface FlowApprovalConfig {
    /**
     * 默认授权等待上限（毫秒，0 = 不超时）。等待期间节点执行超时暂停，
     * 因此这个值只约束人的思考时间。
     * Default approval wait limit (ms; 0 = no timeout). The node execution
     * timeout is paused while waiting, so this bounds the human's decision only.
     */
    timeoutMs: number;
}

/** 插件配置 schema / the plugin config schema */
export const Config: z<FlowApprovalConfig> = z.object({ timeoutMs: z.number().min(0).default(60_000) });

/** 一条挂起请求的内部条目 / the internal entry of one pending request */
interface PendingApproval {
    readonly request: FlowApprovalRequest;
    /** 一次性落定；emit=false 用于运行取消时的静默撤销 / settle once; emit=false withdraws silently */
    readonly settle: (outcome: FlowApprovalOutcome, emit: boolean) => void;
}

/** 授权生命周期回调 / the approval lifecycle callbacks */
interface ApprovalHooks {
    /** 一条请求已挂起（公开事实）/ one request is now pending (public fact) */
    readonly opened: (request: FlowApprovalRequest) => void;
    /** 一条请求已落定（审计传播）/ one request settled (audit propagation) */
    readonly settled: (request: FlowApprovalRequest, outcome: FlowApprovalOutcome) => void;
}

/**
 * 一条请求的完整生命周期：登记、计时、随取消撤销、一次性落定。
 * The complete lifecycle of one request: register, time, withdraw on cancel,
 * settle exactly once.
 */
export class ApprovalLifecycle implements FlowApprovalBroker {
    private readonly pendingRequests = new Map<string, PendingApproval>();

    /**
     * @param hooks - open/settle notification channels.
     * @param timeoutMs - the default wait limit; 0 disables it.
     */
    constructor(
        private readonly hooks: ApprovalHooks,
        private readonly timeoutMs: number,
    ) {}

    /** @inheritdoc */
    open(input: FlowNodeApprovalInput, context: FlowApprovalOpenContext): Promise<FlowApprovalOutcome> {
        if (context.signal?.aborted === true) {
            // 已取消的运行不再产生问题 / a cancelled run raises no question
            return Promise.resolve({ decision: 'deny', via: 'cancel', decidedAt: Date.now() });
        }
        const now = Date.now();
        const timeoutMs = input.timeoutMs ?? this.timeoutMs;
        const request = this.buildRequest(input, context, timeoutMs, now);
        return new Promise<FlowApprovalOutcome>((resolve) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const onAbort = (): void => {
                settle({ decision: 'deny', via: 'cancel', decidedAt: Date.now() }, true);
            };
            const settle = (outcome: FlowApprovalOutcome, emit: boolean): void => {
                if (this.pendingRequests.get(request.id) !== entry) return;
                this.pendingRequests.delete(request.id);
                if (timer !== undefined) clearTimeout(timer);
                context.signal?.removeEventListener('abort', onAbort);
                if (emit) this.hooks.settled(request, outcome);
                resolve(outcome);
            };
            const entry: PendingApproval = { request, settle };
            this.pendingRequests.set(request.id, entry);
            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    settle({ decision: 'deny', via: 'timeout', decidedAt: Date.now() }, true);
                }, timeoutMs);
            }
            context.signal?.addEventListener('abort', onAbort, { once: true });
            this.hooks.opened(request);
        });
    }

    /** @inheritdoc */
    answer(requestId: string, answer: FlowApprovalAnswer): boolean {
        const entry = this.pendingRequests.get(requestId);
        if (entry === undefined || entry.request.runId !== answer.runId) return false;
        entry.settle({
            decision: answer.decision,
            via: 'user',
            decidedBy: actorOf(answer.actor),
            decidedAt: Date.now(),
        }, true);
        return true;
    }

    /** @inheritdoc */
    pending(): readonly FlowApprovalRequest[] {
        return [...this.pendingRequests.values()]
            .map((entry) => entry.request)
            .sort((a, b) => a.requestedAt - b.requestedAt);
    }

    /**
     * Withdraw every pending request (plugin unload / HMR): the promises settle
     * as cancelled and their timers/listeners are released.
     * 撤销全部挂起请求（插件卸载 / HMR）：Promise 以 cancelled 落定，计时器与监听器释放。
     * @returns the number of withdrawn requests.
     */
    cancelAll(): number {
        const entries = [...this.pendingRequests.values()];
        for (const entry of entries) {
            entry.settle({ decision: 'deny', via: 'cancel', decidedAt: Date.now() }, true);
        }
        return entries.length;
    }

    /** 组装可序列化请求 / build the serializable request */
    private buildRequest(
        input: FlowNodeApprovalInput,
        context: FlowApprovalOpenContext,
        timeoutMs: number,
        now: number,
    ): FlowApprovalRequest {
        return {
            id: randomUUID(),
            flowId: context.flowId,
            runId: context.runId,
            nodeId: context.nodeId,
            attempt: context.attempt,
            kind: input.kind,
            action: input.action,
            ...input.reason === undefined ? {} : { reason: input.reason },
            ...input.summary === undefined ? {} : { summary: input.summary },
            requestedAt: now,
            ...timeoutMs > 0 ? { expiresAt: now + timeoutMs } : {},
        };
    }
}

/** 回答者标识：空白时回落到画布用户 / the actor identity, falling back to the canvas user */
function actorOf(actor: string | undefined): string {
    const trimmed = actor?.trim();
    return trimmed === undefined || trimmed === '' ? 'canvas-user' : trimmed;
}

/**
 * 授权服务：把生命周期挂在插件 fiber 上，事件发在构造 context（Remote 调用方
 * 重绑 `this.ctx` 时也不会丢失监听者）。
 * The approval service: its lifecycle hangs off the plugin fiber and its events
 * are emitted on the construction context (so a Remote caller rebinding
 * `this.ctx` cannot hide them from listeners).
 */
export class FlowApprovalService extends Service implements FlowApprovalBroker {
    private readonly ownerCtx: Context;
    private readonly lifecycle: ApprovalLifecycle;

    /**
     * @param ctx - plugin context (the stable owner of this service's events).
     * @param config - the normalized timeout policy.
     */
    constructor(ctx: Context, config: FlowApprovalConfig) {
        super(ctx, FlowApprovalToken);
        this.ownerCtx = ctx;
        this.lifecycle = new ApprovalLifecycle({
            opened: (request) => { this.ownerCtx.emit('flow/approval-requested', request); },
            settled: (request, outcome) => { this.ownerCtx.emit('flow/approval-decided', { request, outcome }); },
        }, config.timeoutMs);
        // 卸载时撤销挂起请求，避免计时器/监听器泄漏在已销毁的插件之外。
        // Withdraw pending requests on unload so timers and listeners never
        // outlive the disposed plugin.
        ctx.effect(() => () => { this.lifecycle.cancelAll(); }, 'flow-approval: pending requests');
    }

    /** @inheritdoc */
    open(input: FlowNodeApprovalInput, context: FlowApprovalOpenContext): Promise<FlowApprovalOutcome> {
        return this.lifecycle.open(input, context);
    }

    /** @inheritdoc */
    answer(requestId: string, answer: FlowApprovalAnswer): boolean {
        return this.lifecycle.answer(requestId, answer);
    }

    /** @inheritdoc */
    pending(): readonly FlowApprovalRequest[] {
        return this.lifecycle.pending();
    }
}

/** 插件名（即授权服务令牌）/ the plugin name (the approval service token) */
export const name = FlowApprovalToken;
/** 无注入依赖 / no injected capabilities */
export const inject = [] as const;
/** 提供授权服务能力 / provides the approval capability */
export const provide = [FlowApprovalToken] as const;

/**
 * 插件入口：构造即注册，随 fiber 卸载注销。
 * The plugin entry: constructing registers the service; it unloads with its fiber.
 * @param ctx - plugin context.
 * @param config - raw config validated by {@link Config}.
 */
export const apply = (ctx: Context, config: FlowApprovalConfig = { timeoutMs: 60_000 }): void => {
    new FlowApprovalService(ctx, Config(config));
};
