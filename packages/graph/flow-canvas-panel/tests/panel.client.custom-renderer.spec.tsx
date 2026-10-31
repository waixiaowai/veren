// @vitest-environment jsdom
/**
 * End-to-end slot rendering, extension scenario: a third-party node renderer
 * owns the whole card, reads the owner props (`pendingApproval`) and answers
 * through `onApprovalDecision` without importing the default card.
 *
 * 端到端槽位渲染 · 扩展场景：第三方节点渲染器拥有整张卡片，读取 owner props
 * （`pendingApproval`）并经 `onApprovalDecision` 作答，不导入默认卡片。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowId, NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import { PanelPlugin } from '../src/client/panel-plugin.tsx'
import { declarePanelSlots, fakeApi, pendingSnapshot, startPanelRuntime } from './helpers/panel-client.ts'

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

describe('flow-canvas panel in the real slot renderer — custom node renderer', () => {
    it('exposes the approval face to a third-party node renderer', async () => {
        const runtime = await startPanelRuntime()
        const { api, frames, answers } = fakeApi()
        await declarePanelSlots(runtime, api)
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
