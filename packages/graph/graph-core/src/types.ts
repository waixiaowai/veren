/**
 * @veren/graph-core —— 通用有向无环图执行内核的类型面。
 *
 * @veren/graph-core — type surface of the general-purpose DAG execution kernel.
 *
 * 内核只认识中性模型（Node/Edge/Graph），对"节点是什么、数据怎么流"完全中立：
 * 不做节点类型校验、不做数据传递、不碰持久化。flow/pipeline 等语义层在此之上适配。
 * The kernel only knows the neutral model (Node/Edge/Graph) and is fully
 * agnostic about what a node is and how data flows: no node-type checks, no
 * data passing, no persistence. Semantic layers (flow, pipeline, ...) adapt on
 * top of it.
 */

import type { Context } from '@deepseek-ai/cordis';
import type { GraphNodeError } from './errors.js';

/** 中性节点：内核只要求一个稳定 id / Neutral node: the kernel only requires a stable id */
export interface GNode {
    readonly id: string;
}

/**
 * 中性边：from/to 表达依赖顺序；`when` 是可选谓词，内核在**上游落定后**求值
 * （求值逻辑由上层在构造边时注入，内核不解释其语义）。条件为 false 时下游被
 * 标记 skipped，skipReason 记 `upstream-condition`。
 *
 * Neutral edge: from/to express dependency order; `when` is an optional
 * predicate the kernel evaluates **after the upstream node settles** (the
 * evaluation logic is injected by the upper layer when building the edge; the
 * kernel does not interpret it). A false condition marks the downstream node
 * skipped with skipReason `upstream-condition`.
 */
export interface GEdge {
    readonly from: string;
    readonly to: string;
    readonly when?: (ctx: GraphRunContext) => boolean;
}

/** 中性图模型：将来画布的数据源；节点布局等元数据由上层附加，内核不存 */
export interface Graph {
    readonly id: string;
    readonly nodes: readonly GNode[];
    readonly edges: readonly GEdge[];
}

/** 节点状态机的全部合法迁移 / every legal state of the node status machine */
export type GraphNodeStatus =
    | 'pending'
    | 'ready'
    | 'running'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'cancelled';

/** 跳过原因：失败传播与条件不满足分开记录 / skip reasons: failure vs condition are kept apart */
export type GraphSkipReason =
    | 'upstream-failure'
    | 'upstream-condition'
    | 'upstream-cancel'
    | 'pre-execute-veto'
    | 'run-rejected';

/** 单节点的执行记录（RunResult 的逐节点面）/ per-node execution record */
export interface GraphNodeRecord {
    readonly id: string;
    status: GraphNodeStatus;
    skipReason?: GraphSkipReason;
    startedAt?: number;
    endedAt?: number;
    error?: GraphNodeError;
    output?: unknown;
}

/** 一次 run 的最终状态 / final status of one run */
export type GraphRunStatus = 'completed' | 'failed' | 'cancelled';

/** 内核 run 的结果：中性字段，供上层扩展 / kernel run result: neutral fields */
export interface GraphRunResult {
    graphId: string;
    runId: string;
    status: GraphRunStatus;
    nodes: Record<string, GraphNodeRecord>;
}

/**
 * 每次 run 的元数据：内核用 `ctx.extend(meta)` 创建 run 子 context，
 * `GRunContext` 是 DSH Context 的扩展，不是自造接口。signal 是 cancel 与
 * fail-fast 的统一取消通道（内核只通知，执行方自愿响应）。
 *
 * Per-run metadata: the kernel creates the run child context via
 * `ctx.extend(meta)`; GRunContext extends the DSH Context rather than
 * inventing a new interface. The signal is the unified cancel channel shared
 * by cancel and fail-fast (notification only — executors opt in).
 */
export interface GraphRunMeta {
    graphId: string;
    runId: string;
    signal: AbortSignal;
}

/** run 子 context：在 Context 上叠加 run 元数据 / run context: Context plus run metadata */
export interface GraphRunContext extends Context, GraphRunMeta {}

/**
 * 执行单元：内核通过该回调把"节点是什么"完全交给上层适配注入。
 * The execution unit: the callback through which the upper layer injects what
 * a node actually does. The kernel stays business-agnostic.
 */
export interface GExecutor {
    execute(node: GNode, ctx: GraphRunContext): Promise<unknown>;
}

/**
 * 状态上报能力：注册在 run 子 context 上，节点作用域内经
 * `getOrThrow(ctx, RunStatusToken)` 上报状态迁移。
 * The status-reporting capability: provided on the run child context; inside
 * a node scope, report transitions via `getOrThrow(ctx, RunStatusToken)`.
 */
export interface GraphRunStatusService {
    setStatus(nodeId: string, status: GraphNodeStatus, patch?: Partial<Omit<GraphNodeRecord, 'id' | 'status'>>): void;
}

/**
 * 失败传播策略（可替换）：默认 fail-fast。返回 'continue' 时内核继续调度
 * 兄弟分支（将来 continue/retry 等策略插件化，不改内核）。
 * The replaceable failure-propagation strategy; fail-fast by default.
 * Returning 'continue' lets sibling branches keep scheduling (future
 * continue/retry strategies plug in without kernel changes).
 */
export type GraphFailureStrategy = (info: {
    node: GNode;
    error: GraphNodeError;
    records: Record<string, GraphNodeRecord>;
}) => 'failFast' | 'continue';

/** run 调度选项 / scheduling options for one run */
export interface GraphRunOptions {
    /** 承载 run 子 context 的父上下文 / the parent context for the run child context */
    ctx: Context;
    /** 未指定则生成 / generated when omitted */
    runId?: string;
    /** 就绪集并发上限，缺省取服务配置 / ready-set concurrency cap; defaults to the service config */
    concurrency?: number;
    /** 失败传播策略，缺省 fail-fast / failure strategy; fail-fast by default */
    onNodeFailure?: GraphFailureStrategy;
}

/** 事件共用载荷：只含中性字段 / shared event payload: neutral fields only */
export interface GraphRunEventMeta {
    graphId: string;
    runId: string;
    /** 仅节点级事件携带 / present on node-level events only */
    nodeId?: string;
}

/** run 结束事件载荷 / payload of the run-end event */
export interface GraphRunEndPayload {
    runId: string;
    graphId: string;
    status: GraphRunStatus;
}

// 生命周期事件：类型经 declaration merging 定义，JSDoc 标注 @mode。
// Lifecycle events: typed via declaration merging; JSDoc carries the @mode.
declare module '@deepseek-ai/cordis' {
    interface Events {
        /**
         * run 启动拦截：监听器返回真值即拒绝本次运行（未启动节点全部
         * skipped，skipReason `run-rejected`，run 状态 cancelled）。
         * @mode serial
         */
        'graph/run-starting'(meta: GraphRunEventMeta): boolean | void | Promise<boolean | void>;
        /** run 已启动通知。@mode emit */
        'graph/run-start'(meta: GraphRunEventMeta): void;
        /**
         * 节点即将执行：监听器返回真值即否决该节点（节点 skipped，
         * skipReason `pre-execute-veto`；框架 isBailed 以真值为 bail，
         * false/undefined 视为放行，语义与 tools/pre-execute 一致）。
         * @mode bail
         */
        'graph/node-pre-execute'(meta: GraphRunEventMeta): boolean | void | Promise<boolean | void>;
        /**
         * 节点产出加工：waterfall 组合监听器；监听器修改 `envelope.output`
         * 并**必须调用 next()**（最后一个 next 返回 envelope.output 作内核产出）。
         * @mode waterfall
         */
        'graph/node-post-execute'(
            meta: GraphRunEventMeta,
            envelope: { output: unknown },
            next: () => unknown,
        ): unknown;
        /** 节点失败：结构化错误（code/graphId/runId/nodeId/cause）。@mode emit */
        'graph/node-error'(error: GraphNodeError): void;
        /** run 结束：携带最终状态。@mode emit */
        'graph/run-end'(payload: GraphRunEndPayload): void;
    }
}
