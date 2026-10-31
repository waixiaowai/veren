/**
 * Browser view store for the canvas panel.
 *
 * It owns the list/selection/run subscription state and publishes one stable
 * snapshot object per change. A full page reload loses this object, so the
 * selected flow and the current run id are kept in `sessionStorage`; the first
 * subscriber loads the list (with retries while the connection is warming) and,
 * when a run id was restored, re-subscribes to that Host run so its statuses
 * continue from the current projection instead of from a fresh run.
 *
 * Business data still comes from the Host: this store only projects
 * `FlowCanvasRemoteApi` answers and keeps interaction state. Snapshot and
 * result objects received from the Host are treated as read-only; status
 * changes are layered onto a new `nodes` map.
 *
 * The entry only assembles the domain controllers; the responsibilities live in
 * their own modules: view-state types, reload persistence, the shared runtime,
 * list projection and the run stream.
 *
 * 画布面板的浏览器视图 store。它持有列表/选择/运行订阅状态，每次变化发布一个稳定的
 * 快照对象。整页刷新会丢掉该对象，因此选中的 flow 与当前 runId 保存在 `sessionStorage`；
 * 第一个订阅者负责加载列表（连接未就绪时重试），并在存在恢复的 runId 时重新订阅宿主的
 * 该次运行，让状态从当前投影继续，而不是新开一次运行。
 *
 * 业务数据仍来自宿主：store 只投影 `FlowCanvasRemoteApi` 的回答，并保存交互状态。
 * 宿主返回的 snapshot/result 视为只读；状态变更叠加到新的 `nodes` 映射上。
 *
 * 本入口只做组装；各职责都在独立模块里：视图状态类型、刷新持久化、共享运行时、
 * 列表投影与运行流。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/store
 */

import type { FlowCanvasRemoteApi } from '../types.ts'
import { createStoreRuntime } from './store-runtime.ts'
import type { StoreRuntime } from './store-runtime.ts'
import { answerApproval, cancelRun, startRun } from './run-stream.ts'
import { load, refresh, selectFlow } from './list-loader.ts'
import type { FlowCanvasStore, FlowCanvasStoreOptions } from './view-state.ts'

export type { FlowCanvasViewState, FlowCanvasStoreOptions, FlowCanvasStore, FlowCanvasViewStorage, RunView } from './view-state.ts'
export { withChange } from './run-stream.ts'

/**
 * Create the store over one mounted Remote namespace.
 * @param api - the `ctx.remote.flowCanvas` face.
 * @param options - optional storage and retry cadence (tests use these).
 * @returns the observable source and the panel actions.
 */
export function createFlowCanvasStore(
    api: FlowCanvasRemoteApi,
    options: FlowCanvasStoreOptions = {},
): FlowCanvasStore {
    const runtime = createStoreRuntime(api, options)
    return createStoreFacade(runtime)
}

/** Bind the panel actions to one shared runtime. */
function createStoreFacade(runtime: StoreRuntime): FlowCanvasStore {
    return {
        source: {
            getSnapshot: () => runtime.state,
            subscribe(listener) {
                runtime.listeners.add(listener)
                if (!runtime.loaded) {
                    runtime.loaded = true
                    void load(runtime)
                }
                return () => {
                    runtime.listeners.delete(listener)
                }
            },
        },
        selectFlow: (flowId) => selectFlow(runtime, flowId),
        startRun: () => startRun(runtime),
        selectNode: (nodeId) => runtime.publish({ selectedNodeId: nodeId }),
        refresh: () => refresh(runtime),
        answerApproval: (requestId, decision) => answerApproval(runtime, requestId, decision),
        cancelRun: () => cancelRun(runtime),
        dispose: () => disposeStore(runtime),
    }
}

/**
 * Stop the active subscription, cancel pending retries and release listeners.
 * 停止活动订阅、取消待重试并释放监听器。
 */
function disposeStore(runtime: StoreRuntime): void {
    runtime.disposed = true
    runtime.clearRetry()
    runtime.subscription?.abort()
    runtime.runEpoch += 1
    runtime.listeners.clear()
}
