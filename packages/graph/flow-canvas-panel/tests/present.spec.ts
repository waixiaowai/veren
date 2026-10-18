/**
 * Presentation lookups: readable labels for host ids, the attention queue,
 * pending approvals and the compact skip/detail text.
 *
 * 展示层查表：宿主 id 的可读标签、需要人处理的节点队列、挂起授权与紧凑的跳过/详情文本。
 */

import { describe, expect, it } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CanvasNodeRuntime } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowApprovalAudit, FlowId, NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import { projectFlow } from '@deepseek-ai/dsh-graph-flow-canvas'
import { demoFlows } from '../src/demo.ts'
import { zh, type FlowCanvasKey } from '../src/client/locales.ts'
import {
    attentionNodes,
    detailText,
    flowLabel,
    flowLabelKey,
    formatRemaining,
    nodeTypeLabel,
    nodeTypeLabelKey,
    pendingApprovals,
    policyLabelKey,
    skipReasonLabel,
    skipReasonLabelKey,
} from '../src/client/present.ts'
import type { RunView } from '../src/client/store.ts'

/** Interpolate the real Chinese dictionary, matching the locale service. */
const t = ((key: FlowCanvasKey, params?: Readonly<Record<string, string | number>>) => {
    let text: string = zh[key]
    for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
    return text
}) as TranslateNS<'flowCanvas'>

/** One pending approval owned by `gate`. */
const pendingAudit: FlowApprovalAudit = {
    request: {
        id: 'req-1',
        flowId: 'canvas-demo' as FlowId,
        runId: 'run-1' as RunId,
        nodeId: 'gate' as NodeId,
        attempt: 1,
        kind: 'tool',
        action: 'flow-approval-demo',
        reason: 'writes an artifact',
        requestedAt: 1,
    },
}

/** A run view with one suspended node and one failed node. */
function runView(): RunView {
    const nodes: Record<string, CanvasNodeRuntime> = {
        start: { id: 'start' as NodeId, status: 'completed' },
        gate: { id: 'gate' as NodeId, status: 'awaiting-approval', approvals: [pendingAudit] },
        recover: { id: 'recover' as NodeId, status: 'completed' },
        normal: { id: 'normal' as NodeId, status: 'skipped', skipReason: 'upstream-condition' },
        fatal: { id: 'fatal' as NodeId, status: 'failed', error: { code: 'NODE_FAILED', message: 'boom' } },
        join: { id: 'join' as NodeId, status: 'skipped', skipReason: 'upstream-failure' },
    }
    return { runId: 'run-1', status: 'running', nodes, result: null }
}

describe('readable labels', () => {
    it('maps known demo ids and node types, and falls back to the raw id', () => {
        expect(flowLabelKey('canvas-demo')).toBe('flow.demo')
        expect(flowLabelKey('deployment-flow')).toBeUndefined()
        expect(flowLabel('canvas-demo', t)).toBe('演示流程')
        expect(flowLabel('deployment-flow', t)).toBe('deployment-flow')
        expect(nodeTypeLabelKey('tool')).toBe('node.type.tool')
        expect(nodeTypeLabel('echo', t)).toBe('回显')
        expect(nodeTypeLabel('custom-node', t)).toBe('custom-node')
        expect(policyLabelKey('errorBranch')).toBe('policy.errorBranch')
    })

    it('translates known skip reasons but keeps unknown engine reasons', () => {
        expect(skipReasonLabelKey('upstream-failure')).toBe('skip.upstreamFailure')
        expect(skipReasonLabel('upstream-failure', t)).toBe('上游失败')
        expect(skipReasonLabel('custom-reason', t)).toBe('custom-reason')
        expect(detailText({ key: 'node.detail.skip', params: { reason: 'upstream-failure' } }, t))
            .toBe('跳过：上游失败')
        expect(skipReasonLabelKey('custom-reason')).toBeUndefined()
    })
})

describe('attention queue', () => {
    it('lists suspended approvals first and failures separately', () => {
        const flow = projectFlow(demoFlows()[0]!)
        const attention = attentionNodes(flow, runView())
        expect(attention.awaiting).toEqual([{ nodeId: 'gate', label: '兜底分支' }])
        expect(attention.failed).toEqual([{ nodeId: 'fatal', label: '致命分支' }])
        expect(attentionNodes(undefined, runView())).toEqual({ awaiting: [], failed: [] })
        expect(attentionNodes(flow, undefined)).toEqual({ awaiting: [], failed: [] })
    })

    it('exposes every pending approval with its node label', () => {
        const flow = projectFlow(demoFlows()[0]!)
        const pending = pendingApprovals(flow, runView())
        expect(pending).toHaveLength(1)
        expect(pending[0]?.nodeId).toBe('gate')
        expect(pending[0]?.nodeLabel).toBe('兜底分支')
        expect(pending[0]?.audit.request.action).toBe('flow-approval-demo')
        expect(pendingApprovals(undefined, runView())).toEqual([])
    })
})

describe('formatRemaining', () => {
    it('renders m:ss and handles the missing deadline and the past', () => {
        expect(formatRemaining(10_000, 6_000)).toBe('0:04')
        expect(formatRemaining(65_000, 0)).toBe('1:05')
        expect(formatRemaining(1_000, 2_000)).toBe('0:00')
        expect(formatRemaining(undefined, 1_000)).toBeUndefined()
    })
})
