/**
 * 拓扑调度器：就绪集并发调度 + 节点状态机 + 生命周期事件 + 失败传播。
 * The topological scheduler: ready-set scheduling with a concurrency cap, the
 * per-node status machine, lifecycle events and failure propagation. The
 * kernel passes no data and checks no node types: data semantics belong to the
 * upper layer's GExecutor; edge `when` predicates are injected at build time.
 */

import { defineToken } from '@veren/core';
import { toNodeError } from './errors.js';
import type {
    GEdge,
    GExecutor,
    GNode,
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

/** 默认就绪集并发上限 / default ready-set concurrency cap */
export const DEFAULT_CONCURRENCY = 4;

/** 状态上报能力令牌：注册在 run 子 context 上 / token of the status-reporting capability on the run context */
export const RunStatusToken = defineToken<GraphRunStatusService>('graphRunStatus');

/** 事件引用载荷 / the neutral event reference payload */
const refMeta = (graphId: string, runId: string, nodeId?: string) => ({ graphId, runId, nodeId });

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
const FAILURE_REASON: unique symbol = Symbol('veren:graph-failure');

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
function settleNode(
    env: ScheduleEnv,
    nodeId: string,
    status: GraphNodeStatus,
    patch: Partial<Omit<GraphNodeRecord, 'id' | 'status'>> = {},
): void {
    const record = env.records[nodeId]!;
    Object.assign(record, patch, { status });
    emitNodeStatus(env.runCtx, record);
}

/** 节点间共享的调度状态 / scheduling state shared across node tasks */
interface SharedState {
    pending: Set<string>;
    outgoing: Map<string, GEdge[]>;
    incoming: Map<string, number>;
    ready: string[];
    running: Set<Promise<void>>;
    failed: boolean;
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

/** 就绪集驱动循环 / the ready-set driver loop */
async function drive(graph: Graph, executor: GExecutor, env: ScheduleEnv): Promise<GraphRunStatus> {
    const { runCtx, records, controller } = env;
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
    while (shared.ready.length > 0 || shared.running.size > 0) {
        while (shared.ready.length > 0 && shared.running.size < env.concurrency && !controller.signal.aborted) {
            const id = shared.ready.shift()!;
            shared.pending.delete(id);
            const node = graph.nodes.find((candidate) => candidate.id === id)!;
            const task = runNode(node, executor, env, shared);
            shared.running.add(task);
            void task.finally(() => shared.running.delete(task));
        }
        if (shared.running.size === 0) break;
        await Promise.race([...shared.running]);
    }
    // 收尾：外部取消下所有未落定节点都是 cancelled；fail-fast 下未启动的
    // 失败可达节点是 skipped/upstream-failure。两种情况分开收尾，避免把
    // 取消写成 skipped（验收要求 cancel 后各节点进入 cancelled）。
    // Finalize: under an external cancel every unsettled node is cancelled;
    // under fail-fast, never-started failure-reachable nodes are skipped.
    // The two paths stay separate so a cancel is never recorded as a skip.
    const cancelledRun = isExternalCancel(controller.signal);
    if (shared.pending.size > 0) {
        const doomed = !cancelledRun && shared.failed
            ? reachableFrom(failedIds(records), shared.outgoing)
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

/** 跳过 id 自身及其下游子树 / skip id itself plus its downstream subtree */
function skipSubtree(
    id: string,
    shared: SharedState,
    env: ScheduleEnv,
    reason: 'upstream-failure' | 'upstream-condition',
): void {
    if (!shared.pending.has(id)) return;
    shared.pending.delete(id);
    settleNode(env, id, 'skipped', { skipReason: reason });
    skipDownstream(id, shared, env, reason);
}

/** 沿出边级联跳过（不含 id 自身）/ cascade a skip along outgoing edges (id itself untouched) */
function skipDownstream(
    id: string,
    shared: SharedState,
    env: ScheduleEnv,
    reason: 'upstream-failure' | 'upstream-condition',
): void {
    for (const edge of shared.outgoing.get(id) ?? []) {
        if (!shared.pending.has(edge.to)) continue;
        shared.pending.delete(edge.to);
        settleNode(env, edge.to, 'skipped', { skipReason: reason });
        skipDownstream(edge.to, shared, env, reason);
    }
}

/**
 * 取消级联：下游未落定节点同样是 cancelled（不是 skipped）/
 * Cancel cascade: unsettled downstream nodes become cancelled too (never skipped).
 */
function cancelDownstream(id: string, shared: SharedState, env: ScheduleEnv): void {
    for (const edge of shared.outgoing.get(id) ?? []) {
        if (!shared.pending.has(edge.to)) continue;
        shared.pending.delete(edge.to);
        settleNode(env, edge.to, 'cancelled');
        cancelDownstream(edge.to, shared, env);
    }
}

/** 上游 completed：求值出边条件并放行就绪集 / upstream completed: evaluate outgoing conditions */
function activateOutgoing(id: string, shared: SharedState, env: ScheduleEnv): void {
    for (const edge of shared.outgoing.get(id) ?? []) {
        if (edge.when?.(env.runCtx) === false) {
            // 只跳过该条件边下游子树（含边目标），不影响 from 的其他分支
            // Only the subtree below this condition edge (including its target) is skipped.
            skipSubtree(edge.to, shared, env, 'upstream-condition');
            continue;
        }
        const degree = shared.incoming.get(edge.to)! - 1;
        shared.incoming.set(edge.to, degree);
        if (degree === 0 && shared.pending.has(edge.to)) shared.ready.push(edge.to);
    }
}

/** 单节点生命周期：ready → veto? → running → post-execute → completed | failed | skipped | cancelled */
async function runNode(node: GNode, executor: GExecutor, env: ScheduleEnv, shared: SharedState): Promise<void> {
    const { runCtx, records, runId, controller } = env;
    const record = records[node.id]!;
    const meta = refMeta(runCtx.graphId, runId, node.id);
    const settleCancelled = (): void => {
        settleNode(env, node.id, 'cancelled', record.startedAt === undefined ? {} : { endedAt: Date.now() });
        cancelDownstream(node.id, shared, env);
    };
    const settleVeto = (): void => {
        settleNode(env, node.id, 'skipped', { skipReason: 'pre-execute-veto' });
        skipDownstream(node.id, shared, env, 'upstream-condition');
    };
    try {
        // 外部取消：节点与下游都记 cancelled（不是 skipped）/ external cancel: node and downstream are cancelled
        if (isExternalCancel(controller.signal)) return settleCancelled();
        settleNode(env, node.id, 'ready');
        // @mode bail：监听器返回真值即否决该节点（框架 isBailed 以真值为 bail，
        // false/undefined 视为放行，与 tools/pre-execute 的语义一致）
        // @mode bail: a truthy listener return vetoes the node (the framework's
        // isBailed treats truthy as bail; false/undefined let the node run).
        const veto = await runCtx.bail('graph/node-pre-execute', meta);
        // 取消优先于否决：运行已取消时节点落 cancelled，而不是 skipped
        // A cancel outranks a veto: on a cancelled run the node lands cancelled, not skipped.
        if (isExternalCancel(controller.signal)) return settleCancelled();
        if (veto) return settleVeto();
        settleNode(env, node.id, 'running', { startedAt: Date.now() });
        // 节点作用域：在 run 子 context 上按 nodeId 派生 / node scope derived from the run child context
        const nodeCtx = runCtx.extend({ nodeId: node.id }).isolate(node.id) as GraphRunContext;
        let output: unknown;
        try {
            output = await executor.execute(node, nodeCtx);
        } catch (cause) {
            // 取消期间的拒绝属于取消，不是失败 / a rejection during an external cancel is a cancel, not a failure
            if (isExternalCancel(controller.signal)) return settleCancelled();
            throw toNodeError(cause, { graphId: runCtx.graphId, runId, nodeId: node.id });
        }
        // @mode waterfall：监听器修改 envelope.output 并必须调 next()
        // @mode waterfall: listeners mutate envelope.output and must call next()
        const envelope = { output };
        runCtx.waterfall('graph/node-post-execute', meta, envelope, () => envelope.output);
        record.output = envelope.output;
        // 外部取消后落定的节点记为 cancelled；fail-fast 的通知不改变节点归属
        // Nodes settling after an external cancel are cancelled; a fail-fast notice does not relabel them.
        if (isExternalCancel(controller.signal)) return settleCancelled();
        settleNode(env, node.id, 'completed', { endedAt: Date.now() });
        activateOutgoing(node.id, shared, env);
    } catch (cause) {
        // 取消期间抛出的错误同样记 cancelled / an error thrown while cancelling still lands as cancelled
        if (isExternalCancel(controller.signal)) return settleCancelled();
        const error = toNodeError(cause, { graphId: runCtx.graphId, runId, nodeId: node.id });
        settleNode(env, node.id, 'failed', { error, endedAt: Date.now() });
        runCtx.emit('graph/node-error', error);
        if (env.strategy({ node, error, records }) === 'failFast') {
            shared.failed = true;
            controller.abort(FAILURE_REASON);
        }
        skipDownstream(node.id, shared, env, 'upstream-failure');
    }
}
