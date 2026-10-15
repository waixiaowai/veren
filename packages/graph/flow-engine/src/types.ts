/**
 * flow 引擎的类型面：引擎服务形状、RunHandle、运行记录与存储能力契约。
 *
 * The flow engine's type surface: the engine service shape, RunHandle, run
 * records and the storage capability contract.
 */

import type { FlowBlackboard, FlowDefinition, FlowId, FlowNodeDef, NodeHandler, NodeId, RunId, SlotRef } from '@veren/graph-flow-api';

/** 一次 flow 运行的状态（running 为运行中快照）/ status of one flow run ('running' = live snapshot) */
export type FlowRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** 单节点执行记录 / per-node execution record */
export interface FlowNodeRecord {
    status: 'completed' | 'failed' | 'skipped' | 'cancelled' | 'pending' | 'ready' | 'running';
    skipReason?: string;
    startedAt?: number;
    endedAt?: number;
    error?: { code: string; message: string };
    output?: unknown;
}

/** 一次 flow 运行的结果 / the result of one flow run */
export interface FlowRunResult {
    flowId: FlowId;
    runId: RunId;
    status: Exclude<FlowRunStatus, 'running'>;
    /** 解析后的输出变量（FlowDefinition.output）/ resolved output variables (FlowDefinition.output) */
    output: Record<string, unknown>;
    nodes: Record<string, FlowNodeRecord>;
    error?: { code: string; message: string };
}

/** 运行句柄：状态查询 / 主动取消 / 等待完成 */
export interface FlowRunHandle {
    readonly flowId: FlowId;
    readonly runId: RunId;
    status(): FlowRunStatus;
    /** 通知式取消（signal 只通知，执行方自愿响应）/ cooperative cancel */
    cancel(): void;
    awaitCompletion(): Promise<FlowRunResult>;
}

/** 运行摘要（listRuns 面）/ run summary (the listRuns surface) */
export interface FlowRunSummary {
    flowId: FlowId;
    runId: RunId;
    status: FlowRunStatus;
    startedAt: number;
}

/** 已注册 flow 的摘要（listFlows 面）/ summary of one registered flow (the listFlows surface) */
export interface FlowSummary {
    id: FlowId;
    /** 节点数 / node count */
    nodes: number;
    /** 边数 / edge count */
    edges: number;
    /** 声明的输出变量名 / declared output variable names */
    outputs: string[];
}

/**
 * 一次运行的详情（getRun 面）：运行中只有状态，完成后带结果。
 * Detail of one run (the getRun surface): status while running, the result
 * once finished.
 */
export interface FlowRunDetail {
    flowId: FlowId;
    runId: RunId;
    status: FlowRunStatus;
    startedAt: number;
    /** 完成后存在的运行结果 / the run result, present once the run finished */
    result?: FlowRunResult;
}

/** run 选项：mock 试跑（被 mock 的节点跳过执行直接产出）/ run options: pinned mocks skip execution */
export interface FlowRunOptions {
    input?: Record<string, unknown>;
    mocks?: Record<NodeId, unknown>;
}

/**
 * flow 引擎能力面 / the flow engine capability surface.
 */
export interface FlowEngine {
    registerFlow(definition: FlowDefinition): Promise<void>;
    unregisterFlow(flowId: FlowId): Promise<void>;
    hasFlow(flowId: FlowId): boolean;
    /** 已注册 flow 摘要（按 id 升序）/ registered-flow summaries, sorted by id */
    listFlows(): FlowSummary[];
    /** 启动一次运行（非阻塞，返回句柄）/ start one run (non-blocking; returns a handle) */
    run(flowId: FlowId, options?: FlowRunOptions): FlowRunHandle;
    listRuns(): FlowRunSummary[];
    /** 按 runId 查详情；未知 runId 返回 undefined / one run by id; undefined for an unknown id */
    getRun(runId: RunId): FlowRunDetail | undefined;
}

/** 编译产物：校验后的节点载荷，按 run 组装内核 Graph / compiled artifacts: validated payloads per run */
export interface CompiledFlow {
    definition: FlowDefinition;
    /** (type, version) 解析后的 handler / handlers resolved by (type, version) */
    handlers: Map<NodeId, { type: string; version: number; handler: NodeHandler }>;
    /** 校验后的节点配置 / validated node configs */
    configs: Map<NodeId, unknown>;
    /** subflow 引用（引用环检测用）/ subflow references (for reference-cycle checks) */
    references: FlowId[];
}

/** 引擎内存中的运行条目 / the in-memory run entry */
export interface RunEntry {
    flowId: FlowId;
    runId: RunId;
    status: FlowRunStatus;
    startedAt: number;
    /** 该 run 的黑板（waterfall 改写同步用）/ the run's blackboard (waterfall rewrite sync) */
    blackboard?: FlowBlackboard;
    /** 完成后写入的结果（getRun 面）/ the result written back once finished (the getRun surface) */
    result?: FlowRunResult;
}

/** 供引擎内部使用的节点定义映射 / node-definition map used by engine internals */
export type FlowNodeDefMap = Map<NodeId, FlowNodeDef>;

/**
 * 存储能力契约：引擎不直接碰存储，通过注入的 FlowStorage 服务持久化
 * flow 定义与运行记录。所有方法允许异步；失败由调用方决定记录方式。
 * The storage capability contract: the engine never touches storage directly;
 * it persists definitions and run records through the injected FlowStorage
 * service. All methods are async; callers decide how failures are logged.
 */
export interface FlowStorage {
    saveFlow(definition: FlowDefinition): Promise<void>;
    deleteFlow(flowId: FlowId): Promise<void>;
    saveRun(result: FlowRunResult): Promise<void>;
    listRuns(): Promise<FlowRunSummary[]>;
}

/** 事件载荷：flow 运行启动 / payload of flow run-start events */
export interface FlowRunEventPayload {
    flowId: FlowId;
    runId: RunId;
    input?: Record<string, unknown>;
}

/** 事件载荷：flow 运行结束（带黑板快照）/ payload of flow run-end events (with blackboard snapshot) */
export interface FlowRunEndPayload {
    flowId: FlowId;
    runId: RunId;
    status: Exclude<FlowRunStatus, 'running'>;
    output: Record<string, unknown>;
    blackboard: Record<string, unknown>;
}

// flow 层语义事件：declaration merging + JSDoc @mode。
// Flow semantic events: declaration merging with JSDoc @mode.
declare module '@deepseek-ai/cordis' {
    interface Events {
        /** flow 运行启动拦截：监听器返回真值即拒绝（未启动节点全部 skipped）。@mode serial */
        'flow/run-starting'(payload: FlowRunEventPayload): boolean | void | Promise<boolean | void>;
        /** flow 运行已启动。@mode emit */
        'flow/run-start'(payload: FlowRunEventPayload): void;
        /** flow 运行结束：携带输出变量与黑板快照。@mode emit */
        'flow/run-end'(payload: FlowRunEndPayload): void;
    }
}

/** slot 引用的再导出（'${node.slot}' 字面量模板）/ re-export of the slot-ref template */
export type SlotRefPattern = SlotRef;
