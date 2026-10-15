/**
 * 内核结构化错误：稳定 code + 机器可读字段；misconfiguration fails loud。
 *
 * Structured kernel errors: stable codes plus machine-readable fields;
 * misconfiguration fails loud.
 */

/** 内核错误码（flow 层另有 FLOW_ 与 NODE_ 系列；开放字符串便于上层透传自有 code）/
    kernel error codes (flow layers add FLOW_* and NODE_* codes; the open-string member lets upper layers pass their own codes through) */
export type GraphErrorCode =
    | 'GRAPH_DUPLICATE_NODE'
    | 'GRAPH_DANGLING_EDGE'
    | 'GRAPH_CYCLE_DETECTED'
    | 'GRAPH_NODE_FAILED'
    | (string & {});

/** 错误的机器可读字段 / machine-readable fields carried by the error */
export interface GraphErrorFields {
    graphId?: string;
    runId?: string;
    nodeId?: string;
    /** 环路/悬挂边等定位信息 / locating details such as cycle members or the dangling endpoint */
    detail?: string;
    cause?: unknown;
}

/** 内核结构化错误 / the structured kernel error */
export class GraphNodeError extends Error {
    /** 稳定错误码 / the stable error code */
    readonly code: GraphErrorCode;
    readonly graphId?: string;
    readonly runId?: string;
    readonly nodeId?: string;
    readonly detail?: string;

    constructor(code: GraphErrorCode, message: string, fields: GraphErrorFields = {}) {
        super(message);
        this.name = 'GraphNodeError';
        this.code = code;
        this.graphId = fields.graphId;
        this.runId = fields.runId;
        this.nodeId = fields.nodeId;
        this.detail = fields.detail;
        if (fields.cause !== undefined) this.cause = fields.cause;
    }
}

/** 构造结构化错误的帮助函数 / helper for building a structured error */
export function graphError(code: GraphErrorCode, message: string, fields: GraphErrorFields = {}): GraphNodeError {
    return new GraphNodeError(code, message, fields);
}

/** 归一化任意抛出值为结构化节点错误；已带稳定 code 的错误原样保留 code /
    normalize any thrown value into a structured node error; errors that already carry a stable code keep it */
export function toNodeError(error: unknown, fields: { graphId: string; runId: string; nodeId: string }): GraphNodeError {
    if (error instanceof GraphNodeError) {
        return new GraphNodeError(error.code, error.message, {
            graphId: fields.graphId,
            runId: fields.runId,
            nodeId: fields.nodeId,
            detail: error.detail,
            cause: error,
        });
    }
    const code = typeof (error as { code?: unknown } | null | undefined)?.code === 'string'
        ? (error as { code: string }).code
        : 'GRAPH_NODE_FAILED';
    return graphError(code, error instanceof Error ? error.message : String(error), {
        ...fields,
        cause: error,
    });
}
