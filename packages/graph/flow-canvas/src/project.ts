/**
 * 静态投影：FlowDefinition → CanvasFlow。
 *
 * Static projection: FlowDefinition → CanvasFlow.
 *
 * 只读 flow 定义，不执行、不修改；所有字段都可 JSON.stringify。布局槽位
 * 留空，由调用方填充（本包不生成坐标，内核也不存布局）。
 * Read-only over the flow definition: nothing executes or mutates, and every
 * field is JSON-serializable. Layout slots stay empty for the caller (this
 * package generates no coordinates and the kernel stores no layout).
 */

import type { FlowDefinition, FlowEdge, FlowNodeDef, OnErrorPolicy } from '@deepseek-ai/dsh-graph-flow-api';
import type {
    CanvasEdge,
    CanvasEdgeCondition,
    CanvasFlow,
    CanvasLayout,
    CanvasNode,
    JsonValue,
} from './types.js';

/** 画布投影的稳定错误码 / stable error codes of the canvas projection */
export type CanvasErrorCode = 'CANVAS_FLOW_NOT_FOUND' | 'CANVAS_FLOW_INVALID' | 'CANVAS_NOT_SERIALIZABLE';

/** 结构化画布错误 / a structured canvas error */
export class CanvasError extends Error {
    readonly code: CanvasErrorCode;
    readonly flowId?: string;
    readonly detail?: string;

    constructor(code: CanvasErrorCode, message: string, fields: { flowId?: string; detail?: string } = {}) {
        super(message);
        this.name = 'CanvasError';
        this.code = code;
        this.flowId = fields.flowId;
        this.detail = fields.detail;
    }
}

/** 投影一份 flow 定义 / project one flow definition */
export function projectFlow(definition: FlowDefinition): CanvasFlow {
    const nodeIds = new Set(definition.nodes.map((node) => node.id));
    for (const edge of definition.edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
            throw new CanvasError('CANVAS_FLOW_INVALID', `edge "${edge.from}" -> "${edge.to}" references a missing node`, {
                flowId: definition.id,
                detail: `${edge.from}->${edge.to}`,
            });
        }
    }
    const seen = new Map<string, number>();
    const onError = new Map(definition.nodes.map((node) => [node.id, node.onError ?? 'failFast']));
    const nodes = definition.nodes.map((node, index) => projectNode(node, index));
    const edges = definition.edges.map((edge) => projectEdge(edge, seen, onError.get(edge.from)));
    return {
        schemaVersion: 1,
        flowId: definition.id,
        nodes,
        edges,
        output: { ...(definition.output ?? {}) },
        hasInputSchema: definition.input !== undefined,
        layout: emptyLayout(),
        meta: { nodeCount: nodes.length, edgeCount: edges.length },
    };
}

/** 空布局容器：调用方按需填充，投影不写任何坐标 / empty layout container; the caller fills it, the projection writes no coordinates */
function emptyLayout(): CanvasLayout {
    const layout: CanvasLayout = { viewport: null, nodes: {}, edges: {} };
    return layout;
}

/** 单节点投影 / project one node */
function projectNode(node: FlowNodeDef, index: number): CanvasNode {
    const config = node.config === undefined ? undefined : toJsonValue(node.config, `nodes[${index}].config`);
    const input = node.input === undefined
        ? undefined
        : Object.fromEntries(Object.entries(node.input).map(([key, value]) => [key, toJsonValue(value, `nodes[${index}].input.${key}`)]));
    return {
        id: node.id,
        type: node.type,
        version: node.version,
        display: { label: readLabel(node.config) ?? String(node.id), subtitle: subtitleOf(node) },
        config,
        input,
        onError: node.onError ?? 'failFast',
        fallbackValue: node.fallbackValue === undefined
            ? undefined
            : toJsonValue(node.fallbackValue, `nodes[${index}].fallbackValue`),
        retry: node.retry,
        timeout: node.timeout,
        layout: null,
    };
}

/** 副标题：type@version / subtitle: type@version */
function subtitleOf(node: FlowNodeDef): string {
    return node.version === undefined ? node.type : `${node.type}@${node.version}`;
}

/** 从 config.label 读取展示标签（约定字段，不读取业务语义）/ read the conventional display label */
function readLabel(config: unknown): string | undefined {
    if (config === null || typeof config !== 'object' || Array.isArray(config)) return undefined;
    const label = (config as Record<string, unknown>)['label'];
    return typeof label === 'string' && label.length > 0 ? label : undefined;
}

/** 单边投影 / project one edge */
function projectEdge(edge: FlowEdge, seen: Map<string, number>, sourceOnError: OnErrorPolicy | undefined): CanvasEdge {
    const base = `${edge.from}:${edge.port ?? 'out'}->${edge.to}`;
    const duplicate = seen.get(base) ?? 0;
    seen.set(base, duplicate + 1);
    return {
        id: duplicate === 0 ? base : `${base}~${duplicate}`,
        from: edge.from,
        to: edge.to,
        port: edge.port,
        condition: conditionOf(edge, sourceOnError),
        layout: null,
    };
}

/**
 * 条件描述：端口优先于谓词（与引擎求值顺序一致）；errorBranch 节点的
 * 默认出边在 error 端口激活时关闭，也必须让画布看出来。
 * Port first, matching engine evaluation order; a default edge out of an
 * errorBranch node closes when the error port activates, so the canvas sees it.
 */
function conditionOf(edge: FlowEdge, sourceOnError: OnErrorPolicy | undefined): CanvasEdgeCondition {
    const hasPredicate = edge.when !== undefined;
    if (edge.port !== undefined) {
        return {
            kind: 'port',
            port: edge.port,
            hasPredicate,
            summary: hasPredicate ? `port "${edge.port}" (predicate ignored)` : `port "${edge.port}"`,
        };
    }
    if (hasPredicate) return { kind: 'predicate', hasPredicate: true, summary: 'declared predicate' };
    if (sourceOnError === 'errorBranch') {
        return {
            kind: 'error-branch-default',
            hasPredicate: false,
            summary: 'default output (closed when the error port is active)',
        };
    }
    return { kind: 'always', hasPredicate: false, summary: 'always' };
}

/**
 * 把任意配置/输入规范化成 JSON 值：函数、symbol、bigint、undefined、环
 * 都会响亮失败，而不是被 JSON.stringify 静默丢弃。
 * Normalize arbitrary config/input into JSON values: functions, symbols,
 * bigints, undefined and cycles fail loudly instead of being dropped silently
 * by JSON.stringify.
 */
function toJsonValue(value: unknown, path: string, seen: Set<object> = new Set()): JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw notSerializable(path, 'non-finite number');
        return value;
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
        if (seen.has(value)) throw notSerializable(path, 'circular reference');
        seen.add(value);
        const result = value.map((entry, index) => toJsonValue(entry, `${path}[${index}]`, seen));
        seen.delete(value);
        return result;
    }
    if (typeof value === 'object') {
        if (seen.has(value)) throw notSerializable(path, 'circular reference');
        seen.add(value);
        const result: Record<string, JsonValue> = {};
        for (const [key, entry] of Object.entries(value)) result[key] = toJsonValue(entry, `${path}.${key}`, seen);
        seen.delete(value);
        return result;
    }
    throw notSerializable(path, typeof value);
}

/** 构造不可序列化错误 / build the not-serializable error */
function notSerializable(path: string, kind: string): CanvasError {
    return new CanvasError('CANVAS_NOT_SERIALIZABLE', `"${path}" contains a non-JSON value (${kind})`, { detail: path });
}
