/**
 * One subscriber's view of a live run projection.
 *
 * The projection owns the engine listeners and cleans them up when the run
 * settles (see `watchRun`). A stream subscriber owns only its own callback.
 * Ending, aborting, or reloading one subscriber must therefore never dispose
 * the shared projection: other subscribers (and a page that reloads and
 * re-subscribes with the same `runId`) keep receiving frames.
 *
 * 一个运行投影的单个订阅者视图。投影持有引擎监听器，并在运行落定时自行清理（见
 * `watchRun`）；流订阅者只拥有自己的回调。因此结束、取消或刷新某个订阅者绝不能 dispose
 * 共享投影：其他订阅者（以及整页刷新后用同一 `runId` 重新订阅的页面）必须继续收到帧。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/host/subscription
 */

import type {
    CanvasNodeStatusChange,
    CanvasRunProjection,
    CanvasRunSnapshot,
} from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowCanvasFrame } from '../types.ts'

/** Shared waiter state between the producer callbacks and the drain loop. */
interface PumpState {
    readonly pending: FlowCanvasFrame[]
    final: CanvasRunSnapshot | null
    wake: (() => void) | undefined
}

/** Wake the drain loop (it may not be waiting; a stray wake is harmless). */
function notifyWake(state: PumpState): void {
    const current = state.wake
    state.wake = undefined
    current?.()
}

/**
 * Install the projection/abort wiring that feeds the pump; returns the
 * teardown that unsubscribes and removes the abort listener.
 * 安装喂给泵的投影/中止接线；返回的 teardown 负责退订并移除中止监听器。
 */
function installPump(projection: CanvasRunProjection, signal: AbortSignal, state: PumpState): () => void {
    const unsubscribe = projection.subscribe((change: CanvasNodeStatusChange) => {
        state.pending.push({ type: 'change', change })
        notifyWake(state)
    })
    void projection.finished.then(
        (snapshot) => {
            state.final = snapshot
            notifyWake(state)
        },
        () => {
            notifyWake(state)
        },
    )
    const onAbort = (): void => { notifyWake(state) }
    signal.addEventListener('abort', onAbort, { once: true })
    return () => {
        unsubscribe()
        signal.removeEventListener('abort', onAbort)
    }
}

/** Pop the next buffered frame, if any. */
function nextBuffered(state: PumpState): FlowCanvasFrame | undefined {
    return state.pending.shift()
}

/**
 * Install the waiter and wait. A change, the settle, or the abort may have
 * arrived between the caller's checks and installing the waiter; re-check
 * before actually waiting.
 * 装上 waiter 并等待。在调用方检查与安装 waiter 之间可能已经来了变更/落定/中止；
 * 真正等待前先复查。
 */
async function waitForPump(state: PumpState, signal: AbortSignal): Promise<void> {
    const waiting = new Promise<void>((resolve) => { state.wake = resolve })
    if (state.pending.length > 0 || state.final !== null || signal.aborted) {
        state.wake = undefined
        return
    }
    await waiting
    state.wake = undefined
}

/**
 * Stream one run projection to one subscriber: hydration snapshot first, each
 * status change while live, and one final snapshot once it settles. The
 * projection is never disposed here.
 * @param projection - the shared run projection owned by the Host service.
 * @param signal - carrier cancellation for this subscriber.
 * @returns the frame sequence of this subscription.
 */
export async function* runFrames(
    projection: CanvasRunProjection,
    signal: AbortSignal,
): AsyncIterable<FlowCanvasFrame> {
    yield { type: 'snapshot', snapshot: projection.snapshot() }
    if (projection.snapshot().result !== null) return
    const state: PumpState = { pending: [], final: null, wake: undefined }
    const teardown = installPump(projection, signal, state)
    try {
        for (;;) {
            const frame = nextBuffered(state)
            if (frame !== undefined) { yield frame; continue }
            const settled = state.final
            if (settled !== null) {
                yield { type: 'snapshot', snapshot: settled }
                return
            }
            if (signal.aborted) return
            await waitForPump(state, signal)
        }
    } finally {
        teardown()
    }
}
