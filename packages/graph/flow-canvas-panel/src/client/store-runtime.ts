/**
 * Mutable per-instance runtime shared by the store's domain controllers.
 *
 * `createFlowCanvasStore` used to be one large closure; the store is now split
 * into domain controllers (list loading, run streaming) that all operate on the
 * mutable `StoreRuntime` created here. Epochs guard against stale async work:
 * bumping `flowEpoch`/`runEpoch` invalidates in-flight projections and run
 * subscriptions of previous selections.
 *
 * store 各领域控制器共享的可变实例运行时。`createFlowCanvasStore` 过去是一个大闭包；
 * 现在 store 拆成多个领域控制器（列表加载、运行流），都作用于这里创建的可变
 * `StoreRuntime`。epoch 防护陈旧的异步工作：递增 `flowEpoch`/`runEpoch` 即可让
 * 上一次选择在途的投影与运行订阅全部失效。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/store-runtime
 */

import type { FlowCanvasRemoteApi } from '../types.ts'
import type { SavedView } from './view-storage.ts'
import { readSaved } from './view-storage.ts'
import { defaultStorage } from './view-storage.ts'
import { persistView } from './view-storage.ts'
import type { FlowCanvasStoreOptions, FlowCanvasViewState, FlowCanvasViewStorage } from './view-state.ts'

/** How many initial-list attempts tolerate a warming connection. */
export const LIST_RETRIES = 8

/** The state every store instance starts from. */
const INITIAL: FlowCanvasViewState = {
    flows: [],
    flowId: undefined,
    flow: undefined,
    run: undefined,
    selectedNodeId: undefined,
    phase: 'loading',
    error: undefined,
}

/** The mutable store runtime handed to every domain controller. */
export interface StoreRuntime {
    /** The mounted Remote namespace face. */
    readonly api: FlowCanvasRemoteApi
    /** Persistence for the reload handoff (`null` disables it). */
    readonly storage: FlowCanvasViewStorage | null
    /** Delay between initial-list retries while the connection warms, in ms. */
    readonly retryDelayMs: number
    /** The currently published view state. */
    state: FlowCanvasViewState
    /** The persisted subset kept in sync with `storage`. */
    saved: SavedView
    /** Whether the first subscriber triggered the initial load. */
    loaded: boolean
    /** Whether an initial-list request is in flight. */
    loading: boolean
    /** Set once disposed; every controller checks it before acting. */
    disposed: boolean
    /** Pending initial-list retry timer. */
    retryTimer: ReturnType<typeof setTimeout> | undefined
    /** Invalidation epoch for flow projections. */
    flowEpoch: number
    /** Invalidation epoch for run subscriptions. */
    runEpoch: number
    /** The run id the stream is (being) attached to; deduplicates resumes. */
    resumedRunId: string | undefined
    /** The active run subscription controller. */
    subscription: AbortController | undefined
    /** Snapshot listeners of the observable source. */
    readonly listeners: Set<() => void>
    /** Merge a patch into the state and notify the listeners. */
    publish(patch: Partial<FlowCanvasViewState>): void
    /** Record the saved subset and persist it (never throws). */
    save(next: SavedView): void
    /** Flip the state to the error phase with a single-line message. */
    fail(cause: unknown): void
    /** Cancel a pending initial-list retry, if any. */
    clearRetry(): void
}

/** Message of an unknown thrown value. */
function messageOf(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/** Merge a patch into the state and notify the listeners. */
function publishPatch(runtime: StoreRuntime, patch: Partial<FlowCanvasViewState>): void {
    runtime.state = { ...runtime.state, ...patch }
    for (const listener of [...runtime.listeners]) listener()
}

/** Record the saved subset and persist it (never throws). */
function persistSaved(runtime: StoreRuntime, next: SavedView): void {
    runtime.saved = next
    persistView(runtime.storage, next)
}

/** Flip the state to the error phase with a single-line message. */
function failRuntime(runtime: StoreRuntime, cause: unknown): void {
    runtime.publish({ phase: 'error', error: messageOf(cause) })
}

/** Cancel a pending initial-list retry, if any. */
function clearRetryTimer(runtime: StoreRuntime): void {
    if (runtime.retryTimer !== undefined) {
        clearTimeout(runtime.retryTimer)
        runtime.retryTimer = undefined
    }
}

/**
 * Create the shared runtime for one store instance.
 * @param api - the `ctx.remote.flowCanvas` face.
 * @param options - optional storage and retry cadence (tests use these).
 */
export function createStoreRuntime(
    api: FlowCanvasRemoteApi,
    options: FlowCanvasStoreOptions = {},
): StoreRuntime {
    const storage = options.storage === undefined ? defaultStorage() : options.storage
    const runtime: StoreRuntime = {
        api,
        storage,
        retryDelayMs: options.retryDelayMs ?? 500,
        state: INITIAL,
        saved: readSaved(storage),
        loaded: false,
        loading: false,
        disposed: false,
        retryTimer: undefined,
        flowEpoch: 0,
        runEpoch: 0,
        resumedRunId: undefined,
        subscription: undefined,
        listeners: new Set(),
        publish(patch) { publishPatch(runtime, patch) },
        save(next) { persistSaved(runtime, next) },
        fail(cause) { failRuntime(runtime, cause) },
        clearRetry() { clearRetryTimer(runtime) },
    }
    return runtime
}
