/**
 * Store behavior, load and run half: lazy load, flow selection, run
 * subscription with status merging, error surfacing, cold-list retry, and the
 * exact Remote calls (the browser never reads kernel events because the API
 * has no such surface). Reload-resume and answer/cancel scenarios live in
 * store-session.spec.ts.
 *
 * store 行为的「加载与运行」半边：懒加载、flow 选择、运行订阅与状态合并、错误呈现、
 * 冷列表重试，以及精确的 Remote 调用（浏览器不读内核事件，因为 API 没有这样的面）。
 * 重载续用与应答/取消场景在 store-session.spec.ts。
 */

import { describe, expect, it, vi } from 'vitest'
import type { FlowId, NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import { createFlowCanvasStore } from '../src/client/store.ts'
import { fakeApi, snapshot } from './helpers/store.ts'

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
})
