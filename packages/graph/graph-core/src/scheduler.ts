/**
 * 拓扑调度器：就绪集并发调度 + 节点状态机 + 生命周期事件 + 失败传播。
 * The topological scheduler: ready-set scheduling with a concurrency cap, the
 * per-node status machine, lifecycle events and failure propagation. The
 * kernel passes no data and checks no node types: data semantics belong to the
 * upper layer's GExecutor; edge `when` predicates are injected at build time.
 */

import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { defineToken, provideValue } from '@veren/core';
import { toNodeError } from './errors.js';
import { validateGraph } from './validate.js';
import type {
    GEdge,
    GExecutor,
    GNode,
    Graph,
    GraphFailureStrategy,
    GraphNodeRecord,
    GraphRunContext,
    GraphRunResult,
    GraphRunStatus,
    GraphRunStatusService,
    GraphSkipReason,
} from './types.js';

/** 默认就绪集并发上限 / default ready-set concurrency cap */
export const DEFAULT_CONCURRENCY = 4;

/** 状态上报能力令牌：注册在 run 子 context 上 / token of the status-reporting capability on the run context */
export const RunStatusToken = defineToken<GraphRunStatusService>('graphRunStatus');

/** 默认失败策略：fail-fast / the default failure strategy: fail-fast */
const failFast: GraphFailureStrategy = () => 'failFast';

/** 一次内核 run 的句柄：等待结果 + 主动取消 / handle of one kernel run: await the result and cancel */
export interface GraphRunHandle {
    readonly runId: string;
    readonly result: Promise<GraphRunResult>;
    /** 通知式取消：signal 只置位，执行方自愿响应 / cooperative cancel: the signal is set, executors opt in */
    cancel(): void;
}

/** 事件引用载荷 / the neutral event reference payload */
const refMeta = (graphId: string, runId: string, nodeId?: string) => ({ graphId, runId, nodeId });

/**
 * 运行一次图：校验 → 拦截启动 → 并发调度 → 事件与状态机 → 汇总结果。
 * Run one graph: validate → intercept start → concurrent scheduling → events
 * and status machine → aggregate the result.
 */
export function runGraph(
    graph: Graph,
    executor: GExecutor,
    options: {
        ctx: Context;
        runId?: string;
        concurrency?: number;
        onNodeFailure?: GraphFailureStrategy;
    },
): GraphRunHandle {
    validateGraph(graph);
    const runId = options.runId ?? randomUUID();
    const controller = new AbortController();
    // run 子 context + 状态上报服务的独立作用域（并发 run 互不冲突）
    // The run child context plus an isolated scope for the status service (concurrent runs never collide).
    const runCtx = options.ctx
        .extend({ graphId: graph.id, runId, signal: controller.signal })
        .isolate(RunStatusToken, Symbol(runId)) as GraphRunContext;
    const records: Record<string, GraphNodeRecord> = Object.fromEntries(
        graph.nodes.map((node) => [node.id, { id: node.id, status: 'pending' }]),
    );
    const status: GraphRunStatusService = {
        setStatus: (nodeId, nodeStatus, patch) => {
            Object.assign(records[nodeId]!, patch, { status: nodeStatus });
        },
    };
    const disposeStatus = provideValue(runCtx, RunStatusToken, status);
    const result = schedule(graph, executor, {
        runCtx,
        records,
        runId,
        controller,
        concurrency: Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY),
        strategy: options.onNodeFailure ?? failFast,
    }).finally(disposeStatus);
    return { runId, result, cancel: () => controller.abort(CANCEL_REASON) };
}

/** 外部取消的 abort reason 标记 / the abort reason marker for external cancels */
const CANCEL_REASON = Symbol('veren:graph-cancel');

/** 调度环境 / the scheduling environment */
interface ScheduleEnv {
    runCtx: GraphRunContext;
    records: Record<string, GraphNodeRecord>;
    runId: string;
    controller: AbortController;
    concurrency: number;
    strategy: GraphFailureStrategy;
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
async function schedule(graph: Graph, executor: GExecutor, env: ScheduleEnv): Promise<GraphRunResult> {
    const { runCtx, records, runId } = env;
    const finish = (status: GraphRunStatus): GraphRunResult => {
        runCtx.emit('graph/run-end', { graphId: graph.id, runId, status });
        return { graphId: graph.id, runId, status, nodes: records };
    };
    // @mode serial 拦截：真值即拒绝启动 / serial intercept: truthy refuses the run
    if (await runCtx.serial('graph/run-starting', { graphId: graph.id, runId })) {
        for (const record of Object.values(records)) {
            record.status = 'skipped';
            record.skipReason = 'run-rejected';
        }
        return finish('cancelled');
    }
    runCtx.emit('graph/run-start', { graphId: graph.id, runId });
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
    // 收尾：未被启动的 pending 节点按"失败可达性"归为 skipped 或 cancelled
    // Finalize: never-started pending nodes become skipped (failure-reachable) or cancelled.
    if (shared.pending.size > 0) {
        const doomed = shared.failed ? reachableFrom(failedIds(records), shared.outgoing) : new Set<string>();
        for (const id of shared.pending) {
            const record = records[id]!;
            record.status = doomed.has(id) ? 'skipped' : 'cancelled';
            record.skipReason = doomed.has(id) ? 'upstream-failure' : 'upstream-cancel';
        }
    }
    if (shared.failed) return 'failed';
    return controller.signal.aborted ? 'cancelled' : 'completed';
}

/** 收集落定为 failed 的节点 / collect nodes that settled as failed */
function failedIds(records: Record<string, GraphNodeRecord>): string[] {
    return Object.values(records).filter((record) => record.status === 'failed').map((record) => record.id);
}

/** 从失败节点沿边可达的节点集合 / nodes reachable from the failed set along edges */
function reachableFrom(roots: string[], outgoing: Map<string, GEdge[]>): Set<string> {
    const seen = new Set<string>();
    const queue = [...roots];
    for (let head = 0; head < queue.length; head++) {
        for (const edge of outgoing.get(queue[head]!) ?? []) {
            if (!seen.has(edge.to)) {
                seen.add(edge.to);
                queue.push(edge.to);
            }
        }
    }
    return seen;
}

/** 跳过 id 自身及其下游子树 / skip id itself plus its downstream subtree */
function skipSubtree(
    id: string,
    shared: SharedState,
    records: Record<string, GraphNodeRecord>,
    reason: 'upstream-failure' | 'upstream-condition' | 'upstream-cancel',
): void {
    if (!shared.pending.has(id)) return;
    shared.pending.delete(id);
    const record = records[id]!;
    record.status = 'skipped';
    record.skipReason = reason;
    skipDownstream(id, shared, records, reason);
}

/** 沿出边级联跳过（不含 id 自身）/ cascade a skip along outgoing edges (id itself untouched) */
function skipDownstream(
    id: string,
    shared: SharedState,
    records: Record<string, GraphNodeRecord>,
    reason: 'upstream-failure' | 'upstream-condition' | 'upstream-cancel',
): void {
    for (const edge of shared.outgoing.get(id) ?? []) {
        if (!shared.pending.has(edge.to)) continue;
        shared.pending.delete(edge.to);
        const record = records[edge.to]!;
        record.status = 'skipped';
        record.skipReason = reason;
        skipDownstream(edge.to, shared, records, reason);
    }
}

/** 上游 completed：求值出边条件并放行就绪集 / upstream completed: evaluate outgoing conditions */
function activateOutgoing(
    id: string,
    shared: SharedState,
    records: Record<string, GraphNodeRecord>,
    runCtx: GraphRunContext,
): void {
    for (const edge of shared.outgoing.get(id) ?? []) {
        if (edge.when?.(runCtx) === false) {
            // 只跳过该条件边下游子树（含边目标），不影响 from 的其他分支
            // Only the subtree below this condition edge (including its target) is skipped.
            skipSubtree(edge.to, shared, records, 'upstream-condition');
            continue;
        }
        const degree = shared.incoming.get(edge.to)! - 1;
        shared.incoming.set(edge.to, degree);
        if (degree === 0 && shared.pending.has(edge.to)) shared.ready.push(edge.to);
    }
}

/** 单节点生命周期：ready → veto? → running → post-execute → completed | failed | skipped */
async function runNode(node: GNode, executor: GExecutor, env: ScheduleEnv, shared: SharedState): Promise<void> {
    const { runCtx, records, runId, controller } = env;
    const record = records[node.id]!;
    const meta = refMeta(runCtx.graphId, runId, node.id);
    const settleSkip = (status: 'skipped' | 'cancelled', reason: GraphSkipReason): void => {
        record.status = status;
        record.skipReason = reason;
        const cascade =
            reason === 'upstream-failure'
                ? 'upstream-failure'
                : reason === 'upstream-cancel'
                  ? 'upstream-cancel'
                  : 'upstream-condition';
        skipDownstream(node.id, shared, records, cascade);
    };
    try {
        if (controller.signal.aborted) return settleSkip('cancelled', 'upstream-cancel');
        record.status = 'ready';
        // @mode bail：监听器返回真值即否决该节点（框架 isBailed 以真值为 bail，
        // false/undefined 视为放行，与 tools/pre-execute 的语义一致）
        // @mode bail: a truthy listener return vetoes the node (the framework's
        // isBailed treats truthy as bail; false/undefined let the node run).
        const veto = await runCtx.bail('graph/node-pre-execute', meta);
        if (veto) return settleSkip('skipped', 'pre-execute-veto');
        record.status = 'running';
        record.startedAt = Date.now();
        // 节点作用域：在 run 子 context 上按 nodeId 派生 / node scope derived from the run child context
        const nodeCtx = runCtx.extend({ nodeId: node.id }).isolate(node.id) as GraphRunContext;
        let output: unknown;
        try {
            output = await executor.execute(node, nodeCtx);
        } catch (cause) {
            throw toNodeError(cause, { graphId: runCtx.graphId, runId, nodeId: node.id });
        }
        // @mode waterfall：监听器修改 envelope.output 并必须调 next()
        // @mode waterfall: listeners mutate envelope.output and must call next()
        const envelope = { output };
        runCtx.waterfall('graph/node-post-execute', meta, envelope, () => envelope.output);
        record.output = envelope.output;
        // 外部取消后落定的节点记为 cancelled（执行方自愿响应 signal）
        // Nodes settling after an external cancel are marked cancelled (executors opt in).
        if (controller.signal.reason === CANCEL_REASON) return settleSkip('cancelled', 'upstream-cancel');
        record.status = 'completed';
        record.endedAt = Date.now();
        activateOutgoing(node.id, shared, records, runCtx);
    } catch (cause) {
        const error = toNodeError(cause, { graphId: runCtx.graphId, runId, nodeId: node.id });
        record.status = 'failed';
        record.error = error;
        record.endedAt = Date.now();
        runCtx.emit('graph/node-error', error);
        if (env.strategy({ node, error, records }) === 'failFast') {
            shared.failed = true;
            controller.abort();
        }
        skipDownstream(node.id, shared, records, 'upstream-failure');
    }
}
