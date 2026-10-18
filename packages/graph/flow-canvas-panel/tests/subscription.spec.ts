/**
 * Subscriber ownership: one stream ending or aborting only removes its own
 * listener. The shared run projection (and its engine listeners) must survive
 * for other subscribers and for a reloaded page that re-subscribes by runId.
 *
 * 订阅者所有权：某个流结束或取消只移除它自己的监听器；共享运行投影（及其引擎监听器）
 * 必须留给其他订阅者，以及整页刷新后按 runId 重新订阅的页面。
 */

import { describe, expect, it, vi } from 'vitest'
import type {
    CanvasNodeRuntime,
    CanvasNodeStatusChange,
    CanvasRunProjection,
    CanvasRunSnapshot,
} from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowId, NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import { runFrames } from '../src/host/subscription.ts'

/** Collect one frame sequence and expose its completion. */
function collect(frames: AsyncIterable<unknown>): { seen: unknown[]; done: Promise<void> } {
    const seen: unknown[] = []
    const done = (async () => {
        for await (const frame of frames) seen.push(frame)
    })()
    return { seen, done }
}

/** A projection with driver handles; `dispose` records misuse. */
function bench(): {
    projection: CanvasRunProjection
    emit: (change: CanvasNodeStatusChange) => void
    finish: (snapshot: CanvasRunSnapshot) => void
    listeners: number
    dispose: ReturnType<typeof vi.fn>
} {
    let nodes: Record<string, CanvasNodeRuntime> = { a: { id: 'a' as NodeId, status: 'pending' } }
    let final: CanvasRunSnapshot | null = null
    const subscribers = new Set<(change: CanvasNodeStatusChange) => void>()
    let resolveFinished: (snapshot: CanvasRunSnapshot) => void = () => {}
    const finished = new Promise<CanvasRunSnapshot>((resolve) => { resolveFinished = resolve })
    const dispose = vi.fn()
    const projection: CanvasRunProjection = {
        flowId: 'flow-a' as FlowId,
        runId: 'run-1' as RunId,
        handle: {} as never,
        snapshot: () => final ?? {
            schemaVersion: 1,
            flowId: 'flow-a' as FlowId,
            runId: 'run-1' as RunId,
            status: 'running',
            nodes,
            result: null,
        },
        subscribe(listener) {
            subscribers.add(listener)
            return () => { subscribers.delete(listener) }
        },
        finished,
        dispose,
    }
    return {
        projection,
        emit(change) {
            nodes = { ...nodes, [change.nodeId]: { id: change.id, status: change.status } }
            for (const listener of [...subscribers]) listener(change)
        },
        finish(snapshot) {
            final = snapshot
            resolveFinished(snapshot)
        },
        get listeners() { return subscribers.size },
        dispose,
    }
}

/** One status change for node `a`. */
function change(status: 'running' | 'completed'): CanvasNodeStatusChange {
    return {
        flowId: 'flow-a' as FlowId,
        runId: 'run-1' as RunId,
        nodeId: 'a' as NodeId,
        id: 'a' as NodeId,
        status,
    }
}

/** A settled snapshot for the same run. */
function settled(): CanvasRunSnapshot {
    return {
        schemaVersion: 1,
        flowId: 'flow-a' as FlowId,
        runId: 'run-1' as RunId,
        status: 'completed',
        nodes: { a: { id: 'a' as NodeId, status: 'completed' } },
        result: { flowId: 'flow-a' as FlowId, runId: 'run-1' as RunId, status: 'completed', output: {}, nodes: { a: { status: 'completed', output: 1 } } },
    }
}

describe('runFrames subscriber ownership', () => {
    it('keeps the shared projection alive when one of two subscribers aborts', async () => {
        const live = bench()
        const firstAbort = new AbortController()
        const secondAbort = new AbortController()
        const first = collect(runFrames(live.projection, firstAbort.signal))
        const second = collect(runFrames(live.projection, secondAbort.signal))
        await vi.waitFor(() => { expect(first.seen).toHaveLength(1); expect(second.seen).toHaveLength(1) })
        expect(live.listeners).toBe(2)

        live.emit(change('running'))
        await vi.waitFor(() => { expect(first.seen).toHaveLength(2); expect(second.seen).toHaveLength(2) })

        firstAbort.abort()
        await first.done
        expect(live.listeners).toBe(1)
        expect(live.dispose).not.toHaveBeenCalled()

        live.emit(change('completed'))
        await vi.waitFor(() => { expect(second.seen).toHaveLength(3) })
        expect(first.seen).toHaveLength(2)

        live.finish(settled())
        await second.done
        expect(second.seen.at(-1)).toMatchObject({ type: 'snapshot', snapshot: { status: 'completed' } })
        expect(live.dispose).not.toHaveBeenCalled()
    })

    it('hydrates a reloaded subscriber that attaches after the run settled', async () => {
        const live = bench()
        live.finish(settled())
        const lateAbort = new AbortController()
        const late = collect(runFrames(live.projection, lateAbort.signal))
        await late.done
        expect(late.seen).toHaveLength(1)
        expect(late.seen[0]).toMatchObject({ type: 'snapshot', snapshot: { status: 'completed' } })
        expect(live.dispose).not.toHaveBeenCalled()
    })
})
