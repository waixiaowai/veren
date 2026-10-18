/**
 * Presentation lookups shared by the panel: readable names for host data,
 * attention queues for the status strip, and the compact card detail line.
 *
 * Host identifiers stay authoritative; this module only picks a localized
 * label for the ones the product knows, so an unknown deployment flow or node
 * type still renders its raw id instead of disappearing.
 *
 * 面板共享的展示层查表：为宿主数据提供可读名称、状态条要突出的人待处理项、
 * 以及卡片的紧凑详情行。宿主标识仍是权威；本模块只为产品已知的值选择本地化标签，
 * 未知的部署 flow 或节点类型仍显示原始 id，而不会消失。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/present
 */

import type { CanvasFlow } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowApprovalAudit } from '@deepseek-ai/dsh-graph-flow-api'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowCanvasKey } from './locales.ts'
import type { DetailLine } from './model.ts'
import { pendingApproval } from './model.ts'
import type { RunView } from './store.ts'

/** Known demo flow ids -> readable labels. */
const FLOW_LABELS = {
    'canvas-demo': 'flow.demo',
    'canvas-demo-pacing': 'flow.demoPacing',
    'canvas-demo-predicate': 'flow.demoPredicate',
    'approval-explicit': 'flow.approvalExplicit',
    'approval-ambient': 'flow.approvalAmbient',
    'approval-timeout': 'flow.approvalTimeout',
} as const satisfies Record<string, FlowCanvasKey>

/** Built-in node types -> readable labels. */
const NODE_TYPE_LABELS = {
    noop: 'node.type.noop',
    fail: 'node.type.fail',
    echo: 'node.type.echo',
    tool: 'node.type.tool',
} as const satisfies Record<string, FlowCanvasKey>

/** Engine skip reasons -> readable labels. */
const SKIP_REASON_LABELS = {
    'upstream-failure': 'skip.upstreamFailure',
    'upstream-condition': 'skip.upstreamCondition',
    'upstream-skipped': 'skip.upstreamSkipped',
    cancelled: 'skip.cancelled',
} as const satisfies Record<string, FlowCanvasKey>

/** Node failure policies -> readable labels. */
const POLICY_LABELS = {
    failFast: 'policy.failFast',
    fallback: 'policy.fallback',
    errorBranch: 'policy.errorBranch',
} as const satisfies Record<string, FlowCanvasKey>

/** One node that needs the operator's attention. */
export interface AttentionNode {
    readonly nodeId: string
    readonly label: string
}

/** One pending approval plus the node that owns it. */
export interface PendingApprovalView {
    readonly nodeId: string
    readonly nodeLabel: string
    readonly audit: FlowApprovalAudit
}

/** Readable label key for a known flow id, or undefined for a deployment flow. */
export function flowLabelKey(flowId: string): FlowCanvasKey | undefined {
    return (FLOW_LABELS as Record<string, FlowCanvasKey>)[flowId]
}

/** Readable label key for a known node type. */
export function nodeTypeLabelKey(type: string): FlowCanvasKey | undefined {
    return (NODE_TYPE_LABELS as Record<string, FlowCanvasKey>)[type]
}

/** Readable label key for a known skip reason. */
export function skipReasonLabelKey(reason: string): FlowCanvasKey | undefined {
    return (SKIP_REASON_LABELS as Record<string, FlowCanvasKey>)[reason]
}

/** Readable label key for a node failure policy. */
export function policyLabelKey(policy: string): FlowCanvasKey | undefined {
    return (POLICY_LABELS as Record<string, FlowCanvasKey>)[policy]
}

/** Render a flow id as its readable label, falling back to the raw id. */
export function flowLabel(flowId: string, t: TranslateNS<'flowCanvas'>): string {
    const key = flowLabelKey(flowId)
    return key === undefined ? flowId : t(key)
}

/** Render a node type as its readable label, falling back to the raw type. */
export function nodeTypeLabel(type: string, t: TranslateNS<'flowCanvas'>): string {
    const key = nodeTypeLabelKey(type)
    return key === undefined ? type : t(key)
}

/** Render a skip reason in Chinese when it is a known engine reason. */
export function skipReasonLabel(reason: string, t: TranslateNS<'flowCanvas'>): string {
    const key = skipReasonLabelKey(reason)
    return key === undefined ? reason : t(key)
}

/** Render a node-detail line, translating known skip reasons. */
export function detailText(detail: DetailLine, t: TranslateNS<'flowCanvas'>): string {
    if (detail.key === 'node.detail.skip') {
        return t('node.detail.skip', { reason: skipReasonLabel(String(detail.params['reason']), t) })
    }
    return t(detail.key, detail.params)
}

/**
 * The nodes an operator should look at first: suspended approvals, then
 * failures. Order follows the projection so the result is stable.
 * @param flow - static projection, when loaded.
 * @param run - current run, when one exists.
 * @returns awaiting and failed node labels.
 */
export function attentionNodes(
    flow: CanvasFlow | undefined,
    run: RunView | undefined,
): { readonly awaiting: readonly AttentionNode[]; readonly failed: readonly AttentionNode[] } {
    const awaiting: AttentionNode[] = []
    const failed: AttentionNode[] = []
    if (flow === undefined || run === undefined) return { awaiting, failed }
    for (const node of flow.nodes) {
        const runtime = run.nodes[node.id]
        if (runtime === undefined) continue
        if (runtime.status === 'awaiting-approval' || pendingApproval(runtime) !== undefined) {
            awaiting.push({ nodeId: node.id, label: node.display.label })
        } else if (runtime.status === 'failed') {
            failed.push({ nodeId: node.id, label: node.display.label })
        }
    }
    return { awaiting, failed }
}

/**
 * Every open approval in the current run, in node order. The panel shows the
 * first one in the approval dock; the rest are counted.
 * @param flow - static projection.
 * @param run - current run.
 * @returns pending approvals with their node labels.
 */
export function pendingApprovals(
    flow: CanvasFlow | undefined,
    run: RunView | undefined,
): readonly PendingApprovalView[] {
    if (flow === undefined || run === undefined) return []
    const pending: PendingApprovalView[] = []
    for (const node of flow.nodes) {
        const audit = pendingApproval(run.nodes[node.id])
        if (audit !== undefined) pending.push({ nodeId: node.id, nodeLabel: node.display.label, audit })
    }
    return pending
}

/**
 * `m:ss` remaining until an approval deadline.
 * @param expiresAt - deadline in epoch ms.
 * @param now - current epoch ms.
 * @returns remaining time, or undefined when there is no deadline.
 */
export function formatRemaining(expiresAt: number | undefined, now: number): string | undefined {
    if (expiresAt === undefined) return undefined
    const left = Math.max(0, expiresAt - now)
    const seconds = Math.ceil(left / 1000)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
