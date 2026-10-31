// @vitest-environment jsdom
/**
 * End-to-end slot rendering, approval scenario: a pending approval renders the
 * card on its node, the default card answers through the Remote API, and the
 * status stream keeps the settled audit visible in the inspector.
 *
 * 端到端槽位渲染 · 授权场景：挂起授权在所属节点上渲染授权卡，默认卡片经 Remote API
 * 作答，状态流把落定后的审计保留在详情面板里。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { FlowApprovalAudit, FlowId, NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import { PanelPlugin } from '../src/client/panel-plugin.tsx'
import { declarePanelSlots, fakeApi, pendingSnapshot, startPanelRuntime } from './helpers/panel-client.ts'

afterEach(() => {
    cleanup()
})

describe('flow-canvas panel in the real slot renderer — approval card', () => {
    it('renders the approval card on the node and answers through the Remote API', async () => {
        const runtime = await startPanelRuntime()
        const { api, frames, answers } = fakeApi()
        await declarePanelSlots(runtime, api)
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
})
