/**
 * Store behavior, session half: the persisted view survives a reload (run
 * subscription resumes, the flow selection follows, a stale run id drops
 * without an error phase), the run id persists when a run starts, and the
 * approval/cancel decisions go through the Remote endpoint with the canvas
 * actor. Load/selection/run-merge scenarios live in store.spec.ts.
 *
 * store 行为的「会话」半边：持久化视图跨重载存活（恢复运行订阅、沿用 flow 选择、
 * 过期 run id 无错误相地丢弃）、运行启动时持久化 run id，以及应答/取消经 Remote
 * 端点带上画布操作者发出。加载/选择/运行合并场景在 store.spec.ts。
 */

import { describe, expect, it, vi } from 'vitest'
import { createFlowCanvasStore } from '../src/client/store.ts'
import { fakeApi, memoryStorage, snapshot } from './helpers/store.ts'

describe('createFlowCanvasStore', () => {
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
