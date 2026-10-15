/**
 * flow 运行时：结构化错误、黑板、FlowDefinition → 内核图校验、节点执行器
 * 包裹（输入映射 / 重试 / 超时 / onError / mock）。
 * The flow runtime: structured errors, the blackboard, FlowDefinition →
 * kernel-graph validation, and the node executor wrapper.
 */

import type { FlowBlackboard, FlowDefinition, FlowId, FlowNodeDef, NodeExecuteContext, NodeHandler, NodeId, NodeRegistry, RunId } from '@veren/graph-flow-api';
import { GraphNodeError, validateGraph } from '@veren/graph-core';
import type { GExecutor, GraphRunContext } from '@veren/graph-core';
import type { CompiledFlow, FlowNodeDefMap } from './types.js';

/** flow 层稳定错误码 / stable flow-layer error codes */
export type FlowErrorCode =
    | 'FLOW_NOT_FOUND'
    | 'FLOW_CYCLE_DETECTED'
    | 'FLOW_REFERENCE_CYCLE'
    | 'FLOW_CANCELLED'
    | 'NODE_TYPE_NOT_FOUND'
    | 'NODE_CONFIG_INVALID'
    | 'NODE_FAILED'
    | 'NODE_TIMEOUT';

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

/** 归一化任意抛出值为 FlowError / normalize any thrown value into a FlowError */
export function toFlowError(cause: unknown, fields: { flowId: string; runId: string; nodeId: string }): FlowError {
    if (cause instanceof FlowError) return cause;
    return flowError('NODE_FAILED', cause instanceof Error ? cause.message : String(cause), { ...fields, cause });
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
    try {
        validateGraph(toKernelShape(definition));
    } catch (cause) {
        throw wrapGraphError(cause, definition.id);
    }
    return { definition, handlers, configs, references };
}

/** NODE_TYPE_NOT_FOUND 构造 / build the NODE_TYPE_NOT_FOUND error */
function notFound(definition: FlowDefinition, nodeId: string, type: string, version?: number): FlowError {
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
}

/** 归一化节点产出为命名 slot / normalize a node output into named slots */
export function toSlots(output: unknown): Record<string, unknown> {
    if (output !== null && typeof output === 'object' && !Array.isArray(output)) {
        return output as Record<string, unknown>;
    }
    return { out: output };
}

/**
 * 构造 GExecutor 适配器：mock 直出、输入映射解析、重试、超时、onError
 * 策略（failFast / fallback / errorBranch）、黑板写入与端口结论。
 * Build the GExecutor adapter: mock passthrough, input-mapping resolution,
 * retry, timeout, the onError policy (failFast / fallback / errorBranch),
 * blackboard writes and outcome ports.
 */
export function createRunner(deps: RunnerDeps): GExecutor {
    return {
        async execute(node, kctx): Promise<unknown> {
            const nodeId = node.id as NodeId;
            const signal = kctx.signal;
            const defNode = deps.nodeDefs.get(nodeId)!;
            if (deps.mocks && nodeId in deps.mocks) return settle(deps, nodeId, deps.mocks[nodeId]);
            const input = resolveInputs(defNode, deps.blackboard);
            const tries = Math.max(1, defNode.retry?.tries ?? 1);
            for (let attempt = 1; attempt <= tries; attempt++) {
                if (signal.aborted) throw flowError('FLOW_CANCELLED', 'cancelled before execution', runRef(deps, nodeId));
                try {
                    const output = await runOnce(deps, nodeId, defNode, input, kctx, signal, attempt);
                    return settle(deps, nodeId, output);
                } catch (cause) {
                    if (attempt < tries) await retrySleep(defNode.retry?.backoffMs ?? 0, signal);
                    else return settleFailure(deps, nodeId, defNode, cause);
                }
            }
            throw flowError('NODE_FAILED', 'unreachable', runRef(deps, nodeId));
        },
    };
}

/** 运行引用三元组 / the run reference triple */
function runRef(deps: RunnerDeps, nodeId: NodeId): { flowId: string; runId: string; nodeId: NodeId } {
    return { flowId: deps.flowId, runId: deps.runId, nodeId };
}

/** 解析显式输入映射 / resolve the explicit input mapping */
function resolveInputs(defNode: FlowNodeDef, blackboard: FlowBlackboard): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(defNode.input ?? {}).map(([key, value]) => [key, resolveInputValue(value, blackboard)]),
    );
}

/** 单次尝试：nctx 组装 + 超时包裹 / one attempt: build nctx and wrap with a timeout */
async function runOnce(
    deps: RunnerDeps,
    nodeId: NodeId,
    defNode: FlowNodeDef,
    input: Record<string, unknown>,
    kctx: GraphRunContext,
    signal: AbortSignal,
    attempt: number,
): Promise<unknown> {
    const entry = deps.compiled.handlers.get(nodeId)!;
    // 运行期重解析：节点类型被卸载时得到 NODE_TYPE_NOT_FOUND / re-resolve at run time
    const handler = deps.registry.get(entry.type, entry.version);
    if (!handler) {
        throw flowError('NODE_TYPE_NOT_FOUND', `node "${nodeId}" references unregistered type "${entry.type}@${entry.version}"`, runRef(deps, nodeId));
    }
    const nctx: NodeExecuteContext = {
        ctx: kctx,
        flowId: deps.flowId as FlowId,
        runId: deps.runId as RunId,
        nodeId,
        attempt,
        config: deps.compiled.configs.get(nodeId),
        blackboard: deps.blackboard,
        signal,
    };
    return withTimeout(Promise.resolve(handler.execute(input, nctx)), defNode.timeout ?? deps.defaultTimeoutMs, nodeId, deps.flowId, signal);
}

/** 成功落定：写黑板并记录端口结论 / settle success: write the blackboard and record outcome ports */
function settle(deps: RunnerDeps, nodeId: NodeId, output: unknown): Record<string, unknown> {
    const slots = toSlots(output);
    for (const [slot, value] of Object.entries(slots)) deps.blackboard.write(nodeId, slot, value);
    deps.outcomePorts.set(nodeId, new Set(Object.keys(slots)));
    return slots;
}

/** 失败落定：按 onError 策略 / settle failure according to the onError policy */
function settleFailure(deps: RunnerDeps, nodeId: NodeId, defNode: FlowNodeDef, cause: unknown): Record<string, unknown> {
    const policy = defNode.onError ?? 'failFast';
    if (policy === 'fallback') return settle(deps, nodeId, defNode.fallbackValue);
    const error = toFlowError(cause, runRef(deps, nodeId));
    if (policy === 'errorBranch') {
        const summary = { code: error.code, message: error.message };
        deps.blackboard.write(nodeId, 'error', summary);
        deps.outcomePorts.set(nodeId, new Set(['error']));
        return { error: summary };
    }
    throw error;
}

/** 可中止的重试间隔 / an abortable retry backoff */
async function retrySleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(flowError('FLOW_CANCELLED', 'cancelled during backoff'));
        }, { once: true });
    });
}

/** 带超时与取消的执行 / execute with timeout and cancellation */
function withTimeout<T>(work: Promise<T>, timeoutMs: number, nodeId: NodeId, flowId: string, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = timeoutMs > 0
            ? setTimeout(() => reject(flowError('NODE_TIMEOUT', `node "${nodeId}" timed out after ${timeoutMs}ms`, { flowId, nodeId })), timeoutMs)
            : undefined;
        const onAbort = () => reject(flowError('FLOW_CANCELLED', 'cancelled', { flowId, nodeId }));
        signal.addEventListener('abort', onAbort, { once: true });
        const cleanup = (): void => {
            if (timer !== undefined) clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
        };
        work.then(
            (value) => { cleanup(); resolve(value); },
            (cause) => { cleanup(); reject(cause); },
        );
    });
}
