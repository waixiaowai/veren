/**
 * Per-run environment: the execution ports shared by the run body and the
 * executor assembly, the flow→kernel graph mapping, and the node-scoped
 * approval face.
 *
 * 单次运行的环境：运行主体与执行器组装共享的执行端口、flow 图 → 内核图的映射，
 * 以及节点级授权面。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/run-env
 */

import type { GraphRunContext } from '@deepseek-ai/dsh-graph-core';
import type {
    FlowApprovalBroker,
    FlowApprovalOpenContext,
    FlowBlackboard,
    FlowNodeApprovalPort,
    NodeId,
    NodeRegistry,
} from '@deepseek-ai/dsh-graph-flow-api';
import type { CompiledFlow, FlowNodeDefMap, RunEntry } from './types.js';

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
