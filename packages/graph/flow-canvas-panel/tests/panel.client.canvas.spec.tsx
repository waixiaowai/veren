// @vitest-environment jsdom
/**
 * End-to-end slot rendering, canvas scenario: the real renderer mounts the
 * panel into `main`, draws the projected demo flow, streams statuses, shows
 * node output from `result.nodes[id].output`, and falls back to the default
 * card when the echo extension unloads.
 *
 * 端到端槽位渲染 · 画布场景：真实渲染器把面板挂进 `main`，画出投影后的演示 flow，
 * 接收运行流，从 `result.nodes[id].output` 显示节点 output，并在 echo 扩展卸载后
 * 回落默认卡片。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { FlowId, NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import { PanelPlugin } from '../src/client/panel-plugin.tsx'
import { apply as applyEcho, inject as echoInject } from '../../flow-canvas-node-echo/src/client/index.ts'
import { declarePanelSlots, fakeApi, finalSnapshot, pendingSnapshot, startPanelRuntime } from './helpers/panel-client.ts'

afterEach(() => {
    cleanup()
})

describe('flow-canvas panel in the real slot renderer — canvas', () => {
    it('draws the flow, streams statuses, shows output, and falls back when the echo renderer unloads', async () => {
        const runtime = await startPanelRuntime()
        const { api, frames } = fakeApi()
        await declarePanelSlots(runtime, api)
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
})
