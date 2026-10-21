/**
 * Pure presentation mappings: node status to palette/marker/locale key, node
 * detail line, approval audit, run digest, and the one contract-safe output
 * reader. Edge mapping lives in `edges.ts`.
 *
 * 纯展示映射：节点状态 → 色板/标记/语言键、节点详情行、授权审计、运行摘要，
 * 以及唯一契约安全的 output 读取入口。边的映射在 `edges.ts`。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/model
 */

import type {
    CanvasNodeRuntime,
    CanvasRunSnapshot,
} from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowApprovalAudit, FlowApprovalOutcome } from '@deepseek-ai/dsh-graph-flow-api'
import type { FlowCanvasKey } from './locales.ts'
import type { RunView } from './store.ts'

/** Node status from the canvas run projection. */
export type NodeStatus = CanvasNodeRuntime['status']

/** Palette key used by CSS. */
export type StatusTone = 'pending' | 'ready' | 'running' | 'awaiting' | 'completed' | 'recovered' | 'failed' | 'skipped' | 'cancelled'

/** Everything the surfaces need to draw a status. */
export interface StatusVisual {
    readonly tone: StatusTone
    readonly labelKey: FlowCanvasKey
}

/**
 * Status → tone/label key. A recovered `completed` never looks like a clean
 * success: it uses the amber palette and the recovered label.
 * @param status - node status.
 * @param recovered - the errorBranch recovered fact.
 * @returns the visual facts.
 */
export function statusVisual(status: NodeStatus, recovered?: { readonly code: string }): StatusVisual {
    if (status === 'completed' && recovered !== undefined) {
        return { tone: 'recovered', labelKey: 'status.recovered' }
    }
    switch (status) {
        case 'pending': return { tone: 'pending', labelKey: 'status.pending' }
        case 'ready': return { tone: 'ready', labelKey: 'status.ready' }
        case 'running': return { tone: 'running', labelKey: 'status.running' }
        case 'awaiting-approval': return { tone: 'awaiting', labelKey: 'status.awaitingApproval' }
        case 'completed': return { tone: 'completed', labelKey: 'status.completed' }
        case 'failed': return { tone: 'failed', labelKey: 'status.failed' }
        case 'skipped': return { tone: 'skipped', labelKey: 'status.skipped' }
        case 'cancelled': return { tone: 'cancelled', labelKey: 'status.cancelled' }
        default: return assertNever(status)
    }
}

/** Closed-union exhaustiveness fence. */
function assertNever(value: never): never {
    throw new Error(`unhandled node status: ${String(value)}`)
}

/** A localized detail line: locale key plus interpolation values. */
export interface DetailLine {
    readonly key: FlowCanvasKey
    readonly params: Readonly<Record<string, string | number>>
}

/**
 * Node detail line: error > recovered > skip reason. Reads only the runtime
 * record; output never appears here.
 * @param runtime - the runtime node, when the run has a record.
 * @returns the detail line or undefined.
 */
export function nodeDetail(runtime: CanvasNodeRuntime | undefined): DetailLine | undefined {
    if (runtime === undefined) return undefined
    if (runtime.error !== undefined) {
        return { key: 'node.detail.error', params: { code: runtime.error.code, message: runtime.error.message } }
    }
    if (runtime.recovered !== undefined) {
        return { key: 'node.detail.recovered', params: { code: runtime.recovered.code } }
    }
    if (runtime.skipReason !== undefined) {
        return { key: 'node.detail.skip', params: { reason: runtime.skipReason } }
    }
    return undefined
}

/**
 * The still-pending approval of a node, if any. A request is pending exactly
 * while its audit entry has no outcome; only one can be open per node attempt.
 * @param runtime - the node's live record.
 * @returns the pending audit entry, or undefined.
 */
export function pendingApproval(runtime: CanvasNodeRuntime | undefined): FlowApprovalAudit | undefined {
    const approvals = runtime?.approvals
    if (approvals === undefined) return undefined
    for (let index = approvals.length - 1; index >= 0; index -= 1) {
        const audit = approvals[index]
        if (audit !== undefined && audit.outcome === undefined) return audit
    }
    return undefined
}

/**
 * The last settled approval of a node (audit minimum for the card line).
 * 仅供测试/对外契约；若审批卡最终不展示审计行，此导出应升级为"该接没接"再评估。
 * Test-only / external contract; if the approval card never shows the audit
 * line, re-evaluate this export as unwired surface.
 */
export function settledApproval(runtime: CanvasNodeRuntime | undefined): FlowApprovalAudit | undefined {
    const approvals = runtime?.approvals
    if (approvals === undefined) return undefined
    for (let index = approvals.length - 1; index >= 0; index -= 1) {
        const audit = approvals[index]
        if (audit !== undefined && audit.outcome !== undefined) return audit
    }
    return undefined
}

/**
 * Stable `HH:MM:SS` clock for audit timestamps (locale-independent so the
 * card and its tests agree regardless of the host locale).
 * @param at - epoch milliseconds.
 * @returns the local wall-clock time.
 */
export function formatClock(at: number): string {
    const date = new Date(at)
    const pad = (value: number): string => String(value).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Locale key plus values for one settled approval (the node card's audit line). */
export interface ApprovalAuditLine {
    readonly key: FlowCanvasKey
    readonly params: Readonly<Record<string, string | number>>
}

/**
 * Turn a settled approval into the card's one-line audit: who allowed/denied,
 * when, or that the timeout/cancel produced it without an actor.
 * @param audit - a settled audit entry.
 * @returns the localized line, or undefined while pending.
 */
export function approvalAuditLine(audit: FlowApprovalAudit | undefined): ApprovalAuditLine | undefined {
    const outcome = audit?.outcome
    if (audit === undefined || outcome === undefined) return undefined
    const time = formatClock(outcome.decidedAt)
    switch (outcome.via) {
        case 'user':
            return {
                key: outcome.decision === 'allow' ? 'approval.audit.allowed' : 'approval.audit.denied',
                params: { actor: outcome.decidedBy ?? '?', time },
            }
        case 'timeout':
            return { key: 'approval.audit.timeout', params: { time } }
        case 'cancel':
            return { key: 'approval.audit.cancel', params: { time } }
        case 'unavailable':
            return { key: 'approval.audit.unavailable', params: {} }
        default:
            return assertNever(outcome.via)
    }
}

/** Human label key of one outcome (pending or settled). */
export function outcomeLabelKey(outcome: FlowApprovalOutcome | undefined): FlowCanvasKey {
    if (outcome === undefined) return 'approval.decision.pending'
    if (outcome.via !== 'user') return `approval.decision.${outcome.via}` as FlowCanvasKey
    return outcome.decision === 'allow' ? 'approval.decision.allow' : 'approval.decision.deny'
}

/** Why a node output is unavailable. */
export type OutputUnavailableReason = 'no-run' | 'running' | 'missing-node' | 'no-output'

/** The output read result: a value or an explained absence. */
export type NodeOutput =
    | { readonly available: true; readonly value: unknown }
    | { readonly available: false; readonly reason: OutputUnavailableReason }

/**
 * The only entry point for reading a node's output. Contract: the canvas
 * runtime carries status/time/error only; output comes from
 * `snapshot.result.nodes[id].output`, exposed here as `RunView.result`.
 * @param run - the live run view, when one exists.
 * @param nodeId - the node whose output to read.
 * @returns the output or the reason it is unavailable.
 */
export function nodeOutput(run: RunView | undefined, nodeId: string): NodeOutput {
    if (run === undefined) return { available: false, reason: 'no-run' }
    if (run.result === null) return { available: false, reason: 'running' }
    const record = run.result.nodes[nodeId]
    if (record === undefined) return { available: false, reason: 'missing-node' }
    if (!Object.prototype.hasOwnProperty.call(record, 'output')) return { available: false, reason: 'no-output' }
    return { available: true, value: record.output }
}

/** One run's digest for the status line. */
export interface RunDigest {
    readonly clean: number
    readonly recovered: number
    readonly failed: number
    readonly skipped: number
    /** Nodes currently blocked on a human decision / 当前等待授权决定的节点数 */
    readonly awaiting: number
}

/**
 * Count terminal node outcomes of a run plus the nodes suspended on approval.
 * @param snapshot - the run snapshot.
 * @returns clean, recovered, failed, skipped and awaiting counts.
 */
export function runDigest(snapshot: Pick<CanvasRunSnapshot, 'nodes'>): RunDigest {
    let clean = 0
    let recovered = 0
    let failed = 0
    let skipped = 0
    let awaiting = 0
    for (const record of Object.values(snapshot.nodes)) {
        if (record.status === 'awaiting-approval') awaiting += 1
        else if (record.recovered !== undefined) recovered += 1
        else if (record.status === 'completed') clean += 1
        else if (record.status === 'failed') failed += 1
        else if (record.status === 'skipped') skipped += 1
    }
    return { clean, recovered, failed, skipped, awaiting }
}

/**
 * Elapsed time of one runtime record.
 * @param runtime - a node with optional start/end timestamps.
 * @returns milliseconds, or undefined while incomplete.
 */
export function durationMs(runtime: Pick<CanvasNodeRuntime, 'startedAt' | 'endedAt'>): number | undefined {
    if (runtime.startedAt === undefined || runtime.endedAt === undefined) return undefined
    return Math.max(0, runtime.endedAt - runtime.startedAt)
}

/**
 * Render a value as JSON text without throwing.
 * @param value - the value to display.
 * @returns the JSON text, or `undefined`'s textual form.
 */
export function jsonText(value: unknown): string {
    if (value === undefined) return 'undefined'
    try {
        return JSON.stringify(value, null, 2) ?? String(value)
    } catch {
        return String(value)
    }
}
