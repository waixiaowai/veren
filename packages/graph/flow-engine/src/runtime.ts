/**
 * flow 运行时：结构化错误、黑板、FlowDefinition → 内核图校验、运行环境与
 * 内核图组装。
 * The flow runtime: structured errors, the blackboard, FlowDefinition →
 * kernel-graph validation, and the run environment / kernel-graph assembly.
 */

import type {
    FlowApprovalBroker,
    FlowApprovalOpenContext,
    FlowBlackboard,
    FlowDefinition,
    FlowId,
    FlowNodeApprovalPort,
    NodeHandler,
    NodeId,
    NodeRegistry,
    RunId,
} from '@deepseek-ai/dsh-graph-flow-api';
import { GraphNodeError, validateGraph } from '@deepseek-ai/dsh-graph-core';
import type { GraphRunContext, GraphRunResult } from '@deepseek-ai/dsh-graph-core';
import type { CompiledFlow, FlowNodeDefMap, FlowNodeRecord, FlowRunResult, RunEntry } from './types.js';

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

/** 内存黑板：`${nodeId}.${slot}` 命名空间 / in-memory blackboard keyed by `${nodeId}.${slot}` */
export function createBlackboard(): FlowBlackboard {
    const slots = new Map<string, unknown>();
    return {
        read: (nodeId, slot) => slots.get(`${nodeId}.${slot}`),
        write: (nodeId, slot, value) => void slots.set(`${nodeId}.${slot}`, value),
        snapshot: () => Object.fromEntries(slots),
    };
}

/** 解析 `${nodeId.slot}` 引用；非引用原样返回 / resolve a slot ref; pass literals through */
export function resolveInputValue(value: unknown, blackboard: FlowBlackboard): unknown {
    if (typeof value !== 'string') return value;
    const match = /^\$\{([^}.]+)\.([^}]+)\}$/.exec(value);
    if (!match) return value;
    return blackboard.read(match[1]!, match[2]!);
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
        handlers.set(node.id, { type: handler.type, version: handler.version, handler });
        configs.set(node.id, config);
        if (node.type === 'subflow') references.push((config as { flow: string }).flow as FlowId);
    }
    // errorBranch 必须有命名 error 出边，否则失败无处可去（misconfiguration fails loud）
    // errorBranch needs a named error edge; without it a failure has nowhere to go.
    for (const node of definition.nodes) {
        if ((node.onError ?? 'failFast') !== 'errorBranch') continue;
        if (definition.edges.some((edge) => edge.from === node.id && edge.port === 'error')) continue;
        throw flowError('NODE_CONFIG_INVALID', `node "${node.id}" uses errorBranch but declares no "error" output port`, {
            flowId: definition.id,
            nodeId: node.id,
        });
    }
    try {
        validateGraph(toKernelShape(definition));
    } catch (cause) {
        throw wrapGraphError(cause, definition.id);
    }
    return { definition, handlers, configs, references };
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

/** 归一化节点产出为命名 slot / normalize a node output into named slots */
export function toSlots(output: unknown): Record<string, unknown> {
    if (output !== null && typeof output === 'object' && !Array.isArray(output)) {
        return output as Record<string, unknown>;
    }
    return { out: output };
}

/** 运行期输出端口结论：节点落定后它激活哪些命名端口 / outcome ports: which named ports a node activates */
export type OutcomePorts = Map<NodeId, Set<string>>;

/** 每次运行的执行器依赖 / per-run executor dependencies */
export interface RunnerDeps {
    flowId: string;
    runId: string;
    nodeDefs: FlowNodeDefMap;
    compiled: CompiledFlow;
    /** 运行期重解析 handler（节点类型卸载后 fails loud）/ re-resolve handlers at run time (unloaded types fail loudly) */
    registry: NodeRegistry;
    blackboard: FlowBlackboard;
    outcomePorts: OutcomePorts;
    mocks?: Record<NodeId, unknown>;
    defaultTimeoutMs: number;
    /** 授权服务（未装载时为 undefined → 请求按 unavailable 拒绝）/ the approval service (undefined → requests deny as unavailable) */
    approval?: FlowApprovalBroker;
}

/** 一次 flow 运行的环境依赖（run 主体与执行器组装共用）/ per-run environment (shared by the run body and runner assembly) */
export interface DriveEnv {
    input: Record<string, unknown>;
    mocks?: Record<NodeId, unknown>;
    blackboard: FlowBlackboard;
    outcomePorts: OutcomePorts;
    isCancelled: () => boolean;
    setCancel: (cancel: () => void) => void;
    /** 本 run 的授权服务快照（未装载时 undefined）/ the run's approval service snapshot (undefined when absent) */
    approval?: FlowApprovalBroker;
}

/** flow 图 → 内核图：边条件组合端口结论与声明谓词 / flow graph → kernel graph: edge conditions combine outcome ports and declared predicates */
export function toKernelGraph(compiled: CompiledFlow, blackboard: FlowBlackboard, outcomePorts: OutcomePorts) {
    const definition = compiled.definition;
    return {
        id: definition.id,
        nodes: definition.nodes.map((node) => ({ id: node.id })),
        edges: definition.edges.map((edge) => ({
            from: edge.from,
            to: edge.to,
            // 边条件 = 命名端口结论 ∧ 声明谓词；error 端口激活时默认输出关闭
            // edge condition = outcome port ∧ declared predicate; the default output closes once 'error' activates
            when: (kctx: GraphRunContext) => {
                const ports = outcomePorts.get(edge.from);
                if (edge.port) return ports?.has(edge.port) ?? false;
                if (ports?.has('error')) return false;
                return edge.when ? edge.when(blackboard, kctx) : true;
            },
        })),
    };
}

/** 组装执行器依赖 / assemble the runner dependencies */
export function runnerDeps(
    compiled: CompiledFlow,
    entry: RunEntry,
    env: DriveEnv,
    registry: NodeRegistry,
    defaultTimeoutMs: number,
): RunnerDeps {
    const nodeDefs: FlowNodeDefMap = new Map(compiled.definition.nodes.map((node) => [node.id, node]));
    return {
        flowId: entry.flowId,
        runId: entry.runId,
        nodeDefs,
        compiled,
        registry,
        blackboard: env.blackboard,
        outcomePorts: env.outcomePorts,
        mocks: env.mocks,
        defaultTimeoutMs,
        ...env.approval === undefined ? {} : { approval: env.approval },
    };
}

/**
 * 为一次节点尝试构造授权面：把 flow-api 的输入交给本 run 的授权服务。
 * 服务未装载时返回一个稳定的 unavailable 拒绝，保持旧的 fail-closed 行为。
 * Build the approval face of one node attempt: hand the flow-api input to the
 * run's approval service. With no service mounted it denies as unavailable,
 * preserving the historical fail-closed behavior.
 * @param broker - the run's approval service, or undefined when not mounted.
 * @param identity - the run/node/attempt identity attached to the request.
 * @param signal - the run's cancellation signal.
 * @returns the node-scoped approval port.
 */
export function nodeApprovalPort(
    broker: FlowApprovalBroker | undefined,
    identity: Omit<FlowApprovalOpenContext, 'signal'>,
    signal: AbortSignal,
): FlowNodeApprovalPort {
    if (broker === undefined) {
        return { request: () => Promise.resolve({ decision: 'deny', via: 'unavailable', decidedAt: Date.now() }) };
    }
    return { request: (input) => broker.open(input, { ...identity, signal }) };
}

/** errorBranch 兜底失败事实：从黑板 error slot 读成稳定结构 / the recovered failure fact from the blackboard */
export function recoveredFailure(blackboard: FlowBlackboard | undefined, nodeId: NodeId): { code: string; message: string } | undefined {
    const value = blackboard?.read(nodeId, 'error');
    if (value === undefined) return undefined;
    const summary = value as { code?: unknown; message?: unknown };
    return typeof summary?.code === 'string' && typeof summary.message === 'string' ? { code: summary.code, message: summary.message } : { code: 'NODE_FAILED', message: String(value) };
}
/** 内核节点记录 → flow 节点记录；缺失的可选字段不落键 / map a kernel record; absent optional fields are omitted */
function toFlowRecord([id, record]: [string, GraphRunResult['nodes'][string]]): [string, FlowNodeRecord] {
    const node: FlowNodeRecord = { status: record.status };
    if (record.skipReason !== undefined) node.skipReason = record.skipReason;
    if (record.startedAt !== undefined) node.startedAt = record.startedAt;
    if (record.endedAt !== undefined) node.endedAt = record.endedAt;
    if (record.output !== undefined) node.output = record.output;
    if (record.error) node.error = { code: record.error.code, message: record.error.message };
    return [id, node];
}
/** 内核结果 → flow 结果：节点记录、解析后的输出变量、首个错误 / kernel result → flow result */
export function toFlowResult(
    compiled: CompiledFlow,
    entry: RunEntry,
    blackboard: FlowBlackboard,
    kernelResult: GraphRunResult,
): FlowRunResult {
    const nodes = Object.fromEntries(Object.entries(kernelResult.nodes).map(toFlowRecord));
    // 失败事实是加法：errorBranch 节点仍是 completed，但记录里带 recovered
    // The failure fact is additive: an errorBranch node stays completed but carries recovered.
    for (const node of compiled.definition.nodes) {
        const record = nodes[node.id];
        if (node.onError !== 'errorBranch' || record?.status !== 'completed') continue;
        const recovered = recoveredFailure(blackboard, node.id);
        if (recovered) record.recovered = recovered;
    }
    const output = Object.fromEntries(Object.entries(compiled.definition.output ?? {}).map(([name, ref]) => [name, resolveInputValue(ref, blackboard)]));
    const failure = Object.values(kernelResult.nodes).find((record) => record.error);
    const result: FlowRunResult = { flowId: entry.flowId, runId: entry.runId, status: kernelResult.status, output, nodes };
    if (failure) result.error = { code: failure.error!.code, message: failure.error!.message };
    return result;
}
/** 取消：每个节点都是 cancelled（不是 skipped）/ cancel: every node is cancelled (never skipped) */
export function cancelledRunResult(compiled: CompiledFlow, flowId: FlowId, runId: RunId): GraphRunResult {
    const nodes = Object.fromEntries(compiled.definition.nodes.map((node) => [node.id, { id: node.id, status: 'cancelled' as const }]));
    return { graphId: flowId, runId, status: 'cancelled', nodes };
}
/** 拒绝启动：未启动节点 skipped/run-rejected / refused start: never-started nodes are skipped */
export function rejectedRunResult(compiled: CompiledFlow, flowId: FlowId, runId: RunId): GraphRunResult {
    const nodes = Object.fromEntries(compiled.definition.nodes.map((node) => [
        node.id,
        { id: node.id, status: 'skipped' as const, skipReason: 'run-rejected' as const },
    ]));
    return { graphId: flowId, runId, status: 'cancelled', nodes };
}
