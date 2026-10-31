/**
 * View-state types of the canvas panel store.
 *
 * The store publishes one stable `FlowCanvasViewState` object per change; React
 * reads it through the `HostObservable` source. The persistence face and the
 * store's public action face live here as well, so components and tests can
 * name them without importing the implementation.
 *
 * 画布面板 store 的视图状态类型。store 每次变化发布一个稳定的 `FlowCanvasViewState`
 * 对象，React 通过 `HostObservable` 源读取。持久化接口与 store 的公开动作面也放在这里，
 * 组件与测试无需引入实现即可引用它们。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/view-state
 */

import type {
    CanvasFlow,
    CanvasNodeRuntime,
    CanvasRunSnapshot,
} from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowSummary } from '@deepseek-ai/dsh-graph-flow-engine'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** One run as the panel renders it; `result` stays `null` until the run settles. */
export interface RunView {
    readonly runId: string
    readonly status: CanvasRunSnapshot['status']
    readonly nodes: Readonly<Record<string, CanvasNodeRuntime>>
    readonly result: CanvasRunSnapshot['result']
}

/** Everything the panel renders from one stable snapshot. */
export interface FlowCanvasViewState {
    readonly flows: readonly FlowSummary[]
    readonly flowId: string | undefined
    readonly flow: CanvasFlow | undefined
    readonly run: RunView | undefined
    readonly selectedNodeId: string | undefined
    readonly phase: 'loading' | 'ready' | 'error'
    readonly error: string | undefined
}

/** Minimal storage face; `sessionStorage` satisfies it. */
export interface FlowCanvasViewStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/** Testable construction options. */
export interface FlowCanvasStoreOptions {
    /** Storage for the reload handoff; `null` disables persistence. */
    readonly storage?: FlowCanvasViewStorage | null
    /** Delay between initial-list retries while the connection warms, in ms. */
    readonly retryDelayMs?: number
}

/** The canvas panel store face handed to the plugin's inject closure. */
export interface FlowCanvasStore {
    /** Stable observable source bound as `useFlow` by the renderer. */
    readonly source: HostObservable<FlowCanvasViewState>
    /** Show one registered flow. */
    readonly selectFlow: (flowId: string) => void
    /** Start a run of the selected flow. */
    readonly startRun: () => void
    /** Select (or clear) the inspected node. */
    readonly selectNode: (nodeId: string | undefined) => void
    /** Re-read the flow list. */
    readonly refresh: () => void
    /** Answer the pending approval of the current run. */
    readonly answerApproval: (requestId: string, decision: 'allow' | 'deny') => void
    /** Cooperatively cancel the current run (a pending approval is withdrawn). */
    readonly cancelRun: () => void
    /** Stop the active subscription and release listeners. */
    readonly dispose: () => void
}
