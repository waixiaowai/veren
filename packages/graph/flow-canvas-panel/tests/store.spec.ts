/**
 * Store behavior: lazy load, flow selection, run subscription, status merging,
 * error surfacing, and the exact Remote calls (the browser never reads kernel
 * events because the API has no such surface).
 *
 * store 行为：懒加载、flow 选择、运行订阅、状态合并、错误呈现，以及精确的 Remote 调用
 * （浏览器不读内核事件，因为 API 没有这样的面）。
 */

import { describe, expect, it, vi } from 'vitest'
import type { CanvasFlow, CanvasRunSnapshot } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowId, NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import type { FlowCanvasFrame, FlowCanvasRemoteApi } from '../src/types.ts'
import { createFlowCanvasStore } from '../src/client/store.ts'

/** The three demo flows the fake Host knows. */
const FLOWS = [
    { id: 'flow-a' as FlowId, nodes: 2, edges: 1, outputs: [] },
    { id: 'flow-b' as FlowId, nodes: 1, edges: 0, outputs: ['x'] },
]

/** In-memory session storage for reload-resume tests. */
function memoryStorage(initial?: string) {
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
function flow(id: string): CanvasFlow {
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
function snapshot(runId: string, status: 'running' | 'completed' = 'running'): CanvasRunSnapshot {
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
function frameStream() {
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
interface Calls {
    list: number
    project: string[]
    run: string[]
    subscribe: string[]
    answer: Array<{ runId: string; requestId: string; decision: string; actor: string | undefined }>
    cancel: string[]
}

/** Build a fake namespace plus the controls a spec drives. */
function fakeApi(options: { listFailures?: number; subscribeError?: Error } = {}): {
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

describe('createFlowCanvasStore', () => {
    it('loads the list and projects the first flow on the first subscriber', async () => {
        const { api, calls } = fakeApi()
        const store = createFlowCanvasStore(api)
        const stop = store.source.subscribe(() => {})
        await vi.waitFor(() => { expect(store.source.getSnapshot().flowId).toBe('flow-a') })
        expect(calls.list).toBe(1)
        expect(calls.project).toEqual(['flow-a'])
        expect(store.source.getSnapshot().phase).toBe('ready')
        expect(store.source.getSnapshot().flow?.flowId).toBe('flow-a')
        stop()
        store.dispose()
    })

    it('keeps the flow selector, projects on change, and drops the old run', async () => {
        const { api, calls } = fakeApi()
        const store = createFlowCanvasStore(api)
        store.source.subscribe(() => {})
        await vi.waitFor(() => { expect(store.source.getSnapshot().flowId).toBe('flow-a') })
        store.selectFlow('flow-b')
        await vi.waitFor(() => { expect(store.source.getSnapshot().flow?.flowId).toBe('flow-b') })
        expect(calls.project).toEqual(['flow-a', 'flow-b'])
        expect(store.source.getSnapshot().run).toBeUndefined()
        store.dispose()
    })

    it('runs the selected flow, merges status changes, and settles on the final result', async () => {
        const { api, calls, frames } = fakeApi()
        const store = createFlowCanvasStore(api)
        store.source.subscribe(() => {})
        await vi.waitFor(() => { expect(store.source.getSnapshot().flowId).toBe('flow-a') })

        store.startRun()
        await vi.waitFor(() => { expect(store.source.getSnapshot().run?.runId).toBe('run-1') })
        expect(calls.run).toEqual(['flow-a'])
        expect(calls.subscribe).toEqual(['run-1'])

        frames.push({
            type: 'change',
            change: { flowId: 'flow-a' as FlowId, runId: 'run-1' as RunId, nodeId: 'a' as NodeId, id: 'a' as NodeId, status: 'failed', error: { code: 'NODE_FAILED', message: 'boom' } },
        })
        await vi.waitFor(() => { expect(store.source.getSnapshot().run?.nodes['a']?.status).toBe('failed') })

        frames.push({ type: 'snapshot', snapshot: snapshot('run-1', 'completed') })
        await vi.waitFor(() => { expect(store.source.getSnapshot().run?.result?.nodes['a']?.output).toEqual({ said: 'hi' }) })
        expect(store.source.getSnapshot().run?.status).toBe('completed')

        store.selectNode('a')
        expect(store.source.getSnapshot().selectedNodeId).toBe('a')
        store.selectNode(undefined)
        expect(store.source.getSnapshot().selectedNodeId).toBeUndefined()
        frames.close()
        store.dispose()
    })

    it('surfaces a failed list as an error phase without inventing flows', async () => {
        const { api } = fakeApi({ listFailures: 100 })
        const store = createFlowCanvasStore(api, { retryDelayMs: 1 })
        store.source.subscribe(() => {})
        await vi.waitFor(() => { expect(store.source.getSnapshot().phase).toBe('error') })
        expect(store.source.getSnapshot().error).toBe('warming up')
        expect(store.source.getSnapshot().flows).toEqual([])
        store.dispose()
    })

    it('only reaches the Host through the six namespace methods', async () => {
        const { api, calls } = fakeApi()
        const store = createFlowCanvasStore(api)
        store.source.subscribe(() => {})
        await vi.waitFor(() => { expect(store.source.getSnapshot().flowId).toBe('flow-a') })
        store.startRun()
        await vi.waitFor(() => { expect(calls.subscribe).toEqual(['run-1']) })
        expect(Object.keys(api).sort()).toEqual(['answer', 'cancel', 'list', 'project', 'run', 'subscribe'])
        expect(calls.list).toBe(1)
        store.dispose()
    })

    it('retries a cold list instead of showing an empty Host', async () => {
        const { api, calls } = fakeApi({ listFailures: 2 })
        const store = createFlowCanvasStore(api, { retryDelayMs: 1 })
        store.source.subscribe(() => {})
        await vi.waitFor(() => { expect(store.source.getSnapshot().flowId).toBe('flow-a') })
        expect(calls.list).toBe(3)
        expect(store.source.getSnapshot().phase).toBe('ready')
        store.dispose()
    })

    it('resumes the persisted run after a reload and keeps its flow selection', async () => {
        const storage = memoryStorage(JSON.stringify({ flowId: 'flow-b', runId: 'run-9' }))
        const { api, calls, frames } = fakeApi()
        const store = createFlowCanvasStore(api, { storage, retryDelayMs: 1 })
        store.source.subscribe(() => {})
        await vi.waitFor(() => { expect(calls.subscribe).toEqual(['run-9']) })
        expect(calls.project).toEqual(['flow-b'])

        frames.push({ type: 'snapshot', snapshot: snapshot('run-9') })
        await vi.waitFor(() => { expect(store.source.getSnapshot().run?.runId).toBe('run-9') })
        expect(storage.getItem('dsh.flow-canvas.view')).toContain('run-9')

        // A manual refresh must not open a second subscription to the same run.
        store.refresh()
        await vi.waitFor(() => { expect(calls.list).toBe(2) })
        expect(calls.subscribe).toEqual(['run-9'])
        store.dispose()
    })

    it('drops a stale persisted run without turning the panel into an error', async () => {
        const storage = memoryStorage(JSON.stringify({ flowId: 'flow-a', runId: 'gone' }))
        const { api } = fakeApi({ subscribeError: Object.assign(new Error('run "gone" is not known'), { code: 'flow-canvas/run-not-found' }) })
        const store = createFlowCanvasStore(api, { storage, retryDelayMs: 1 })
        store.source.subscribe(() => {})
        await vi.waitFor(() => { expect(store.source.getSnapshot().flow?.flowId).toBe('flow-a') })
        expect(store.source.getSnapshot().run).toBeUndefined()
        expect(store.source.getSnapshot().phase).toBe('ready')
        expect(storage.getItem('dsh.flow-canvas.view')).not.toContain('gone')
        store.dispose()
    })

    it('persists the run id when a run starts', async () => {
        const storage = memoryStorage()
        const { api } = fakeApi()
        const store = createFlowCanvasStore(api, { storage, retryDelayMs: 1 })
        store.source.subscribe(() => {})
        await vi.waitFor(() => { expect(store.source.getSnapshot().flowId).toBe('flow-a') })
        store.startRun()
        await vi.waitFor(() => { expect(store.source.getSnapshot().run?.runId).toBe('run-1') })
        expect(storage.getItem('dsh.flow-canvas.view')).toContain('"runId":"run-1"')
        store.dispose()
    })

    it('answers a node approval through the Remote endpoint with the canvas actor', async () => {
        const { api, calls, frames } = fakeApi()
        const store = createFlowCanvasStore(api)
        store.source.subscribe(() => {})
        await vi.waitFor(() => { expect(store.source.getSnapshot().flowId).toBe('flow-a') })
        store.startRun()
        await vi.waitFor(() => { expect(store.source.getSnapshot().run?.runId).toBe('run-1') })
        frames.push({ type: 'snapshot', snapshot: snapshot('run-1') })

        store.answerApproval('req-1', 'allow')
        await vi.waitFor(() => { expect(calls.answer).toHaveLength(1) })
        expect(calls.answer[0]).toEqual({ runId: 'run-1', requestId: 'req-1', decision: 'allow', actor: 'canvas-user' })
        store.dispose()
    })

    it('cancels the current run through the Remote endpoint', async () => {
        const { api, calls } = fakeApi()
        const store = createFlowCanvasStore(api)
        store.source.subscribe(() => {})
        await vi.waitFor(() => { expect(store.source.getSnapshot().flowId).toBe('flow-a') })
        store.startRun()
        await vi.waitFor(() => { expect(store.source.getSnapshot().run?.runId).toBe('run-1') })
        store.cancelRun()
        await vi.waitFor(() => { expect(calls.cancel).toEqual(['run-1']) })
        store.dispose()
    })
})
