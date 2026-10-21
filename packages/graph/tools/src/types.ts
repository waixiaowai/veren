/**
 * @deepseek-ai/dsh-graph-tools 的载荷类型：三个模型可见工具返回的 canonical 值。
 * 只放类型，工具定义与 schema 在 tools.ts。
 *
 * Payload types of @deepseek-ai/dsh-graph-tools: the canonical values the three
 * model-facing tools return. Types only; the tool definitions and schemas live
 * in tools.ts.
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { FlowRunStatus } from '@deepseek-ai/dsh-graph-flow-engine'

/**
 * 一次运行的状态：直接取引擎那份声明。此处原本抄了一份同形副本（注释也写着「与引擎
 * FlowRunStatus 同形」），引擎增删一个状态就会悄悄漂移；本包本来就依赖引擎，没有理由再抄。
 * One run's status: taken from the engine's own declaration. This file used to
 * carry a same-shaped copy (its comment even said so), which would drift
 * silently the moment the engine gained or lost a state — and this package
 * already depends on the engine, so there was no reason to copy it.
 */
export type { FlowRunStatus }

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
    status: FlowRunStatus;
    /** 解析后的输出变量；未完成时为空对象 / resolved output variables; empty while running */
    output: Record<string, JsonValue>;
    /** 每节点状态；未完成时为空数组 / per-node status; empty while running */
    nodes: GraphNodeItem[];
    /** 运行失败时的结构化错误 / the structured failure once the run failed */
    error?: { code: string; message: string };
}
