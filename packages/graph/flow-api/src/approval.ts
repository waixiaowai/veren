/**
 * flow 节点授权接缝的类型面：节点 handler 通过 NodeExecuteContext.approval
 * 请求授权，flow-approval 提供实现，画布等界面消费 pending/audit 并回答。
 *
 * 这是通用能力，不是 tool 节点专用：任何节点类型都可以请求授权；请求只对
 * 当前 run 的当前节点尝试有效（一次性、带超时、可被取消），不会变成全局放行。
 *
 * Type surface of the flow-node approval seam: a node handler asks through
 * NodeExecuteContext.approval, @deepseek-ai/dsh-graph-flow-approval provides the
 * implementation, and canvases consume the pending request plus its audit and
 * answer it. The capability is generic, not tool-node specific: any node type
 * may ask. A grant covers only one node attempt of one run (single use, timed,
 * cancellable) and never becomes a global permission.
 *
 * @module @deepseek-ai/dsh-graph-flow-api/approval
 */

import type { FlowId, NodeId, RunId } from './types.js';

/** 一次授权的结果：同意或拒绝 / the outcome of one approval: allow or deny */
export type FlowApprovalDecision = 'allow' | 'deny';

/** 结果来源：用户、超时、取消、无可用通道 / why the outcome happened */
export type FlowApprovalVia = 'user' | 'timeout' | 'cancel' | 'unavailable';

/** 授权结果（含最小审计字段）/ the approval outcome with the minimum audit facts */
export interface FlowApprovalOutcome {
    readonly decision: FlowApprovalDecision;
    /** 结果来源 / how the outcome was produced */
    readonly via: FlowApprovalVia;
    /** 回答者标识（超时/取消/无通道时缺省）/ who answered (absent for timeout/cancel/unavailable) */
    readonly decidedBy?: string;
    /** 决定时间（epoch ms）/ when the decision was made (epoch ms) */
    readonly decidedAt: number;
}

/**
 * 一条挂起的授权请求（可序列化，画布直接渲染）。
 * A pending approval request (serializable; a canvas renders it directly).
 */
export interface FlowApprovalRequest {
    /** 请求 id：单次有效，回答后用尽 / request id: single use, consumed by the answer */
    readonly id: string;
    readonly flowId: FlowId;
    readonly runId: RunId;
    readonly nodeId: NodeId;
    /** 当前节点尝试序号（重试从 1 起）/ the node attempt (retries start at 1) */
    readonly attempt: number;
    /** 动作类别，例如 'tool' / the action kind, e.g. 'tool' */
    readonly kind: string;
    /** 动作名称，例如工具名 / the action name, e.g. the tool name */
    readonly action: string;
    /** 为什么需要授权（ask 策略给出的原因）/ why approval is needed */
    readonly reason?: string;
    /** 参数要点（已截断的可读摘要）/ the key points of the arguments (a bounded summary) */
    readonly summary?: string;
    /** 请求产生时间（epoch ms）/ when the request was raised (epoch ms) */
    readonly requestedAt: number;
    /** 超时时间点（未配置超时则缺省）/ the deadline (absent without a timeout) */
    readonly expiresAt?: number;
}

/** 节点 handler 发起的授权输入 / the approval input raised by a node handler */
export interface FlowNodeApprovalInput {
    /** 动作类别，例如 'tool' / the action kind, e.g. 'tool' */
    readonly kind: string;
    /** 动作名称，例如工具名 / the action name, e.g. the tool name */
    readonly action: string;
    /** 为什么需要授权 / why approval is needed */
    readonly reason?: string;
    /** 参数要点 / the key points of the arguments */
    readonly summary?: string;
    /** 本次请求的超时覆盖（毫秒，0 = 不超时）/ per-request timeout override (ms; 0 = none) */
    readonly timeoutMs?: number;
}

/**
 * 一条授权的审计记录：请求 + 最终结果（结果未定时为 pending）。
 * One approval audit record: the request plus its outcome (absent while pending).
 */
export interface FlowApprovalAudit {
    readonly request: FlowApprovalRequest;
    readonly outcome?: FlowApprovalOutcome;
}

/** 节点作用域内的授权请求面 / the approval face available inside a node scope */
export interface FlowNodeApprovalPort {
    /**
     * 请求授权；挂起直到有人回答、超时或运行被取消。
     * Ask for approval; suspends until answered, timed out, or the run cancels.
     * @param input - what the node is asking to do.
     * @returns the closed outcome (never rejects for a normal denial).
     */
    request(input: FlowNodeApprovalInput): Promise<FlowApprovalOutcome>;
}

/** 打开请求时的运行身份 / run identity attached when a request opens */
export interface FlowApprovalOpenContext {
    readonly flowId: FlowId;
    readonly runId: RunId;
    readonly nodeId: NodeId;
    readonly attempt: number;
    /**
     * 取消信号：中止即撤销问题，请求以 `via: 'cancel'` 结束。
     * Cancellation signal: aborting withdraws the question, which settles `via: 'cancel'`.
     */
    readonly signal?: AbortSignal;
}

/** 回答一条挂起请求 / answer one pending request */
export interface FlowApprovalAnswer {
    /** 必须与请求的 runId 一致，防止跨 run 误答 / must match the request's runId (no cross-run answers) */
    readonly runId: string;
    readonly decision: FlowApprovalDecision;
    /** 回答者标识（审计最小集）/ who answered (the minimum audit fact) */
    readonly actor?: string;
}

/**
 * 授权服务能力：flow-approval 提供，引擎把 `open` 暴露成节点授权面，
 * 画布等界面通过 `answer` 回答。回答只对仍挂起且 runId 匹配的请求生效。
 * The approval capability: flow-approval provides it, the engine exposes `open`
 * as the node approval face, and canvases answer through `answer`. An answer
 * applies only to a still-pending request whose runId matches.
 */
export interface FlowApprovalBroker {
    /**
     * 打开一条授权请求并等待结果。
     * Open one approval request and await its outcome.
     * @param input - what the node is asking to do.
     * @param context - the run identity and cancellation signal.
     * @returns the closed outcome.
     */
    open(input: FlowNodeApprovalInput, context: FlowApprovalOpenContext): Promise<FlowApprovalOutcome>;
    /**
     * 回答一条挂起请求；已回答、未知或 runId 不匹配时返回 false。
     * Answer a pending request; false when it is unknown, already answered, or the runId mismatches.
     * @param requestId - the request identity.
     * @param answer - the decision, its run, and the answering actor.
     * @returns whether this call consumed the request.
     */
    answer(requestId: string, answer: FlowApprovalAnswer): boolean;
    /** 当前挂起的请求快照（诊断面）/ a snapshot of the pending requests (diagnostics) */
    pending(): readonly FlowApprovalRequest[];
}

declare module '@deepseek-ai/cordis' {
    interface Events {
        /**
         * 一条授权请求已挂起：引擎据此把节点标成 awaiting-approval，画布据此渲染卡片。
         * One approval request was raised: the engine marks the node
         * awaiting-approval and a canvas renders the card.
         * @mode emit
         */
        'flow/approval-requested'(request: FlowApprovalRequest): void;
        /**
         * 一条授权请求已落定：携带请求与结果（审计最小集的传播通道）。
         * One approval request settled: carries the request and its outcome,
         * the propagation channel for the minimum audit facts.
         * @mode emit
         */
        'flow/approval-decided'(payload: { readonly request: FlowApprovalRequest; readonly outcome: FlowApprovalOutcome }): void;
    }
}
