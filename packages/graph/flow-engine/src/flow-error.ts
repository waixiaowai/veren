/**
 * Structured flow-layer errors: a stable code plus machine-readable fields.
 *
 * Errors are part of the engine's contract — consumers branch on `code`, so
 * codes never churn. Values already carrying a stable code (tool errors) keep
 * it when normalized.
 *
 * flow 层结构化错误：稳定 code 加机器可读字段。错误是引擎契约的一部分——消费方
 * 按 `code` 分支，因此 code 绝不漂移。已带稳定 code 的错误（工具自带错误）在归一化
 * 时保留原 code。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/flow-error
 */

/** flow 层稳定错误码（开放字符串便于透传工具自带 code）/ stable flow-layer error codes (open string so tool codes pass through) */
export type FlowErrorCode =
    | 'FLOW_NOT_FOUND'
    | 'FLOW_CYCLE_DETECTED'
    | 'FLOW_REFERENCE_CYCLE'
    | 'FLOW_CANCELLED'
    | 'NODE_TYPE_NOT_FOUND'
    | 'NODE_CONFIG_INVALID'
    | 'NODE_FAILED'
    | 'NODE_TIMEOUT'
    | (string & {});

/** flow 错误字段 / the flow error fields */
export interface FlowErrorFields {
    flowId?: string;
    runId?: string;
    nodeId?: string;
    detail?: string;
    cause?: unknown;
}

/** flow 结构化错误 / the structured flow error */
export class FlowError extends Error {
    readonly code: FlowErrorCode;
    readonly flowId?: string;
    readonly runId?: string;
    readonly nodeId?: string;
    readonly detail?: string;
    constructor(code: FlowErrorCode, message: string, fields: FlowErrorFields = {}) {
        super(message);
        this.name = 'FlowError';
        this.code = code;
        this.flowId = fields.flowId;
        this.runId = fields.runId;
        this.nodeId = fields.nodeId;
        this.detail = fields.detail;
        if (fields.cause !== undefined) this.cause = fields.cause;
    }
}

/** 构造 flow 错误 / build a flow error */
export function flowError(code: FlowErrorCode, message: string, fields: FlowErrorFields = {}): FlowError {
    return new FlowError(code, message, fields);
}

/** 归一化任意抛出值为 FlowError；已带稳定 code 的错误原样保留 code /
    normalize any thrown value into a FlowError; values already carrying a stable code keep it */
export function toFlowError(cause: unknown, fields: { flowId: string; runId: string; nodeId: string }): FlowError {
    if (cause instanceof FlowError) return cause;
    const code = typeof (cause as { code?: unknown } | null | undefined)?.code === 'string'
        ? (cause as { code: string }).code
        : 'NODE_FAILED';
    return flowError(code, cause instanceof Error ? cause.message : String(cause), { ...fields, cause });
}
