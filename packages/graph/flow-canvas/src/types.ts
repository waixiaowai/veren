/**
 * @deepseek-ai/dsh-graph-flow-canvas —— 画布数据源的纯类型面。
 *
 * @deepseek-ai/dsh-graph-flow-canvas — type-only surface of the canvas data source.
 *
 * 这里只描述"上层可直接消费的 JSON 形状"：静态投影（节点/边/条件/布局槽位）
 * 与运行投影（逐节点状态 + 最终快照）。布局数据由调用方填充，本包不生成、
 * 内核也不存储任何坐标。
 * This file only describes the JSON shapes upper layers consume: the static
 * projection (nodes/edges/conditions/layout slots) and the run projection
 * (per-node status plus the final snapshot). Layout data is filled by the
 * caller; this package never invents coordinates and the kernel stores none.
 */

import type { FlowApprovalAudit, FlowDefinition, FlowId, NodeId, OnErrorPolicy, RetryPolicy, SlotRef } from '@deepseek-ai/dsh-graph-flow-api';
import type { FlowNodeStatus, FlowRunHandle, FlowRunOptions, FlowRunResult, FlowRunStatus } from '@deepseek-ai/dsh-graph-flow-engine';

/** JSON 值：投影结果必须能直接 JSON.stringify / JSON values: projections must serialize directly */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** 画布坐标（调用方填充）/ a canvas point (filled by the caller) */
export interface CanvasPoint {
    x: number;
    y: number;
}

/** 节点布局槽位：本包只保留位置，不写值 / node layout slot: reserved, never filled here */
export interface CanvasNodeLayout {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    [key: string]: JsonValue | undefined;
}

/** 边布局槽位：本包只保留位置，不写值 / edge layout slot: reserved, never filled here */
export interface CanvasEdgeLayout {
    waypoints?: CanvasPoint[];
}

/** 整图布局槽位：空对象是"未布局"，不是"布局为空" / the graph layout slot: empty means "not laid out" */
export interface CanvasLayout {
    viewport?: { x: number; y: number; zoom: number } | null;
    nodes: Record<string, CanvasNodeLayout>;
    edges: Record<string, CanvasEdgeLayout>;
}

/**
 * 条件边种类：无条件 / 命名输出端口 / 声明谓词 /
 * errorBranch 节点的默认输出（error 端口激活时关闭）。
 * Edge condition kinds: unconditional, named output port, declared predicate,
 * or the default output of an errorBranch node (closed when the error port is
 * active).
 */
export type CanvasEdgeKind = 'always' | 'port' | 'predicate' | 'error-branch-default';

/**
 * 条件边的可序列化描述。谓词本身是函数，不能进 JSON，因此这里只标记
 * "声明了谓词"并给出人可读摘要；真正的求值仍由 flow 引擎执行。
 * A serializable description of a conditional edge. The predicate itself is a
 * function and cannot enter JSON, so this only marks that one was declared and
 * gives a human-readable summary; the flow engine still owns evaluation.
 */
export interface CanvasEdgeCondition {
    kind: CanvasEdgeKind;
    /** 命名输出端口（kind === 'port' 时存在）/ named output port (present for port conditions) */
    port?: string;
    /**
     * 是否额外声明了函数谓词：端口条件下谓词不参与；errorBranch 默认边
     * 在 error 端口未激活时仍会求值谓词。
     * Whether a predicate was also declared: it is not evaluated for a port
     * condition, and it still runs for an errorBranch default edge while the
     * error port is inactive.
     */
    hasPredicate: boolean;
    /**
     * 该默认边是否会在上游 error 端口激活时关闭（errorBranch 语义）。
     * 与 hasPredicate 正交，因此“error 端口 + 谓词”可以同时表达。
     * Whether this default edge closes when the upstream error port activates
     * (errorBranch semantics). Orthogonal to hasPredicate, so
     * "error port + predicate" can be expressed together.
     */
    closedByErrorPort: boolean;
    /** 人可读摘要，不是可求值表达式 / human-readable summary, not an evaluable expression */
    summary: string;
}

/** 投影后的节点：id / 类型 / 展示字段 / 原始配置 / 空布局槽位 */
export interface CanvasNode {
    id: NodeId;
    type: string;
    /** 定义里固定引用的版本；未固定时为 undefined / the pinned version; undefined when not pinned */
    version?: number;
    display: {
        /** 展示标签：优先 config.label，其次节点 id / display label: config.label, then the node id */
        label: string;
        /** 副标题：type@version 或 type / subtitle: type@version or type */
        subtitle: string;
    };
    /** 已校验/未校验的原始配置（JSON 安全）/ the raw config (JSON-safe) */
    config?: JsonValue;
    /** 显式输入映射（JSON 安全）/ explicit input mapping (JSON-safe) */
    input?: Record<string, JsonValue>;
    onError: OnErrorPolicy;
    fallbackValue?: JsonValue;
    retry?: RetryPolicy;
    timeout?: number;
    layout: CanvasNodeLayout | null;
}

/** 投影后的边：端点 / 条件 / 命名端口 / 空布局槽位 */
export interface CanvasEdge {
    /** 稳定 id：`from:port->to`，重复边追加 `~n` / stable id, duplicate edges get a `~n` suffix */
    id: string;
    from: NodeId;
    to: NodeId;
    /** 声明的命名输出端口（默认端口为 undefined）/ the declared named port (undefined = default) */
    port?: string;
    condition: CanvasEdgeCondition;
    layout: CanvasEdgeLayout | null;
}

/** 静态投影：一份画布可直接绘制、也可直接 JSON.stringify 的数据 */
export interface CanvasFlow {
    /** 投影 schema 版本，结构升级时递增 / projection schema version */
    schemaVersion: 1;
    flowId: FlowId;
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    /** 声明的输出变量（名字 → slot 引用）/ declared output variables */
    output: Record<string, SlotRef>;
    /** 是否声明了入参 schema（schema 本身是函数，不进投影）/ whether an input schema was declared */
    hasInputSchema: boolean;
    /** 布局容器：由调用方填充，投影产出时为空 / caller-owned layout container, empty in the projection */
    layout: CanvasLayout;
    meta: {
        nodeCount: number;
        edgeCount: number;
    };
}

/** 运行中的逐节点状态 / per-node status in the run projection */
export interface CanvasNodeRuntime {
    id: NodeId;
    /** 内核状态 + flow 层的 `awaiting-approval` / kernel statuses + the flow layer's `awaiting-approval` */
    status: FlowNodeStatus;
    skipReason?: string;
    error?: { code: string; message: string };
    /**
     * errorBranch 兜底成功的失败事实：节点状态仍是 completed，但画布可以
     * 用 recovered 标出“失败已兜底”。
     * The recovered failure fact of a successful errorBranch fallback: the
     * node stays completed, but a canvas can mark it as "failed then recovered".
     */
    recovered?: { code: string; message: string };
    /**
     * 授权审计：等待中的请求没有 outcome；已答复的条目带回答者/时间/来源。
     * Approval audit: a pending request has no outcome; a settled entry carries
     * the actor, time, and via.
     */
    approvals?: readonly FlowApprovalAudit[];
    startedAt?: number;
    endedAt?: number;
}

/** 一次运行的可序列化快照；结束后 result 与 FlowRunResult 一致 */
export interface CanvasRunSnapshot {
    schemaVersion: 1;
    flowId: FlowId;
    runId: FlowRunResult['runId'];
    status: FlowRunStatus;
    nodes: Record<string, CanvasNodeRuntime>;
    /** 运行中的快照为 null，结束后为完整 RunResult / null while running, the full result afterwards */
    result: FlowRunResult | null;
}

/** 订阅回调收到的单次状态迁移 / one status transition delivered to a subscriber */
export interface CanvasNodeStatusChange extends CanvasNodeRuntime {
    flowId: FlowId;
    runId: FlowRunResult['runId'];
    /** 变更节点 id（与 id 同值，便于订阅回调直接使用）/ the changed node id (same as id) */
    nodeId: NodeId;
}

/** 状态监听器 / a status listener */
export type CanvasStatusListener = (change: CanvasNodeStatusChange) => void;

/**
 * 运行投影句柄：快照、订阅、最终结果与清理。dispose 幂等；运行结束自动
 * 清理事件监听器，不把监听器留给下一次 run。
 * The run projection handle: snapshot, subscription, final result and cleanup.
 * dispose is idempotent; the run end auto-removes event listeners so nothing
 * leaks into the next run.
 */
export interface CanvasRunProjection {
    readonly flowId: FlowId;
    readonly runId: FlowRunResult['runId'];
    /** 底层运行句柄（取消用）/ the underlying run handle (for cancellation) */
    readonly handle: FlowRunHandle;
    /** 当前快照（调用方只读约定）/ the current snapshot (caller treats it as read-only) */
    snapshot(): CanvasRunSnapshot;
    /** 追加监听器；返回取消订阅函数 / add a listener; returns an unsubscribe function */
    subscribe(listener: CanvasStatusListener): () => void;
    /** 运行结束后的最终快照（含 result）/ the final snapshot once the run ends */
    readonly finished: Promise<CanvasRunSnapshot>;
    /** 手动停止订阅（幂等）；不取消运行 / stop subscribing (idempotent); does not cancel the run */
    dispose(): void;
}

/** 画布数据源服务能力面 / the canvas data-source capability surface */
export interface FlowCanvas {
    /** 按已注册 flowId 做静态投影；未注册抛 CANVAS_FLOW_NOT_FOUND / project a registered flow */
    project(flowId: FlowId): CanvasFlow;
    /** 对任意 FlowDefinition 做静态投影（YAML 或代码定义均可）/ project any definition */
    projectDefinition(definition: FlowDefinition): CanvasFlow;
    /** 订阅一个已启动的运行（必须尽快调用）/ subscribe to an already-started run (call promptly) */
    watch(handle: FlowRunHandle, listener?: CanvasStatusListener): CanvasRunProjection;
    /** 启动并订阅一次运行 / start a run and subscribe to it */
    run(flowId: FlowId, options?: FlowRunOptions, listener?: CanvasStatusListener): CanvasRunProjection;
}
