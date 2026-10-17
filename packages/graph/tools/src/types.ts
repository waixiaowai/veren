/**
 * @deepseek-ai/dsh-graph-tools 的载荷类型：三个模型可见工具返回的 canonical 值。
 * 只放类型，工具定义与 schema 在 tools.ts。
 *
 * Payload types of @deepseek-ai/dsh-graph-tools: the canonical values the three
 * model-facing tools return. Types only; the tool definitions and schemas live
 * in tools.ts.
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** 一次运行的状态（与引擎 FlowRunStatus 同形）/ one run's status (same shape as the engine's FlowRunStatus) */
export type GraphRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** flow 清单项（graph_list 面）/ one flow list item (the graph_list surface) */
export interface GraphFlowItem {
    id: string;
    nodes: number;
    edges: number;
    outputs: string[];
}

/** 节点状态项（graph_run / graph_status 面）/ one node status item (the graph_run / graph_status surface) */
export interface GraphNodeItem {
    id: string;
    status: string;
    error?: { code: string; message: string };
}

/** graph_list 的载荷 / the graph_list payload */
export interface GraphListPayload {
    flows: GraphFlowItem[];
}

/** graph_run 与 graph_status 的载荷 / the graph_run and graph_status payload */
export interface GraphRunPayload {
    flowId: string;
    runId: string;
    status: GraphRunStatus;
    /** 解析后的输出变量；未完成时为空对象 / resolved output variables; empty while running */
    output: Record<string, JsonValue>;
    /** 每节点状态；未完成时为空数组 / per-node status; empty while running */
    nodes: GraphNodeItem[];
    /** 运行失败时的结构化错误 / the structured failure once the run failed */
    error?: { code: string; message: string };
}
