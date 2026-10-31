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
import type {
    FlowEngine,
    FlowNodeRecord,
    FlowNodeStatusPayload,
    FlowRunEndPayload,
    FlowRunHandle,
    FlowRunResult,
} from '@deepseek-ai/dsh-graph-flow-engine';
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

/** CanvasNodeRuntime 上可按事件增删的可选字段 / optional runtime fields a status payload may set or clear */
type OptionalRuntimeField = 'skipReason' | 'error' | 'recovered' | 'approvals' | 'startedAt' | 'endedAt';

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

/** 可选字段按事件值同步：undefined 删键，否则落值 / sync one optional field: undefined removes the key, otherwise set it */
function syncOptional<K extends OptionalRuntimeField>(
    node: CanvasNodeRuntime,
    key: K,
    value: CanvasNodeRuntime[K] | undefined,
): void {
    if (value === undefined) delete node[key];
    else node[key] = value;
}

/** 以 pending 初始化全部已知节点，构造运行快照 / build the run snapshot with every known node pending */
function createRunSnapshot(engine: FlowEngine, handle: FlowRunHandle): CanvasRunSnapshot {
    const definition = engine.getFlow(handle.flowId);
    const nodes: Record<string, CanvasNodeRuntime> = {};
    for (const node of definition?.nodes ?? []) nodes[node.id] = { id: node.id, status: 'pending' };
    return {
        schemaVersion: 1,
        flowId: handle.flowId,
        runId: handle.runId,
        status: 'running',
        nodes,
        result: null,
    };
}

/**
 * 任意时刻挂载：先同步 hydration。已完成的 run 直接取终态；运行中的 run 取引擎的实时逐节点状态。
 * Watch at any time: hydrate synchronously first. A finished run takes the final result; a live run takes the engine's live node states.
 */
function hydrateRunDetail(engine: FlowEngine, handle: FlowRunHandle, snapshot: CanvasRunSnapshot): void {
    const detail = engine.getRun(handle.runId);
    if (detail?.result) {
        applyResult(snapshot, detail.result);
    } else if (detail) {
        snapshot.status = detail.status;
        for (const [id, record] of Object.entries(detail.nodes ?? {})) snapshot.nodes[id] = toRuntime(id, record);
    }
}

/** 通知全部订阅方；订阅方异常不能打断运行 / notify every subscriber; a subscriber failure must not break the run */
function notifyListeners(
    ctx: Context,
    listeners: ReadonlySet<CanvasStatusListener>,
    change: CanvasNodeStatusChange,
): void {
    for (const current of [...listeners]) {
        try {
            current(change);
        } catch (cause) {
            ctx.logger.error('flow-canvas status listener failed / 画布状态监听器失败', cause);
        }
    }
}

/** 把一次状态迁移写进快照并通知订阅方 / write one status change into the snapshot and notify */
function applyStatusPayload(
    payload: FlowNodeStatusPayload,
    snapshot: CanvasRunSnapshot,
    notify: (change: CanvasNodeStatusChange) => void,
): void {
    const current = snapshot.nodes[payload.nodeId];
    // 终态吸收 + 状态序单调：hydration 之后迟到的 pending/ready 不得造成回退
    // Terminal states absorb, and rank must not decrease: a late pending/ready cannot roll a hydrated node back.
    if (current && (TERMINAL.has(current.status) || STATUS_RANK[payload.status] < STATUS_RANK[current.status])) return;
    const node = current ?? (snapshot.nodes[payload.nodeId] = { id: payload.nodeId as NodeId, status: 'pending' });
    node.status = payload.status;
    syncOptional(node, 'skipReason', payload.skipReason);
    syncOptional(node, 'error', payload.error);
    syncOptional(node, 'recovered', payload.recovered);
    syncOptional(node, 'approvals', payload.approvals);
    syncOptional(node, 'startedAt', payload.startedAt);
    syncOptional(node, 'endedAt', payload.endedAt);
    notify({ flowId: payload.flowId, runId: payload.runId, nodeId: node.id, ...node });
}

/** run-end：用引擎已回写的结果对齐快照 / run-end: align the snapshot with the result the engine has written */
function settleRunEnd(
    payload: FlowRunEndPayload,
    engine: FlowEngine,
    handle: FlowRunHandle,
    snapshot: CanvasRunSnapshot,
): void {
    // run-end 时引擎已回写 result：同步对齐，避免 status 已终态而 result/nodes 还是旧的
    // The engine has written the result by run-end: align synchronously so status, result and nodes settle together.
    const detail = engine.getRun(handle.runId);
    if (detail?.result) applyResult(snapshot, detail.result);
    else snapshot.status = payload.status;
}

/** 运行完成：终态对齐 + 清理监听器 / run completion: settle the final state and clean the listeners up */
function awaitRunCompletion(
    handle: FlowRunHandle,
    snapshot: CanvasRunSnapshot,
    cleanup: () => void,
): Promise<CanvasRunSnapshot> {
    return handle.awaitCompletion()
        .then((result) => {
            applyResult(snapshot, result);
            return snapshot;
        })
        .finally(cleanup);
}

/** 组装投影句柄 / assemble the projection handle over the mutable snapshot */
function buildProjection(
    handle: FlowRunHandle,
    snapshot: CanvasRunSnapshot,
    finished: Promise<CanvasRunSnapshot>,
    listeners: Set<CanvasStatusListener>,
    isLive: () => boolean,
    cleanup: () => void,
): CanvasRunProjection {
    return {
        flowId: handle.flowId,
        runId: handle.runId,
        handle,
        snapshot: () => snapshot,
        subscribe: (next) => {
            if (!isLive()) return () => void 0;
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

/** 订阅一个已启动的运行；启动时先 hydration，再接收增量 / watch a run: hydrate first, then consume changes */
export function watchRun(
    ctx: Context,
    engine: FlowEngine,
    handle: FlowRunHandle,
    listener?: CanvasStatusListener,
): CanvasRunProjection {
    const snapshot = createRunSnapshot(engine, handle);
    hydrateRunDetail(engine, handle, snapshot);
    const listeners = new Set<CanvasStatusListener>();
    if (listener) listeners.add(listener);
    const disposers: Array<() => boolean> = [];
    let active = true;
    const cleanup = (): void => {
        active = false;
        for (const dispose of disposers.splice(0)) dispose();
    };
    const isLive = (): boolean => active;
    const notify = (change: CanvasNodeStatusChange): void => notifyListeners(ctx, listeners, change);
    // 事件接线：状态迁移直接写快照并通知；run-end 同步引擎终态并摘除监听器。
    // Event wiring: a status change writes the snapshot and notifies; run-end settles the final state and unwires.
    disposers.push(
        ctx.on('flow/node-status', (payload) => {
            if (!isLive() || payload.runId !== handle.runId) return;
            applyStatusPayload(payload, snapshot, notify);
        }),
        ctx.on('flow/run-end', (payload) => {
            if (payload.runId !== handle.runId) return;
            settleRunEnd(payload, engine, handle, snapshot);
            cleanup();
        }),
    );
    const finished = awaitRunCompletion(handle, snapshot, cleanup);
    return buildProjection(handle, snapshot, finished, listeners, isLive, cleanup);
}

/** 用最终 RunResult 对齐快照（事件可能被迟到订阅漏掉）/ align the snapshot with the final result */
function applyResult(snapshot: CanvasRunSnapshot, result: FlowRunResult): void {
    snapshot.result = result;
    snapshot.status = result.status;
    const nodes: Record<string, CanvasNodeRuntime> = {};
    for (const [id, record] of Object.entries(result.nodes)) nodes[id] = toRuntime(id, record);
    snapshot.nodes = nodes;
}
