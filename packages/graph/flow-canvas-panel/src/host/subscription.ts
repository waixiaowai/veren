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

    const pending: FlowCanvasFrame[] = []
    let wake: (() => void) | undefined
    let final: CanvasRunSnapshot | null = null
    const notify = (): void => {
        const current = wake
        wake = undefined
        current?.()
    }
    const unsubscribe = projection.subscribe((change: CanvasNodeStatusChange) => {
        pending.push({ type: 'change', change })
        notify()
    })
    void projection.finished.then(
        (snapshot) => {
            final = snapshot
            notify()
        },
        () => {
            notify()
        },
    )
    const onAbort = (): void => { notify() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
        for (;;) {
            while (pending.length > 0) {
                const next = pending.shift()
                if (next !== undefined) yield next
            }
            const settled = final
            if (settled !== null) {
                yield { type: 'snapshot', snapshot: settled }
                return
            }
            if (signal.aborted) return
            const waiting = new Promise<void>((resolve) => { wake = resolve })
            // A change, the settle, or the abort may have arrived between the
            // checks above and installing the waiter; re-check before waiting.
            if (pending.length > 0 || final !== null || signal.aborted) {
                wake = undefined
                continue
            }
            await waiting
            wake = undefined
        }
    } finally {
        unsubscribe()
        signal.removeEventListener('abort', onAbort)
    }
}
