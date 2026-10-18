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
 * 画布面板的浏览器视图 store。它持有列表/选择/运行订阅状态，每次变化发布一个稳定的
 * 快照对象。整页刷新会丢掉该对象，因此选中的 flow 与当前 runId 保存在 `sessionStorage`；
 * 第一个订阅者负责加载列表（连接未就绪时重试），并在存在恢复的 runId 时重新订阅宿主的
 * 该次运行，让状态从当前投影继续，而不是新开一次运行。
 *
 * 业务数据仍来自宿主：store 只投影 `FlowCanvasRemoteApi` 的回答，并保存交互状态。
 * 宿主返回的 snapshot/result 视为只读；状态变更叠加到新的 `nodes` 映射上。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/store
 */

import type {
    CanvasFlow,
    CanvasNodeRuntime,
    CanvasNodeStatusChange,
    CanvasRunSnapshot,
} from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowSummary } from '@deepseek-ai/dsh-graph-flow-engine'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowCanvasFrame, FlowCanvasRemoteApi } from '../types.ts'

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

/** Session-scoped handoff across a full page reload. */
const STORAGE_KEY = 'dsh.flow-canvas.view'

/** How many initial-list attempts tolerate a warming connection. */
const LIST_RETRIES = 8

const INITIAL: FlowCanvasViewState = {
    flows: [],
    flowId: undefined,
    flow: undefined,
    run: undefined,
    selectedNodeId: undefined,
    phase: 'loading',
    error: undefined,
}

/** The persisted subset that survives a reload. */
interface SavedView {
    readonly flowId?: string | undefined
    readonly runId?: string | undefined
}

/** Narrow parsed JSON to a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read the persisted view, discarding malformed or foreign data. */
function readSaved(storage: FlowCanvasViewStorage | null): SavedView {
    try {
        const raw = storage?.getItem(STORAGE_KEY)
        if (raw === null || raw === undefined) return {}
        const value: unknown = JSON.parse(raw)
        if (!isRecord(value)) return {}
        const flowId = value['flowId']
        const runId = value['runId']
        return {
            ...typeof flowId === 'string' ? { flowId } : {},
            ...typeof runId === 'string' ? { runId } : {},
        }
    } catch {
        return {}
    }
}

/** Resolve the browser session storage without throwing in privacy modes. */
function defaultStorage(): FlowCanvasViewStorage | null {
    try {
        return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage
    } catch {
        return null
    }
}

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
    const storage = options.storage === undefined ? defaultStorage() : options.storage
    const retryDelayMs = options.retryDelayMs ?? 500
    let saved = readSaved(storage)
    let state: FlowCanvasViewState = INITIAL
    const listeners = new Set<() => void>()
    let loaded = false
    let loading = false
    let disposed = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let flowEpoch = 0
    let runEpoch = 0
    let resumedRunId: string | undefined
    let subscription: AbortController | undefined

    const publish = (patch: Partial<FlowCanvasViewState>): void => {
        state = { ...state, ...patch }
        for (const listener of [...listeners]) listener()
    }

    const save = (next: SavedView): void => {
        saved = next
        try {
            if (next.flowId === undefined && next.runId === undefined) storage?.removeItem(STORAGE_KEY)
            else storage?.setItem(STORAGE_KEY, JSON.stringify(next))
        } catch {
            // A blocked storage must not break the panel; reload resume is optional.
        }
    }

    const fail = (cause: unknown): void => {
        publish({ phase: 'error', error: messageOf(cause) })
    }

    const project = async (flowId: string): Promise<void> => {
        const mine = ++flowEpoch
        try {
            const result = await api.project({ flowId })
            if (!result.ok) throw new Error(result.error.message)
            if (mine !== flowEpoch || disposed) return
            save({ ...saved, flowId })
            publish({ flow: result.value, phase: 'ready', error: undefined })
        } catch (cause) {
            if (mine === flowEpoch && !disposed) fail(cause)
        }
    }

    /** Re-attach to a run that was live before the reload. */
    const resume = (runId: string): void => {
        const mine = ++runEpoch
        subscription?.abort()
        const controller = new AbortController()
        subscription = controller
        void (async () => {
            try {
                await consume(runId, controller.signal, mine)
            } catch {
                // A stale run id (Host restarted, or the run was released) must
                // not turn the whole panel into an error: keep the flow usable
                // and forget only the run.
                if (controller.signal.aborted || mine !== runEpoch || disposed) return
                save({ ...saved, runId: undefined })
                publish({ run: undefined })
            }
        })()
    }

    const load = async (attempt = 0): Promise<void> => {
        if (loading || disposed) return
        loading = true
        if (state.flows.length === 0) publish({ phase: 'loading', error: undefined })
        try {
            const result = await api.list({})
            if (!result.ok) throw new Error(result.error.message)
            const flows = result.value.flows
            const preferred = saved.flowId !== undefined && flows.some(flow => flow.id === saved.flowId)
                ? saved.flowId
                : flows[0]?.id
            publish({ flows, flowId: preferred, phase: preferred === undefined ? 'ready' : state.phase, error: undefined })
            if (preferred !== undefined) {
                // A missing persisted flow (removed since the reload) also drops
                // its run: never resume a run that belongs to another flow.
                save(preferred === saved.flowId ? { ...saved, flowId: preferred } : { flowId: preferred })
            }
            if (preferred !== undefined && (state.flow === undefined || state.flow.flowId !== preferred)) {
                await project(preferred)
            }
            const restoredRun = saved.runId
            if (!disposed && state.flow !== undefined && state.run === undefined
                && restoredRun !== undefined && resumedRunId !== restoredRun) {
                resumedRunId = restoredRun
                resume(restoredRun)
            }
            loading = false
        } catch (cause) {
            loading = false
            // The shell can mount the panel before the connection handshake
            // finishes; retry a cold list instead of showing an empty Host.
            if (!disposed && state.flows.length === 0 && attempt < LIST_RETRIES) {
                retryTimer = setTimeout(() => {
                    retryTimer = undefined
                    void load(attempt + 1)
                }, retryDelayMs)
                return
            }
            if (!disposed) fail(cause)
        }
    }

    const consume = async (runId: string, signal: AbortSignal, mine: number): Promise<void> => {
        for await (const frame of api.subscribe({ runId }, signal)) {
            if (mine !== runEpoch || disposed) return
            applyFrame(frame)
        }
    }

    const applyFrame = (frame: FlowCanvasFrame): void => {
        if (frame.type === 'snapshot') {
            publish({
                run: {
                    runId: frame.snapshot.runId,
                    status: frame.snapshot.status,
                    nodes: frame.snapshot.nodes,
                    result: frame.snapshot.result,
                },
                error: undefined,
            })
            return
        }
        const run = state.run
        if (run === undefined) return
        publish({ run: { ...run, nodes: withChange(run.nodes, frame.change) } })
    }

    const startRun = (): void => {
        const flowId = state.flowId
        if (flowId === undefined || state.run?.status === 'running') return
        subscription?.abort()
        const mine = ++runEpoch
        publish({ run: undefined, selectedNodeId: undefined, error: undefined })
        void (async () => {
            try {
                const result = await api.run({ flowId })
                if (!result.ok) throw new Error(result.error.message)
                if (mine !== runEpoch || disposed) return
                const { runId, snapshot } = result.value
                resumedRunId = runId
                save({ flowId, runId })
                applyFrame({ type: 'snapshot', snapshot })
                subscription = new AbortController()
                await consume(runId, subscription.signal, mine)
            } catch (cause) {
                if (mine !== runEpoch || disposed || subscription?.signal.aborted === true) return
                fail(cause)
            }
        })()
    }

    return {
        source: {
            getSnapshot: () => state,
            subscribe(listener) {
                listeners.add(listener)
                if (!loaded) {
                    loaded = true
                    void load()
                }
                return () => {
                    listeners.delete(listener)
                }
            },
        },
        selectFlow(flowId) {
            if (flowId === state.flowId) return
            subscription?.abort()
            subscription = undefined
            runEpoch += 1
            resumedRunId = undefined
            save({ flowId })
            publish({ flowId, flow: undefined, run: undefined, selectedNodeId: undefined, phase: 'loading', error: undefined })
            void project(flowId)
        },
        startRun,
        selectNode(nodeId) {
            publish({ selectedNodeId: nodeId })
        },
        refresh() {
            if (retryTimer !== undefined) {
                clearTimeout(retryTimer)
                retryTimer = undefined
            }
            void load()
        },
        answerApproval(requestId, decision) {
            const runId = state.run?.runId
            if (runId === undefined) return
            void (async () => {
                try {
                    const result = await api.answer({ runId, requestId, decision, actor: 'canvas-user' })
                    // 已答复/已超时的请求不是面板故障：状态流是权威来源。
                    // An already-answered or timed-out request is not a panel
                    // failure: the status stream is authoritative.
                    if (!result.ok && !result.error.message.includes('not pending')) {
                        throw new Error(result.error.message)
                    }
                } catch (cause) {
                    if (!disposed) fail(cause)
                }
            })()
        },
        cancelRun() {
            const runId = state.run?.runId
            if (runId === undefined) return
            void (async () => {
                try {
                    const result = await api.cancel({ runId })
                    if (!result.ok) throw new Error(result.error.message)
                } catch (cause) {
                    if (!disposed) fail(cause)
                }
            })()
        },
        dispose() {
            disposed = true
            if (retryTimer !== undefined) {
                clearTimeout(retryTimer)
                retryTimer = undefined
            }
            subscription?.abort()
            runEpoch += 1
            listeners.clear()
        },
    }
}

/**
 * Layer one status change onto a new node map; received records are not mutated.
 * @param nodes - the current run node map.
 * @param change - the status transition.
 * @returns a new node map.
 */
export function withChange(
    nodes: Readonly<Record<string, CanvasNodeRuntime>>,
    change: CanvasNodeStatusChange,
): Record<string, CanvasNodeRuntime> {
    const next: Record<string, CanvasNodeRuntime> = { ...nodes }
    next[change.nodeId] = {
        id: change.id,
        status: change.status,
        ...change.skipReason === undefined ? {} : { skipReason: change.skipReason },
        ...change.error === undefined ? {} : { error: change.error },
        ...change.recovered === undefined ? {} : { recovered: change.recovered },
        ...change.approvals === undefined ? {} : { approvals: change.approvals },
        ...change.startedAt === undefined ? {} : { startedAt: change.startedAt },
        ...change.endedAt === undefined ? {} : { endedAt: change.endedAt },
    }
    return next
}

/**
 * Message of an unknown thrown value.
 * @param cause - the thrown value.
 * @returns a single-line message.
 */
function messageOf(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}
