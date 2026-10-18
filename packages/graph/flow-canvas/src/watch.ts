/**
 * 运行投影：把 flow/node-status 事件流变成一个按节点可订阅的句柄。
 *
 * Run projection: turn the flow/node-status event stream into a per-node
 * subscription handle. It never polls and never reads logs; the kernel's
 * neutral status event is the only source. Listeners are removed when the run
 * ends, so a stream cannot leak into the next run.
 */

import type { Context } from '@deepseek-ai/cordis';
import type { NodeId } from '@deepseek-ai/dsh-graph-flow-api';
import type { FlowEngine, FlowNodeRecord, FlowRunHandle, FlowRunResult } from '@deepseek-ai/dsh-graph-flow-engine';
import type {
    CanvasNodeRuntime,
    CanvasNodeStatusChange,
    CanvasRunProjection,
    CanvasRunSnapshot,
    CanvasStatusListener,
} from './types.js';

/** 状态单调序：hydration 后到达的迟到事件不得把节点拉回 pending/ready。等待授权与 running 同级：授权落定后可以回到 running。 */
const STATUS_RANK: Record<CanvasNodeRuntime['status'], number> = {
    pending: 0,
    ready: 1,
    running: 2,
    'awaiting-approval': 2,
    completed: 3,
    failed: 3,
    skipped: 3,
    cancelled: 3,
};
const TERMINAL = new Set<CanvasNodeRuntime['status']>(['completed', 'failed', 'skipped', 'cancelled']);

/** flow 节点记录 → 画布运行节点；缺失的可选字段不落键 / map a flow record; absent optional fields are omitted */
function toRuntime(id: string, record: FlowNodeRecord): CanvasNodeRuntime {
    const node: CanvasNodeRuntime = { id: id as NodeId, status: record.status };
    if (record.skipReason !== undefined) node.skipReason = record.skipReason;
    if (record.error) node.error = record.error;
    if (record.recovered) node.recovered = record.recovered;
    if (record.approvals !== undefined) node.approvals = record.approvals;
    if (record.startedAt !== undefined) node.startedAt = record.startedAt;
    if (record.endedAt !== undefined) node.endedAt = record.endedAt;
    return node;
}

/** 订阅一个已启动的运行；启动时先 hydration，再接收增量 / watch a run: hydrate first, then consume changes */
export function watchRun(
    ctx: Context,
    engine: FlowEngine,
    handle: FlowRunHandle,
    listener?: CanvasStatusListener,
): CanvasRunProjection {
    const definition = engine.getFlow(handle.flowId);
    const nodes: Record<string, CanvasNodeRuntime> = {};
    for (const node of definition?.nodes ?? []) nodes[node.id] = { id: node.id, status: 'pending' };
    const snapshot: CanvasRunSnapshot = {
        schemaVersion: 1,
        flowId: handle.flowId,
        runId: handle.runId,
        status: 'running',
        nodes,
        result: null,
    };
    // 任意时刻挂载：先同步 hydration。已完成的 run 直接取终态；运行中的 run 取引擎的实时逐节点状态。
    // Watch at any time: hydrate synchronously first. A finished run takes the final result; a live run takes the engine's live node states.
    const detail = engine.getRun(handle.runId);
    if (detail?.result) {
        applyResult(snapshot, detail.result);
    } else if (detail) {
        snapshot.status = detail.status;
        for (const [id, record] of Object.entries(detail.nodes ?? {})) snapshot.nodes[id] = toRuntime(id, record);
    }
    const listeners = new Set<CanvasStatusListener>();
    if (listener) listeners.add(listener);
    const disposers: Array<() => boolean> = [];
    let active = true;

    const cleanup = (): void => {
        active = false;
        for (const dispose of disposers.splice(0)) dispose();
    };
    const notify = (change: CanvasNodeStatusChange): void => {
        for (const current of [...listeners]) {
            try {
                current(change);
            } catch (cause) {
                // 订阅方异常不能打断运行 / a subscriber failure must not break the run
                ctx.logger.error('flow-canvas status listener failed / 画布状态监听器失败', cause);
            }
        }
    };
    disposers.push(
        ctx.on('flow/node-status', (payload) => {
            if (!active || payload.runId !== handle.runId) return;
            const current = snapshot.nodes[payload.nodeId];
            // 终态吸收 + 状态序单调：hydration 之后迟到的 pending/ready 不得造成回退
            // Terminal states absorb, and rank must not decrease: a late pending/ready cannot roll a hydrated node back.
            if (current && (TERMINAL.has(current.status) || STATUS_RANK[payload.status] < STATUS_RANK[current.status])) return;
            const node = current ?? (snapshot.nodes[payload.nodeId] = { id: payload.nodeId as NodeId, status: 'pending' });
            node.status = payload.status;
            if (payload.skipReason === undefined) delete node.skipReason; else node.skipReason = payload.skipReason;
            if (payload.error === undefined) delete node.error; else node.error = payload.error;
            if (payload.recovered === undefined) delete node.recovered; else node.recovered = payload.recovered;
            if (payload.approvals === undefined) delete node.approvals; else node.approvals = payload.approvals;
            if (payload.startedAt === undefined) delete node.startedAt; else node.startedAt = payload.startedAt;
            if (payload.endedAt === undefined) delete node.endedAt; else node.endedAt = payload.endedAt;
            notify({ flowId: payload.flowId, runId: payload.runId, nodeId: node.id, ...node });
        }),
        ctx.on('flow/run-end', (payload) => {
            if (payload.runId !== handle.runId) return;
            // run-end 时引擎已回写 result：同步对齐，避免 status 已终态而 result/nodes 还是旧的
            // The engine has written the result by run-end: align synchronously so status, result and nodes settle together.
            const detail = engine.getRun(handle.runId);
            if (detail?.result) applyResult(snapshot, detail.result);
            else snapshot.status = payload.status;
            cleanup();
        }),
    );

    const finished = handle.awaitCompletion()
        .then((result) => {
            applyResult(snapshot, result);
            return snapshot;
        })
        .finally(cleanup);
    return {
        flowId: handle.flowId,
        runId: handle.runId,
        handle,
        snapshot: () => snapshot,
        subscribe: (next) => {
            if (!active) return () => void 0;
            listeners.add(next);
            return () => void listeners.delete(next);
        },
        finished,
        dispose: () => {
            listeners.clear();
            cleanup();
        },
    };
}

/** 用最终 RunResult 对齐快照（事件可能被迟到订阅漏掉）/ align the snapshot with the final result */
function applyResult(snapshot: CanvasRunSnapshot, result: FlowRunResult): void {
    snapshot.result = result;
    snapshot.status = result.status;
    const nodes: Record<string, CanvasNodeRuntime> = {};
    for (const [id, record] of Object.entries(result.nodes)) nodes[id] = toRuntime(id, record);
    snapshot.nodes = nodes;
}
