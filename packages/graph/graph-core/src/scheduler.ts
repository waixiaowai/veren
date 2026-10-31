/**
 * 拓扑调度器：就绪集并发调度 + 生命周期事件 + 失败传播的运行级编排。
 * The topological scheduler: ready-set scheduling with a concurrency cap, the
 * run-level lifecycle events and failure propagation. The kernel passes no
 * data and checks no node types: data semantics belong to the upper layer's
 * GExecutor; edge `when` predicates are injected at build time. The per-node
 * lifecycle lives in `node-lifecycle.ts`.
 */

import { defineToken } from '@veren/core';
import type {
    GEdge,
    GExecutor,
    Graph,
    GraphFailureStrategy,
    GraphNodeRecord,
    GraphNodeStatus,
    GraphRunContext,
    GraphRunResult,
    GraphRunStatus,
    GraphRunStatusService,
} from './types.js';
import { failedIds, reachableFrom } from './validate.js';
import { runNode, type SharedState } from './node-lifecycle.js';

/** 默认就绪集并发上限 / default ready-set concurrency cap */
export const DEFAULT_CONCURRENCY = 4;

/** 状态上报能力令牌：注册在 run 子 context 上 / token of the status-reporting capability on the run context */
export const RunStatusToken = defineToken<GraphRunStatusService>('graphRunStatus');

/** 事件引用载荷 / the neutral event reference payload */
export const refMeta = (graphId: string, runId: string, nodeId?: string) => ({ graphId, runId, nodeId });

/**
 * 广播一次节点状态迁移：内核只报告中性状态，不解释节点业务。
 * Emit one node status transition: the kernel reports neutral state only and
 * does not interpret node business.
 */
export function emitNodeStatus(runCtx: GraphRunContext, record: GraphNodeRecord): void {
    runCtx.emit('graph/node-status', {
        graphId: runCtx.graphId,
        runId: runCtx.runId,
        nodeId: record.id,
        status: record.status,
        skipReason: record.skipReason,
        error: record.error,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
    });
}

/** 外部取消的 abort reason 标记 / the abort reason marker for an external cancel */
export const CANCEL_REASON: unique symbol = Symbol('veren:graph-cancel');

/** fail-fast 通知的 abort reason 标记（只是通知，不改变节点归属）/
    the abort reason marker for a fail-fast notification (a notice only; it does not relabel nodes) */
export const FAILURE_REASON: unique symbol = Symbol('veren:graph-failure');

/**
 * 判断 signal 是否来自外部取消：fail-fast 的通知不算取消。
 * Whether the signal comes from an external cancel; a fail-fast notice is not a cancel.
 */
export function isExternalCancel(signal: AbortSignal): boolean {
    return signal.aborted && signal.reason === CANCEL_REASON;
}

/** 调度环境 / the scheduling environment */
export interface ScheduleEnv {
    runCtx: GraphRunContext;
    records: Record<string, GraphNodeRecord>;
    runId: string;
    controller: AbortController;
    concurrency: number;
    strategy: GraphFailureStrategy;
}

/** 落定节点状态并广播状态事件 / settle a node status and emit the status event */
export function settleNode(
    env: ScheduleEnv,
    nodeId: string,
    status: GraphNodeStatus,
    patch: Partial<Omit<GraphNodeRecord, 'id' | 'status'>> = {},
): void {
    const record = env.records[nodeId]!;
    Object.assign(record, patch, { status });
    emitNodeStatus(env.runCtx, record);
}

/** 调度主体（拆出纯函数，便于控制行数）/ the scheduling body (extracted to keep functions small) */
export async function schedule(graph: Graph, executor: GExecutor, env: ScheduleEnv): Promise<GraphRunResult> {
    const { runCtx, records, runId } = env;
    const finish = (status: GraphRunStatus): GraphRunResult => {
        runCtx.emit('graph/run-end', { graphId: graph.id, runId, status });
        return { graphId: graph.id, runId, status, nodes: records };
    };
    // @mode serial 拦截：真值即拒绝启动 / serial intercept: truthy refuses the run
    if (await runCtx.serial('graph/run-starting', { graphId: graph.id, runId })) {
        for (const record of Object.values(records)) {
            settleNode(env, record.id, 'skipped', { skipReason: 'run-rejected' });
        }
        return finish('cancelled');
    }
    runCtx.emit('graph/run-start', { graphId: graph.id, runId });
    // 初始 pending 快照：订阅方无需轮询即可拿到全部节点的起始状态
    // The initial pending snapshot: subscribers get every node's starting state without polling.
    for (const record of Object.values(records)) emitNodeStatus(runCtx, record);
    const status = await drive(graph, executor, env);
    return finish(status);
}

/** 从图构建调度共享状态（入度 / 出边 / 初始就绪集）/ build the shared scheduling state (indegree, outgoing edges, initial ready set) */
function buildSharedState(graph: Graph): SharedState {
    const shared: SharedState = {
        pending: new Set(graph.nodes.map((node) => node.id)),
        outgoing: new Map(graph.nodes.map((node) => [node.id, [] as GEdge[]])),
        incoming: new Map(graph.nodes.map((node) => [node.id, 0])),
        ready: [],
        running: new Set(),
        failed: false,
    };
    for (const edge of graph.edges) {
        shared.incoming.set(edge.to, shared.incoming.get(edge.to)! + 1);
        shared.outgoing.get(edge.from)!.push(edge);
    }
    shared.ready = graph.nodes.filter((node) => shared.incoming.get(node.id) === 0).map((node) => node.id);
    return shared;
}

/** 在并发上限内启动一批就绪节点 / launch ready nodes up to the concurrency cap */
function launchReady(graph: Graph, executor: GExecutor, env: ScheduleEnv, shared: SharedState): void {
    while (shared.ready.length > 0 && shared.running.size < env.concurrency && !env.controller.signal.aborted) {
        const id = shared.ready.shift()!;
        shared.pending.delete(id);
        const node = graph.nodes.find((candidate) => candidate.id === id)!;
        const task = runNode(node, executor, env, shared);
        shared.running.add(task);
        void task.finally(() => shared.running.delete(task));
    }
}

/**
 * 收尾：外部取消下所有未落定节点都是 cancelled；fail-fast 下未启动的
 * 失败可达节点是 skipped/upstream-failure。两种情况分开收尾，避免把
 * 取消写成 skipped（验收要求 cancel 后各节点进入 cancelled）。
 * Finalize: under an external cancel every unsettled node is cancelled;
 * under fail-fast, never-started failure-reachable nodes are skipped.
 * The two paths stay separate so a cancel is never recorded as a skip.
 */
function settleUnfinished(env: ScheduleEnv, shared: SharedState): GraphRunStatus {
    const cancelledRun = isExternalCancel(env.controller.signal);
    if (shared.pending.size > 0) {
        const doomed = !cancelledRun && shared.failed
            ? reachableFrom(failedIds(env.records), shared.outgoing)
            : new Set<string>();
        for (const id of shared.pending) {
            if (cancelledRun) {
                settleNode(env, id, 'cancelled');
                continue;
            }
            settleNode(env, id, 'skipped', { skipReason: doomed.has(id) ? 'upstream-failure' : 'upstream-cancel' });
        }
    }
    if (cancelledRun) return 'cancelled';
    if (shared.failed) return 'failed';
    return 'completed';
}

/** 就绪集驱动循环 / the ready-set driver loop */
async function drive(graph: Graph, executor: GExecutor, env: ScheduleEnv): Promise<GraphRunStatus> {
    const shared = buildSharedState(graph);
    while (shared.ready.length > 0 || shared.running.size > 0) {
        launchReady(graph, executor, env, shared);
        if (shared.running.size === 0) break;
        await Promise.race([...shared.running]);
    }
    return settleUnfinished(env, shared);
}
