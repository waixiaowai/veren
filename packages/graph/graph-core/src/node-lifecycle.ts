/**
 * 单节点生命周期与级联落定：ready → veto? → running → post-execute →
 * completed | failed | skipped | cancelled，以及取消/失败/条件否决沿出边的
 * 下游级联。调度循环在 `scheduler.ts`；本文件只回答"一个节点如何落定"。
 *
 * One node's lifecycle plus the cascade settles: ready → veto? → running →
 * post-execute → completed | failed | skipped | cancelled, and how a
 * cancel/failure/condition-veto cascades along outgoing edges. The scheduling
 * loop lives in `scheduler.ts`; this file only answers "how does one node settle".
 *
 * @module @veren/graph-core/node-lifecycle
 */

import { toNodeError } from './errors.js';
import type { GEdge, GExecutor, GNode, GraphRunContext } from './types.js';
import {
    FAILURE_REASON,
    isExternalCancel,
    refMeta,
    settleNode,
    type ScheduleEnv,
} from './scheduler.js';

/** 节点间共享的调度状态 / scheduling state shared across node tasks */
export interface SharedState {
    pending: Set<string>;
    outgoing: Map<string, GEdge[]>;
    incoming: Map<string, number>;
    ready: string[];
    running: Set<Promise<void>>;
    failed: boolean;
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

/** 取消落定：本节点记 cancelled（带 endedAt），下游级联 cancelled / settle a cancel: the node lands cancelled (with endedAt) and downstream cascades */
function settleCancelledNode(node: GNode, env: ScheduleEnv, shared: SharedState): void {
    const record = env.records[node.id]!;
    settleNode(env, node.id, 'cancelled', record.startedAt === undefined ? {} : { endedAt: Date.now() });
    cancelDownstream(node.id, shared, env);
}

/** 否决落定：本节点 skipped/pre-execute-veto，下游级联跳过 / settle a veto: the node lands skipped/pre-execute-veto and downstream cascades */
function settleVetoNode(node: GNode, env: ScheduleEnv, shared: SharedState): void {
    settleNode(env, node.id, 'skipped', { skipReason: 'pre-execute-veto' });
    skipDownstream(node.id, shared, env, 'upstream-condition');
}

/** 单节点执行结果：产物，或"取消期间被拒" / one node execution result: an output, or a rejection during an external cancel */
type NodeExecution = { kind: 'output'; output: unknown } | { kind: 'cancelled' };

/** 执行节点产物；取消期间的拒绝归入 cancelled，其余错误原样上抛 / execute the node; a rejection during a cancel becomes 'cancelled', any other error rethrows */
async function executeNode(node: GNode, executor: GExecutor, env: ScheduleEnv, nodeCtx: GraphRunContext): Promise<NodeExecution> {
    try {
        return { kind: 'output', output: await executor.execute(node, nodeCtx) };
    } catch (cause) {
        // 取消期间的拒绝属于取消，不是失败 / a rejection during an external cancel is a cancel, not a failure
        if (isExternalCancel(env.controller.signal)) return { kind: 'cancelled' };
        throw toNodeError(cause, { graphId: env.runCtx.graphId, runId: env.runId, nodeId: node.id });
    }
}

/**
 * 失败处理：落 failed、广播 node-error、fail-fast 中断、下游级联跳过。
 * Handle a failure: settle failed, emit node-error, abort on fail-fast and cascade the skip downstream.
 */
function failNode(node: GNode, env: ScheduleEnv, shared: SharedState, cause: unknown): void {
    const { runCtx, records, runId, controller } = env;
    // 取消期间抛出的错误同样记 cancelled / an error thrown while cancelling still lands as cancelled
    if (isExternalCancel(controller.signal)) return settleCancelledNode(node, env, shared);
    const error = toNodeError(cause, { graphId: runCtx.graphId, runId, nodeId: node.id });
    settleNode(env, node.id, 'failed', { error, endedAt: Date.now() });
    runCtx.emit('graph/node-error', error);
    if (env.strategy({ node, error, records }) === 'failFast') {
        shared.failed = true;
        controller.abort(FAILURE_REASON);
    }
    skipDownstream(node.id, shared, env, 'upstream-failure');
}

/**
 * 后执行瀑布 → 回写 output → 落 completed → 放行下游。外部取消后落定的节点
 * 记为 cancelled（fail-fast 的通知不改变节点归属），此时返回 false。
 * Post-execute waterfall → write the output back → settle completed → activate
 * downstream. A node settling after an external cancel lands cancelled (a
 * fail-fast notice does not relabel it); that path returns false.
 */
function completeNode(node: GNode, env: ScheduleEnv, shared: SharedState, meta: ReturnType<typeof refMeta>, output: unknown): boolean {
    // @mode waterfall：监听器修改 envelope.output 并必须调 next()
    // @mode waterfall: listeners mutate envelope.output and must call next()
    const envelope = { output };
    env.runCtx.waterfall('graph/node-post-execute', meta, envelope, () => envelope.output);
    env.records[node.id]!.output = envelope.output;
    if (isExternalCancel(env.controller.signal)) {
        settleCancelledNode(node, env, shared);
        return false;
    }
    settleNode(env, node.id, 'completed', { endedAt: Date.now() });
    activateOutgoing(node.id, shared, env);
    return true;
}

/** 单节点生命周期：ready → veto? → running → post-execute → completed | failed | skipped | cancelled */
export async function runNode(node: GNode, executor: GExecutor, env: ScheduleEnv, shared: SharedState): Promise<void> {
    const { runCtx, runId, controller } = env;
    const meta = refMeta(runCtx.graphId, runId, node.id);
    try {
        // 外部取消：节点与下游都记 cancelled（不是 skipped）/ external cancel: node and downstream are cancelled
        if (isExternalCancel(controller.signal)) return settleCancelledNode(node, env, shared);
        settleNode(env, node.id, 'ready');
        // @mode bail：监听器返回真值即否决该节点（框架 isBailed 以真值为 bail，false/undefined 视为放行，与 tools/pre-execute 的语义一致）
        // @mode bail: a truthy listener return vetoes the node (isBailed treats truthy as bail; false/undefined let the node run).
        const veto = await runCtx.bail('graph/node-pre-execute', meta);
        // 取消优先于否决：运行已取消时节点落 cancelled，而不是 skipped / a cancel outranks a veto.
        if (isExternalCancel(controller.signal)) return settleCancelledNode(node, env, shared);
        if (veto) return settleVetoNode(node, env, shared);
        settleNode(env, node.id, 'running', { startedAt: Date.now() });
        // 节点作用域：在 run 子 context 上按 nodeId 派生 / node scope derived from the run child context
        const nodeCtx = runCtx.extend({ nodeId: node.id }).isolate(node.id) as GraphRunContext;
        const executed = await executeNode(node, executor, env, nodeCtx);
        if (executed.kind === 'cancelled') return settleCancelledNode(node, env, shared);
        completeNode(node, env, shared, meta, executed.output);
    } catch (cause) {
        failNode(node, env, shared, cause);
    }
}
