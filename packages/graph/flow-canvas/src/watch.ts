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
import type { FlowEngine, FlowRunHandle, FlowRunResult } from '@deepseek-ai/dsh-graph-flow-engine';
import type {
    CanvasNodeRuntime,
    CanvasNodeStatusChange,
    CanvasRunProjection,
    CanvasRunSnapshot,
    CanvasStatusListener,
} from './types.js';

/** 订阅一个已启动的运行，并立即播种全部节点的 pending 状态 / watch a started run, seeding pending states */
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
        status: handle.status(),
        nodes,
        result: null,
    };
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
            const node = snapshot.nodes[payload.nodeId] ?? (snapshot.nodes[payload.nodeId] = { id: payload.nodeId as NodeId, status: 'pending' });
            Object.assign(node, {
                status: payload.status,
                skipReason: payload.skipReason,
                error: payload.error,
                startedAt: payload.startedAt,
                endedAt: payload.endedAt,
            });
            notify({ flowId: payload.flowId, runId: payload.runId, nodeId: node.id, ...node });
        }),
        ctx.on('flow/run-end', (payload) => {
            if (payload.runId !== handle.runId) return;
            snapshot.status = payload.status;
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
    for (const [id, record] of Object.entries(result.nodes)) {
        nodes[id] = {
            id: id as NodeId,
            status: record.status,
            skipReason: record.skipReason,
            error: record.error,
            startedAt: record.startedAt,
            endedAt: record.endedAt,
        };
    }
    snapshot.nodes = nodes;
}
