/**
 * Run-stream domain of the canvas panel store.
 *
 * One controller owns everything tied to a single Host run: re-attaching to a
 * run that was live before a reload (`resume`), consuming the frame stream,
 * starting a new run, answering its pending approval and cancelling it. All
 * functions operate on the shared `StoreRuntime` and stop acting once their
 * epoch is stale or the store is disposed.
 *
 * 画布面板 store 的运行流领域。一个控制器持有与单次宿主运行相关的一切：重新挂接
 * 刷新前仍在跑的运行（`resume`）、消费帧流、启动新运行、答复挂起授权与取消。
 * 所有函数都作用于共享的 `StoreRuntime`，一旦 epoch 过期或 store 已释放即不再行动。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/run-stream
 */

import type { CanvasNodeRuntime, CanvasNodeStatusChange } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowCanvasFrame } from '../types.ts'
import type { StoreRuntime } from './store-runtime.ts'
import type { RunView } from './view-state.ts'

/**
 * Re-attach to a run that was live before the reload. A stale run id (Host
 * restarted, or the run was released) must not turn the whole panel into an
 * error: keep the flow usable and forget only the run.
 * 重新挂接刷新前仍在跑的运行。陈旧的 runId（宿主重启或运行已释放）不能把整个面板
 * 变成错误页：流程保持可用，只忘掉这一次运行。
 */
export function resume(rt: StoreRuntime, runId: string): void {
    const mine = ++rt.runEpoch
    rt.subscription?.abort()
    const controller = new AbortController()
    rt.subscription = controller
    void (async () => {
        try {
            await consume(rt, runId, controller.signal, mine)
        } catch {
            if (controller.signal.aborted || mine !== rt.runEpoch || rt.disposed) return
            rt.save({ ...rt.saved, runId: undefined })
            rt.publish({ run: undefined })
        }
    })()
}

/** Drain one run's frame stream until it closes or the epoch goes stale. */
async function consume(rt: StoreRuntime, runId: string, signal: AbortSignal, mine: number): Promise<void> {
    for await (const frame of rt.api.subscribe({ runId }, signal)) {
        if (mine !== rt.runEpoch || rt.disposed) return
        applyFrame(rt, frame)
    }
}

/** Layer one frame onto the view state: snapshots replace, changes patch nodes. */
function applyFrame(rt: StoreRuntime, frame: FlowCanvasFrame): void {
    if (frame.type === 'snapshot') {
        const snapshot = frame.snapshot
        const run: RunView = {
            runId: snapshot.runId,
            status: snapshot.status,
            nodes: snapshot.nodes,
            result: snapshot.result,
        }
        rt.publish({ run, error: undefined })
        return
    }
    const run = rt.state.run
    if (run === undefined) return
    rt.publish({ run: { ...run, nodes: withChange(run.nodes, frame.change) } })
}

/** Start a run of the selected flow (no-op while one is already running). */
export function startRun(rt: StoreRuntime): void {
    const flowId = rt.state.flowId
    if (flowId === undefined || rt.state.run?.status === 'running') return
    rt.subscription?.abort()
    const mine = ++rt.runEpoch
    rt.publish({ run: undefined, selectedNodeId: undefined, error: undefined })
    void beginRun(rt, flowId, mine)
}

/** Request the Host run and attach the frame stream. */
async function beginRun(rt: StoreRuntime, flowId: string, mine: number): Promise<void> {
    try {
        const result = await rt.api.run({ flowId })
        if (!result.ok) throw new Error(result.error.message)
        if (mine !== rt.runEpoch || rt.disposed) return
        const { runId, snapshot } = result.value
        rt.resumedRunId = runId
        rt.save({ flowId, runId })
        applyFrame(rt, { type: 'snapshot', snapshot })
        rt.subscription = new AbortController()
        await consume(rt, runId, rt.subscription.signal, mine)
    } catch (cause) {
        if (mine !== rt.runEpoch || rt.disposed || rt.subscription?.signal.aborted === true) return
        rt.fail(cause)
    }
}

/**
 * Answer the pending approval of the current run. An already-answered or
 * timed-out request is not a panel failure: the status stream is authoritative.
 * 答复当前运行的挂起授权。已答复/已超时的请求不是面板故障：状态流才是权威来源。
 */
export function answerApproval(rt: StoreRuntime, requestId: string, decision: 'allow' | 'deny'): void {
    const runId = rt.state.run?.runId
    if (runId === undefined) return
    void (async () => {
        try {
            const result = await rt.api.answer({ runId, requestId, decision, actor: 'canvas-user' })
            if (!result.ok && !result.error.message.includes('not pending')) {
                throw new Error(result.error.message)
            }
        } catch (cause) {
            if (!rt.disposed) rt.fail(cause)
        }
    })()
}

/** Cooperatively cancel the current run (a pending approval is withdrawn). */
export function cancelRun(rt: StoreRuntime): void {
    const runId = rt.state.run?.runId
    if (runId === undefined) return
    void (async () => {
        try {
            const result = await rt.api.cancel({ runId })
            if (!result.ok) throw new Error(result.error.message)
        } catch (cause) {
            if (!rt.disposed) rt.fail(cause)
        }
    })()
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
