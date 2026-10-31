/**
 * Shared fixtures for the panel client slot-rendering specs.
 *
 * The specs mount the real renderer through `SlotTestRuntime`; these helpers
 * carry the bootstrapping every scenario repeats (stub connection/config
 * faces, the shipped locale plugin, the Chinese locale) and a manually driven
 * frame stream standing in for the Host run stream.
 *
 * 面板客户端槽位渲染用例的共享夹具。用例通过 `SlotTestRuntime` 挂载真实渲染器；
 * 这里的辅助函数承载每个场景都重复的引导工作（桩 connection/config 面、随包
 * locale 插件、中文语言），以及一个手工驱动的帧流来顶替宿主运行流。
 *
 * @module tests/helpers/panel-client
 */

import { SlotTestRuntime, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { projectFlow } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { CanvasNodeRuntime, CanvasRunSnapshot } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowId, NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import { demoFlows } from '../../src/demo.ts'
import type { FlowCanvasFrame, FlowCanvasRemoteApi } from '../../src/types.ts'

/** A manually driven frame stream. */
export interface FrameStream {
    readonly iterator: AsyncIterableIterator<FlowCanvasFrame>
    push(frame: FlowCanvasFrame): void
    close(): void
}

/** One approval answer observed on the fake Remote API. */
export interface ObservedAnswer {
    runId: string
    requestId: string
    decision: string
    actor: string | undefined
}

/** A manually driven frame stream. */
export function frameStream(): FrameStream {
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

/** Initial snapshot: every demo node pending. */
export function pendingSnapshot(): CanvasRunSnapshot {
    const nodes: Record<string, CanvasNodeRuntime> = {}
    for (const node of demoFlows()[0]?.nodes ?? []) nodes[node.id] = { id: node.id, status: 'pending' }
    return { schemaVersion: 1, flowId: 'canvas-demo' as FlowId, runId: 'run-1' as RunId, status: 'running', nodes, result: null }
}

/** Final snapshot matching the demo's recovered / failed / skipped semantics. */
export function finalSnapshot(): CanvasRunSnapshot {
    const nodes: Record<string, CanvasNodeRuntime> = {
        start: { id: 'start' as NodeId, status: 'completed' },
        gate: { id: 'gate' as NodeId, status: 'completed', recovered: { code: 'NODE_FAILED', message: '演示：可恢复失败' } },
        recover: { id: 'recover' as NodeId, status: 'completed' },
        normal: { id: 'normal' as NodeId, status: 'skipped', skipReason: 'upstream-condition' },
        fatal: { id: 'fatal' as NodeId, status: 'failed', error: { code: 'NODE_FAILED', message: '演示：致命失败' } },
        join: { id: 'join' as NodeId, status: 'skipped', skipReason: 'upstream-failure' },
    }
    return {
        schemaVersion: 1,
        flowId: 'canvas-demo' as FlowId,
        runId: 'run-1' as RunId,
        status: 'failed',
        nodes,
        result: {
            flowId: 'canvas-demo' as FlowId,
            runId: 'run-1' as RunId,
            status: 'failed',
            output: { recovered: 'RECOVERED' },
            nodes: {
                start: { status: 'completed', output: {} },
                gate: { status: 'completed', output: { message: 'RECOVERED' }, recovered: { code: 'NODE_FAILED', message: '演示：可恢复失败' } },
                recover: { status: 'completed', output: { message: 'RECOVERED' } },
                normal: { status: 'skipped', skipReason: 'upstream-condition' },
                fatal: { status: 'failed', error: { code: 'NODE_FAILED', message: '演示：致命失败' } },
                join: { status: 'skipped', skipReason: 'upstream-failure' },
            },
            error: { code: 'NODE_FAILED', message: '演示：致命失败' },
        },
    }
}

/** Build the fake namespace and a frame stream for the run. */
export function fakeApi(): {
    api: FlowCanvasRemoteApi
    frames: FrameStream
    answers: ObservedAnswer[]
} {
    const frames = frameStream()
    const answers: ObservedAnswer[] = []
    const flow = projectFlow(demoFlows()[0]!)
    const api: FlowCanvasRemoteApi = {
        async list() {
            return { ok: true, value: { flows: [{ id: 'canvas-demo' as FlowId, nodes: flow.nodes.length, edges: flow.edges.length, outputs: [] }] } }
        },
        async project() {
            return { ok: true, value: flow }
        },
        async run() {
            return { ok: true, value: { runId: 'run-1', flowId: 'canvas-demo', snapshot: pendingSnapshot() } }
        },
        async answer(request) {
            answers.push({
                runId: request.runId,
                requestId: request.requestId,
                decision: request.decision,
                actor: request.actor,
            })
            return { ok: true, value: { ok: true } }
        },
        async cancel() {
            return { ok: true, value: { ok: true } }
        },
        subscribe() {
            return frames.iterator
        },
    }
    return { api, frames, answers }
}

/**
 * Boot the slot runtime with the two settings/connection stubs the panel scope
 * reads, then boot the shipped locale plugin and switch to Chinese.
 * 用面板作用域读取的两个设置/连接桩引导槽位运行时，再启动随包 locale 插件并切到中文。
 */
export async function startPanelRuntime(): Promise<SlotTestRuntime> {
    const runtime = await SlotTestRuntime.create()
    runtime.ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    runtime.ctx.provide('configForms', {
        developerTools: { enabled: createSnapshotStore(true) },
        get: () => stubConfigForm().scope,
    } as never)
    await runtime.ctx.plugin({ inject: localeInject, apply: applyLocale } as never).await()
    runtime.ctx.locale.setLocale('zh')
    return runtime
}

/**
 * Provide the fake `flowCanvas` namespace and declare the slots the panel page
 * consumes. Call before mounting the panel plugin (third-party node renderers
 * may mount in between).
 * 提供假的 `flowCanvas` 命名空间并声明面板页面消费的槽位。在挂载面板插件之前调用
 * （第三方节点渲染器可在其间挂载）。
 */
export async function declarePanelSlots(runtime: SlotTestRuntime, api: FlowCanvasRemoteApi): Promise<void> {
    runtime.remote.provideNamespaces({ flowCanvas: api })
    await runtime.declare({
        main: { kind: 'keyed', scope: 'root' },
        'sidebar.panellist': { kind: 'list', scope: 'root' },
    })
}
