/**
 * Registration-time compilation: a `FlowDefinition` is validated once, loudly,
 * into a `CompiledFlow` — handlers resolved by (type, version), node configs
 * validated, DAG shape checked through the kernel and subflow references
 * collected for cycle detection.
 *
 * 注册期编译：`FlowDefinition` 一次性、fail loud 地校验为 `CompiledFlow`——按
 * (type, version) 解析 handler、校验节点配置、借内核检查 DAG 形状，并收集 subflow
 * 引用供环检测使用。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/compile-flow
 */

import { GraphNodeError, validateGraph } from '@deepseek-ai/dsh-graph-core';
import type {
    FlowDefinition,
    FlowId,
    FlowNodeDef,
    NodeHandler,
    NodeId,
    NodeRegistry,
} from '@deepseek-ai/dsh-graph-flow-api';
import { flowError } from './flow-error.js';
import type { FlowError } from './flow-error.js';
import type { CompiledFlow } from './types.js';

/** 解析产物：单节点的 handler 条目、校验后配置与 subflow 引用 / per-node artifacts: the handler entry, the validated config and the subflow reference */
interface NodeArtifacts {
    entry: { type: string; version: number; handler: NodeHandler };
    config: unknown;
    reference: FlowId | undefined;
}

/**
 * 注册期编译：解析 (type, version) handler、校验节点配置、借内核校验 DAG
 * （环 → FLOW_CYCLE_DETECTED）。misconfiguration fails loud。
 * Registration-time compilation: resolve handlers by (type, version),
 * validate node configs, and reuse the kernel's DAG validation (cycles map
 * to FLOW_CYCLE_DETECTED). Misconfiguration fails loud.
 */
export function compileFlow(definition: FlowDefinition, registry: NodeRegistry): CompiledFlow {
    const handlers = new Map<NodeId, { type: string; version: number; handler: NodeHandler }>();
    const configs = new Map<NodeId, unknown>();
    const references: FlowId[] = [];
    for (const node of definition.nodes) {
        const artifact = compileNode(definition, node, registry);
        handlers.set(node.id, artifact.entry);
        configs.set(node.id, artifact.config);
        if (artifact.reference !== undefined) references.push(artifact.reference);
    }
    assertErrorBranchEdges(definition);
    try {
        validateGraph(toKernelShape(definition));
    } catch (cause) {
        throw wrapGraphError(cause, definition.id);
    }
    return { definition, handlers, configs, references };
}

/** 解析单节点：handler、配置校验、subflow 引用 / resolve one node: handler, config validation, subflow reference */
function compileNode(definition: FlowDefinition, node: FlowNodeDef, registry: NodeRegistry): NodeArtifacts {
    const handler = registry.get(node.type, node.version);
    if (!handler) throw notFound(definition, node.id, node.type, node.version);
    let config: unknown;
    try {
        config = handler.config(node.config ?? {});
    } catch (cause) {
        throw flowError('NODE_CONFIG_INVALID', `node "${node.id}" failed config validation for "${node.type}"`, {
            flowId: definition.id,
            nodeId: node.id,
            cause,
        });
    }
    return {
        entry: { type: handler.type, version: handler.version, handler },
        config,
        reference: node.type === 'subflow' ? (config as { flow: string }).flow as FlowId : undefined,
    };
}

/**
 * errorBranch 必须有命名 error 出边，否则失败无处可去（misconfiguration fails loud）。
 * An errorBranch node needs a named error edge; without it a failure has
 * nowhere to go (misconfiguration fails loud).
 */
function assertErrorBranchEdges(definition: FlowDefinition): void {
    for (const node of definition.nodes) {
        if ((node.onError ?? 'failFast') !== 'errorBranch') continue;
        if (definition.edges.some((edge) => edge.from === node.id && edge.port === 'error')) continue;
        throw flowError('NODE_CONFIG_INVALID', `node "${node.id}" uses errorBranch but declares no "error" output port`, {
            flowId: definition.id,
            nodeId: node.id,
        });
    }
}

/** NODE_TYPE_NOT_FOUND 构造 / build the NODE_TYPE_NOT_FOUND error */
function notFound(definition: FlowDefinition, nodeId: NodeId, type: string, version?: number): FlowError {
    const wanted = version === undefined ? type : `${type}@${version}`;
    return flowError('NODE_TYPE_NOT_FOUND', `node "${nodeId}" references unregistered type "${wanted}"`, {
        flowId: definition.id,
        nodeId,
    });
}

/** 最小内核图形状（仅校验用）/ minimal kernel graph shape (validation only) */
function toKernelShape(definition: FlowDefinition): { id: string; nodes: { id: string }[]; edges: { from: string; to: string }[] } {
    return {
        id: definition.id,
        nodes: definition.nodes.map((node) => ({ id: node.id })),
        edges: definition.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    };
}

/** 内核校验错误 → flow 错误（环映射为 FLOW_CYCLE_DETECTED，其余原样透传）/
    map kernel validation errors to flow errors (cycles become FLOW_CYCLE_DETECTED; the rest pass through) */
export function wrapGraphError(cause: unknown, flowId: string): FlowError | GraphNodeError {
    if (cause instanceof GraphNodeError) {
        if (cause.code === 'GRAPH_CYCLE_DETECTED') {
            return flowError('FLOW_CYCLE_DETECTED', `flow "${flowId}" contains a cycle: ${cause.detail ?? 'unknown'}`, {
                flowId,
                detail: cause.detail,
                cause,
            });
        }
        return cause;
    }
    return flowError('NODE_FAILED', cause instanceof Error ? cause.message : String(cause), { flowId, cause });
}
