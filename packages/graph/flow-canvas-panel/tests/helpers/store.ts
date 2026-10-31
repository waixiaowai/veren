/**
 * Shared fixtures for the store specs: the demo flow list the fake Host
 * knows, an in-memory session storage for reload-resume tests, static flow
 * and run-snapshot projections, a manually driven frame stream, and a
 * recorded fake Remote API.
 *
 * store 用例的共享夹具：假 Host 已知的三条演示流、供重载续用用例的内存会话存储、
 * 静态 flow 与运行快照投影、手工驱动的帧流，以及带调用记录的假 Remote API。
 *
 * @module tests/helpers/store
 */

import type { CanvasFlow, CanvasRunSnapshot } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowId, NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import type { FlowCanvasFrame, FlowCanvasRemoteApi } from '../../src/types.ts'

/** The three demo flows the fake Host knows. */
export const FLOWS = [
    { id: 'flow-a' as FlowId, nodes: 2, edges: 1, outputs: [] },
    { id: 'flow-b' as FlowId, nodes: 1, edges: 0, outputs: ['x'] },
]

/** In-memory session storage for reload-resume tests. */
export function memoryStorage(initial?: string) {
    const values = new Map<string, string>()
    if (initial !== undefined) values.set('dsh.flow-canvas.view', initial)
    return {
        values,
        getItem(key: string) { return values.get(key) ?? null },
        setItem(key: string, value: string) { values.set(key, value) },
        removeItem(key: string) { values.delete(key) },
    }
}

/** Minimal static projection; the store only passes it through. */
export function flow(id: string): CanvasFlow {
    return {
        schemaVersion: 1,
        flowId: id as FlowId,
        nodes: [
            { id: 'a' as NodeId, type: 'echo', display: { label: 'A', subtitle: 'echo' }, onError: 'failFast', layout: null },
        ],
        edges: [],
        output: {},
        hasInputSchema: false,
        layout: { viewport: null, nodes: {}, edges: {} },
        meta: { nodeCount: 1, edgeCount: 0 },
    }
}

/** A run snapshot with one pending node and no result yet. */
export function snapshot(runId: string, status: 'running' | 'completed' = 'running'): CanvasRunSnapshot {
    return {
        schemaVersion: 1,
        flowId: 'flow-a' as FlowId,
        runId: runId as RunId,
        status,
        nodes: { a: { id: 'a' as NodeId, status: 'pending' } },
        result: status === 'running'
            ? null
            : {
                flowId: 'flow-a' as FlowId,
                runId: runId as RunId,
                status: 'completed',
                output: { ok: true },
                nodes: { a: { status: 'completed', output: { said: 'hi' } } },
            },
    }
}

/** A manually driven stream of frames. */
export function frameStream() {
    const queue: FlowCanvasFrame[] = []
    let wake: (() => void) | undefined
    let closed = false
    const iterator: AsyncIterableIterator<FlowCanvasFrame> = {
        async next() {
            while (queue.length === 0 && !closed) await new Promise<void>((resolve) => { wake = resolve })
            const value = queue.shift()
            return value === undefined ? { done: true, value: undefined } : { done: false, value }
        },
        async return() {
            closed = true
            wake?.()
            return { done: true, value: undefined }
        },
        [Symbol.asyncIterator]() { return this },
    }
    return {
        iterator,
        push(frame: FlowCanvasFrame) {
            queue.push(frame)
            const current = wake
            wake = undefined
            current?.()
        },
        close() {
            closed = true
            const current = wake
            wake = undefined
            current?.()
        },
    }
}

/** Recorded Remote calls of one fake Host. */
export interface Calls {
    list: number
    project: string[]
    run: string[]
    subscribe: string[]
    answer: Array<{ runId: string; requestId: string; decision: string; actor: string | undefined }>
    cancel: string[]
}

/** Build a fake namespace plus the controls a spec drives. */
export function fakeApi(options: { listFailures?: number; subscribeError?: Error } = {}): {
    api: FlowCanvasRemoteApi
    calls: Calls
    frames: ReturnType<typeof frameStream>
} {
    const calls: Calls = { list: 0, project: [], run: [], subscribe: [], answer: [], cancel: [] }
    const frames = frameStream()
    let listFailures = options.listFailures ?? 0
    const api: FlowCanvasRemoteApi = {
        async list() {
            calls.list += 1
            if (listFailures > 0) {
                listFailures -= 1
                return { ok: false, error: { code: 'X', message: 'warming up' } }
            }
            return { ok: true, value: { flows: FLOWS } }
        },
        async project(request) {
            calls.project.push(request.flowId)
            return { ok: true, value: flow(request.flowId) }
        },
        async run(request) {
            calls.run.push(request.flowId)
            return { ok: true, value: { runId: 'run-1', flowId: request.flowId, snapshot: snapshot('run-1') } }
        },
        async answer(request) {
            calls.answer.push({
                runId: request.runId,
                requestId: request.requestId,
                decision: request.decision,
                actor: request.actor,
            })
            return { ok: true, value: { ok: true } }
        },
        async cancel(request) {
            calls.cancel.push(request.runId)
            return { ok: true, value: { ok: true } }
        },
        subscribe(request) {
            calls.subscribe.push(request.runId)
            if (options.subscribeError !== undefined) throw options.subscribeError
            return frames.iterator
        },
    }
    return { api, calls, frames }
}
