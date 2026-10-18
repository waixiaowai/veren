/**
 * Approval dock: one fixed slot above the canvas where a pending request (or
 * the result of the answer just given) owns the operator's attention.
 *
 * The dock never floats over nodes or edges. After a decision it stays in
 * place and explains what happened until dismissed, so the graph below keeps
 * its full size and the audit remains readable.
 *
 * 授权坞：画布上方一个固定位置，用来放大挂起请求（或刚回答完的结果），让它占用操作者的
 * 注意力。授权坞从不浮在节点/边之上。做出决定后它留在原处说明结果，直到用户收起，
 * 因此下方的图保持完整尺寸，审计信息也一直可读。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/ApprovalDock
 */

import type { FlowApprovalAudit, FlowApprovalDecision } from '@deepseek-ai/dsh-graph-flow-api'
import type { CanvasNodeRuntime } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { approvalAuditLine } from './model.ts'
import type { PendingApprovalView } from './present.ts'
import { NodeApprovalCard } from './NodeApprovalCard.tsx'
import css from './panel.module.css'

/** The answer just given, kept locally so the dock can report the result in place. */
export interface DecisionNotice {
    readonly nodeId: string
    readonly request: FlowApprovalAudit['request']
    readonly decision: FlowApprovalDecision
    readonly at: number
}

/** Inputs of the approval dock. */
export interface ApprovalDockProps {
    /** Every open approval of the current run, in node order. */
    readonly pending: readonly PendingApprovalView[]
    /** The answer just given, when this run has one that is not superseded. */
    readonly notice: DecisionNotice | undefined
    /** The settled audit entry matching {@link notice}, once the stream has it. */
    readonly settledAudit: FlowApprovalAudit | undefined
    /** Current status of the node that owned {@link notice}. */
    readonly settledStatus: CanvasNodeRuntime['status'] | undefined
    /** Answer the first pending request. */
    readonly onDecision: (requestId: string, decision: FlowApprovalDecision) => void
    /** Dismiss the settled result. */
    readonly onDismiss: () => void
    /** Panel translator. */
    readonly t: TranslateNS<'flowCanvas'>
}

/**
 * Render the approval dock, or nothing when no request needs a human.
 * @param props - pending queue, local result notice and callbacks.
 * @returns the dock.
 */
export function ApprovalDock({ pending, notice, settledAudit, settledStatus, onDecision, onDismiss, t }: ApprovalDockProps) {
    const active = pending[0]
    if (notice !== undefined) {
        const auditLine = approvalAuditLine(settledAudit)
        const settled = settledStatus === 'completed' || settledStatus === 'failed'
            || settledStatus === 'skipped' || settledStatus === 'cancelled'
        const messageKey = notice.decision === 'allow'
            ? settledStatus === 'completed'
                ? 'approval.settledAllowDone'
                : settledStatus === 'failed'
                    ? 'approval.settledAllowFailed'
                    : 'approval.settledAllow'
            : settled
                ? 'approval.settledDenyDone'
                : 'approval.settledDeny'
        return (
            <section className={css.approvalSettled} role="status" aria-label={t('approval.title')}>
                <span
                    className={`${css.approvalSettledIcon} ${notice.decision === 'allow' ? css.approvalSettledAllow : css.approvalSettledDeny}`}
                    aria-hidden="true"
                >
                    {notice.decision === 'allow' ? '✓' : '×'}
                </span>
                <div className={css.approvalSettledBody}>
                    <div className={css.approvalSettledTitle}>
                        <strong>{t(messageKey)}</strong>
                        <span className={css.approvalAction}>{t('approval.action', { action: notice.request.action })}</span>
                    </div>
                    {auditLine === undefined
                        ? <span className={css.muted}>{t('approval.hint')}</span>
                        : <span className={css.approvalSettledAudit}>{t(auditLine.key, auditLine.params)}</span>}
                </div>
                <button type="button" className={css.button} onClick={onDismiss}>{t('approval.dismiss')}</button>
            </section>
        )
    }
    if (active === undefined) return null
    return (
        <section className={css.approvalDock} aria-label={t('approval.title')}>
            <NodeApprovalCard
                audit={active.audit}
                nodeLabel={active.nodeLabel}
                moreCount={Math.max(0, pending.length - 1)}
                onDecision={onDecision}
                t={t}
            />
        </section>
    )
}
