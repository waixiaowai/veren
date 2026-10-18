// @vitest-environment jsdom
/**
 * End-to-end slot rendering: the real renderer mounts the panel into `main`,
 * draws the projected demo flow, streams a run, shows node output from
 * `result.nodes[id].output`, and dispatches `flow.canvas.node` by node type.
 * Mounting the echo extension switches two echo cards to the custom renderer;
 * disposing it falls back to the default card.
 *
 * 端到端槽位渲染：真实渲染器把面板挂进 `main`，画出投影后的演示 flow，接收运行流，
 * 从 `result.nodes[id].output` 显示节点 output，并按节点类型分发 `flow.canvas.node`。
 * 挂载 echo 扩展后两个 echo 卡片切换为自定义渲染器；卸载后回落默认卡片。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SlotTestRuntime, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { projectFlow } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { CanvasNodeRuntime, CanvasRunSnapshot } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowApprovalAudit, FlowId, NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import { demoFlows } from '../src/demo.ts'
import type { FlowCanvasFrame, FlowCanvasRemoteApi } from '../src/types.ts'
import { PanelPlugin } from '../src/client/panel-plugin.tsx'
import { apply as applyEcho, inject as echoInject } from '../../flow-canvas-node-echo/src/client/index.ts'

afterEach(() => {
    cleanup()
})

/** A third-party renderer: no import of the panel's card, only the owner props. */
function CustomApprovalNode({ node, pendingApproval, onApprovalDecision }: PropsRuntime<'flow.canvas.node'>) {
    if (pendingApproval === undefined) return <span>custom-idle {node.id}</span>
    return (
        <button
            type="button"
            onClick={() => { onApprovalDecision(pendingApproval.request.id, 'deny') }}
        >
            custom-deny {pendingApproval.request.action}
        </button>
    )
}

/** A manually driven frame stream. */
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

/** Initial snapshot: every demo node pending. */
function pendingSnapshot(): CanvasRunSnapshot {
    const nodes: Record<string, CanvasNodeRuntime> = {}
    for (const node of demoFlows()[0]?.nodes ?? []) nodes[node.id] = { id: node.id, status: 'pending' }
    return { schemaVersion: 1, flowId: 'canvas-demo' as FlowId, runId: 'run-1' as RunId, status: 'running', nodes, result: null }
}

/** Final snapshot matching the demo's recovered / failed / skipped semantics. */
function finalSnapshot(): CanvasRunSnapshot {
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
function fakeApi(): {
    api: FlowCanvasRemoteApi
    frames: ReturnType<typeof frameStream>
    answers: Array<{ runId: string; requestId: string; decision: string; actor: string | undefined }>
} {
    const frames = frameStream()
    const answers: Array<{ runId: string; requestId: string; decision: string; actor: string | undefined }> = []
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

describe('flow-canvas panel in the real slot renderer', () => {
    it('draws the flow, streams statuses, shows output, and falls back when the echo renderer unloads', async () => {
        const runtime = await SlotTestRuntime.create()
        // The renderer requires the real locale face; boot the shipped plugin
        // with the two settings/connection stubs its scope reads.
        runtime.ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
        runtime.ctx.provide('configForms', {
            developerTools: { enabled: createSnapshotStore(true) },
            get: () => stubConfigForm().scope,
        } as never)
        await runtime.ctx.plugin({ inject: localeInject, apply: applyLocale } as never).await()
        runtime.ctx.locale.setLocale('zh')
        const { api, frames } = fakeApi()
        runtime.remote.provideNamespaces({ flowCanvas: api })
        await runtime.declare({
            main: { kind: 'keyed', scope: 'root' },
            'sidebar.panellist': { kind: 'list', scope: 'root' },
        })
        const panel = await runtime.mount(PanelPlugin as never)
        const view = runtime.renderSlot('main', {}, { entryKey: 'flow-canvas' })

        await waitFor(() => { expect(view.view.getByText('流程画布')).toBeTruthy() })
        expect(view.view.getByText('恢复分支')).toBeTruthy()
        expect(view.view.getByRole('option', { name: '演示流程' })).toBeTruthy()
        expect(view.view.getByRole('button', { name: '适应屏幕' })).toBeTruthy()
        // Every default card carries one type glyph and one status rail.
        expect(view.container.querySelectorAll('[data-node-glyph]')).toHaveLength(6)
        expect(view.container.querySelectorAll('[data-node-rail]')).toHaveLength(6)

        // The default renderer draws every demo node until the extension loads.
        expect(view.view.queryByText('扩展渲染')).toBeNull()

        fireEvent.click(view.view.getByRole('button', { name: '运行' }))
        await waitFor(() => { expect(view.view.getAllByText('运行中').length > 0).toBeTruthy() })
        frames.push({ type: 'snapshot', snapshot: pendingSnapshot() })
        frames.push({
            type: 'change',
            change: { flowId: 'canvas-demo' as FlowId, runId: 'run-1' as RunId, nodeId: 'gate' as NodeId, id: 'gate' as NodeId, status: 'completed', recovered: { code: 'NODE_FAILED', message: '演示：可恢复失败' } },
        })
        frames.push({
            type: 'change',
            change: { flowId: 'canvas-demo' as FlowId, runId: 'run-1' as RunId, nodeId: 'fatal' as NodeId, id: 'fatal' as NodeId, status: 'failed', error: { code: 'NODE_FAILED', message: '演示：致命失败' } },
        })
        await waitFor(() => { expect(view.view.getAllByText('已兜底').length).toBeGreaterThan(0) })
        expect(view.view.getAllByText('失败').length).toBeGreaterThan(0)

        frames.push({ type: 'snapshot', snapshot: finalSnapshot() })
        await waitFor(() => { expect(view.view.getAllByText(/条件不满足/).length).toBeGreaterThan(0) })
        // Ports are explicit on both ends of every edge; two branches point at
        // skipped nodes and must render as dotted (not as error-branch dashed).
        expect(view.container.querySelectorAll('[data-flow-port]')).toHaveLength(10)
        expect(view.container.querySelectorAll('[data-edge-skipped="true"]')).toHaveLength(2)
        // The card keeps the stable code; the full message lives in the inspector.
        expect(view.view.getAllByText('NODE_FAILED').length).toBeGreaterThan(0)

        // The failure is actionable: the status strip opens the failed node.
        fireEvent.click(view.view.getByRole('button', { name: /1 个节点失败/ }))
        await waitFor(() => { expect(view.view.getAllByText(/演示：致命失败/).length).toBeGreaterThan(0) })

        // Click the recovered gate: the inspector reads result.nodes[id].output.
        fireEvent.click(view.view.getByRole('button', { name: /兜底分支/ }))
        await waitFor(() => { expect(view.view.getByText('snapshot.result.nodes["gate"].output')).toBeTruthy() })
        expect(view.view.getByText(/"message": "RECOVERED"/)).toBeTruthy()

        // Click the failed fatal node: output is absent and explained, never invented.
        fireEvent.click(view.view.getByRole('button', { name: /致命分支/ }))
        await waitFor(() => {
            expect(view.view.getByText('该节点没有输出（失败或被跳过时是正常的）。')).toBeTruthy()
        })

        // The extension registers for key `echo`; both echo nodes switch renderer.
        const echo = await runtime.mount({ inject: [...echoInject], apply: applyEcho } as never)
        await waitFor(() => { expect(view.view.getAllByText('扩展渲染').length).toBe(2) })

        // Disposing the extension unregisters the keyed cell; the panel falls back.
        await echo.dispose()
        await waitFor(() => { expect(view.view.queryByText('扩展渲染')).toBeNull() })
        expect(view.view.getByText('恢复分支')).toBeTruthy()

        frames.close()
        await panel.dispose()
        await runtime.dispose()
    })

    it('renders the approval card on the node and answers through the Remote API', async () => {
        const runtime = await SlotTestRuntime.create()
        runtime.ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
        runtime.ctx.provide('configForms', {
            developerTools: { enabled: createSnapshotStore(true) },
            get: () => stubConfigForm().scope,
        } as never)
        await runtime.ctx.plugin({ inject: localeInject, apply: applyLocale } as never).await()
        runtime.ctx.locale.setLocale('zh')
        const { api, frames, answers } = fakeApi()
        runtime.remote.provideNamespaces({ flowCanvas: api })
        await runtime.declare({
            main: { kind: 'keyed', scope: 'root' },
            'sidebar.panellist': { kind: 'list', scope: 'root' },
        })
        const panel = await runtime.mount(PanelPlugin as never)
        const view = runtime.renderSlot('main', {}, { entryKey: 'flow-canvas' })
        await waitFor(() => { expect(view.view.getByText('流程画布')).toBeTruthy() })
        fireEvent.click(view.view.getByRole('button', { name: '运行' }))
        await waitFor(() => { expect(view.view.getAllByText('运行中').length > 0).toBeTruthy() })

        const request = {
            id: 'req-1',
            flowId: 'canvas-demo' as FlowId,
            runId: 'run-1' as RunId,
            nodeId: 'gate' as NodeId,
            attempt: 1,
            kind: 'tool',
            action: 'pwsh',
            reason: 'runs a shell command',
            summary: '{\n  "command": "echo hi"\n}',
            requestedAt: 1,
        }
        const pendingAudit: FlowApprovalAudit = { request }
        const awaiting = pendingSnapshot()
        awaiting.nodes['gate'] = { id: 'gate' as NodeId, status: 'awaiting-approval', approvals: [pendingAudit] }
        frames.push({ type: 'snapshot', snapshot: awaiting })

        await waitFor(() => { expect(view.view.getByText('需要授权')).toBeTruthy() })
        expect(view.view.getByText('工具 pwsh')).toBeTruthy()
        expect(view.view.getAllByText('runs a shell command').length).toBeGreaterThan(0)
        expect(view.view.getByText(/"command": "echo hi"/)).toBeTruthy()
        expect(view.view.getByText(/1 个节点等待授权/)).toBeTruthy()
        // The owning node is selected automatically, so the inspector agrees
        // with the approval card instead of leaving the right side blank.
        expect(view.view.getByText('等待授权中，请在上方授权卡处理。')).toBeTruthy()

        fireEvent.click(view.view.getByRole('button', { name: '同意' }))
        await waitFor(() => { expect(answers).toHaveLength(1) })
        expect(answers[0]).toEqual({ runId: 'run-1', requestId: 'req-1', decision: 'allow', actor: 'canvas-user' })

        // The status stream settles the node and keeps the audit visible.
        const decidedAudit: FlowApprovalAudit = {
            request,
            outcome: { decision: 'allow', via: 'user', decidedBy: 'alice', decidedAt: 2 },
        }
        frames.push({
            type: 'change',
            change: {
                flowId: 'canvas-demo' as FlowId,
                runId: 'run-1' as RunId,
                nodeId: 'gate' as NodeId,
                id: 'gate' as NodeId,
                status: 'running',
                approvals: [decidedAudit],
            },
        })
        await waitFor(() => { expect(view.view.getAllByText(/由 alice 于 \d\d:\d\d:\d\d 同意/).length).toBeGreaterThan(0) })
        expect(view.view.queryByText('需要授权')).toBeNull()

        // The inspector keeps the full approval audit (who/when/outcome).
        fireEvent.click(view.view.getByRole('button', { name: /兜底分支/ }))
        await waitFor(() => { expect(view.view.getByText('授权记录')).toBeTruthy() })
        expect(view.view.getByText('工具 pwsh · 同意')).toBeTruthy()
        expect(view.view.getAllByText(/由 alice 于 \d\d:\d\d:\d\d 同意/).length).toBeGreaterThan(0)

        frames.close()
        await panel.dispose()
        await runtime.dispose()
    })

    it('exposes the approval face to a third-party node renderer', async () => {
        const runtime = await SlotTestRuntime.create()
        runtime.ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
        runtime.ctx.provide('configForms', {
            developerTools: { enabled: createSnapshotStore(true) },
            get: () => stubConfigForm().scope,
        } as never)
        await runtime.ctx.plugin({ inject: localeInject, apply: applyLocale } as never).await()
        runtime.ctx.locale.setLocale('zh')
        const { api, frames, answers } = fakeApi()
        runtime.remote.provideNamespaces({ flowCanvas: api })
        await runtime.declare({
            main: { kind: 'keyed', scope: 'root' },
            'sidebar.panellist': { kind: 'list', scope: 'root' },
        })
        // A third-party renderer owns the whole card; it reads pendingApproval and
        // answers through onApprovalDecision without importing the default card.
        const custom = await runtime.mount({
            inject: ['slots'],
            apply(ctx: Context) {
                ctx.slots.inject('flow.canvas.node', () => ctx.slots.register({
                    name: 'flow.canvas.node',
                    key: 'fail',
                }, CustomApprovalNode))
            },
        } as never)
        const panel = await runtime.mount(PanelPlugin as never)
        const view = runtime.renderSlot('main', {}, { entryKey: 'flow-canvas' })
        await waitFor(() => { expect(view.view.getByText('流程画布')).toBeTruthy() })
        fireEvent.click(view.view.getByRole('button', { name: '运行' }))
        await waitFor(() => { expect(view.view.getAllByText('运行中').length > 0).toBeTruthy() })

        const awaiting = pendingSnapshot()
        awaiting.nodes['gate'] = {
            id: 'gate' as NodeId,
            status: 'awaiting-approval',
            approvals: [{
                request: {
                    id: 'req-custom',
                    flowId: 'canvas-demo' as FlowId,
                    runId: 'run-1' as RunId,
                    nodeId: 'gate' as NodeId,
                    attempt: 1,
                    kind: 'tool',
                    action: 'custom-tool',
                    requestedAt: 1,
                },
            }],
        }
        frames.push({ type: 'snapshot', snapshot: awaiting })
        await waitFor(() => { expect(view.view.getByText('custom-deny custom-tool')).toBeTruthy() })
        fireEvent.click(view.view.getByText('custom-deny custom-tool'))
        await waitFor(() => { expect(answers).toHaveLength(1) })
        expect(answers[0]).toEqual({ runId: 'run-1', requestId: 'req-custom', decision: 'deny', actor: 'canvas-user' })

        frames.close()
        await panel.dispose()
        await custom.dispose()
        await runtime.dispose()
    })
})
