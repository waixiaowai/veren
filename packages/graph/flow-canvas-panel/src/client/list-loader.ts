/**
 * List-projection domain of the canvas panel store.
 *
 * The first subscriber triggers `load`, which fetches the flow list (retrying
 * while the connection is still warming), picks the persisted or first flow,
 * projects it and resumes a restored run. `selectFlow` and `refresh` reuse the
 * same projection path.
 *
 * 画布面板 store 的列表投影领域。第一个订阅者触发 `load`：拉取 flow 列表（连接未
 * 就绪时重试）、挑选持久化或首个 flow、投影它并恢复已记录的运行。`selectFlow` 与
 * `refresh` 复用同一条投影路径。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/list-loader
 */

import type { FlowSummary } from '@deepseek-ai/dsh-graph-flow-engine'
import { LIST_RETRIES } from './store-runtime.ts'
import type { StoreRuntime } from './store-runtime.ts'
import { resume } from './run-stream.ts'

/**
 * Fetch the flow list; retry a cold list while the connection warms instead of
 * showing an empty Host (the shell can mount the panel before the handshake).
 * 拉取 flow 列表；连接未就绪时重试冷的列表而不是展示空宿主（外壳可能在握手完成前
 * 就挂载面板）。
 */
export async function load(rt: StoreRuntime, attempt = 0): Promise<void> {
    if (rt.loading || rt.disposed) return
    rt.loading = true
    if (rt.state.flows.length === 0) rt.publish({ phase: 'loading', error: undefined })
    try {
        const result = await rt.api.list({})
        if (!result.ok) throw new Error(result.error.message)
        await applyList(rt, result.value.flows)
        rt.loading = false
    } catch (cause) {
        rt.loading = false
        retryOrFail(rt, cause, attempt)
    }
}

/** Apply the list: pick the preferred flow, project it, resume a restored run. */
async function applyList(rt: StoreRuntime, flows: readonly FlowSummary[]): Promise<void> {
    const preferred = pickPreferred(rt, flows)
    rt.publish({ flows, flowId: preferred, phase: preferred === undefined ? 'ready' : rt.state.phase, error: undefined })
    if (preferred !== undefined) {
        // A missing persisted flow (removed since the reload) also drops
        // its run: never resume a run that belongs to another flow.
        // 持久化的 flow 已消失（刷新后被移除）时连同它的运行一起丢弃：
        // 绝不恢复属于其他 flow 的运行。
        rt.save(preferred === rt.saved.flowId ? { ...rt.saved, flowId: preferred } : { flowId: preferred })
    }
    if (preferred !== undefined && (rt.state.flow === undefined || rt.state.flow.flowId !== preferred)) {
        await project(rt, preferred)
    }
    const restoredRun = rt.saved.runId
    if (!rt.disposed && rt.state.flow !== undefined && rt.state.run === undefined
        && restoredRun !== undefined && rt.resumedRunId !== restoredRun) {
        rt.resumedRunId = restoredRun
        resume(rt, restoredRun)
    }
}

/** The persisted flow when it still exists, otherwise the first listed flow. */
function pickPreferred(rt: StoreRuntime, flows: readonly FlowSummary[]): string | undefined {
    const savedFlowId = rt.saved.flowId
    return savedFlowId !== undefined && flows.some((flow) => flow.id === savedFlowId)
        ? savedFlowId
        : flows[0]?.id
}

/** Retry while the list is cold and attempts remain; otherwise surface the error. */
function retryOrFail(rt: StoreRuntime, cause: unknown, attempt: number): void {
    if (!rt.disposed && rt.state.flows.length === 0 && attempt < LIST_RETRIES) {
        rt.retryTimer = setTimeout(() => {
            rt.retryTimer = undefined
            void load(rt, attempt + 1)
        }, rt.retryDelayMs)
        return
    }
    if (!rt.disposed) rt.fail(cause)
}

/** Project one flow through the Host; a stale answer is discarded silently. */
export async function project(rt: StoreRuntime, flowId: string): Promise<void> {
    const mine = ++rt.flowEpoch
    try {
        const result = await rt.api.project({ flowId })
        if (!result.ok) throw new Error(result.error.message)
        if (mine !== rt.flowEpoch || rt.disposed) return
        rt.save({ ...rt.saved, flowId })
        rt.publish({ flow: result.value, phase: 'ready', error: undefined })
    } catch (cause) {
        if (mine === rt.flowEpoch && !rt.disposed) rt.fail(cause)
    }
}

/** Show one registered flow: drop the current run and project the new one. */
export function selectFlow(rt: StoreRuntime, flowId: string): void {
    if (flowId === rt.state.flowId) return
    rt.subscription?.abort()
    rt.subscription = undefined
    rt.runEpoch += 1
    rt.resumedRunId = undefined
    rt.save({ flowId })
    rt.publish({ flowId, flow: undefined, run: undefined, selectedNodeId: undefined, phase: 'loading', error: undefined })
    void project(rt, flowId)
}

/** Re-read the flow list, cancelling a pending retry first. */
export function refresh(rt: StoreRuntime): void {
    rt.clearRetry()
    void load(rt)
}
