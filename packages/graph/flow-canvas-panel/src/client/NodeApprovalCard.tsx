/**
 * The shared node approval card.
 *
 * It renders one pending request (which tool/action, what it will do, why it
 * needs a human, and the auto-deny deadline) and offers exactly two answers:
 * a large primary "agree" and a secondary "deny". It owns no transport — the
 * decision goes through the owner-provided callback, which is the same
 * single-use, run-scoped path the Host enforces. The panel docks this card
 * above the canvas, so it never covers the graph.
 *
 * 共享的节点授权卡。它渲染一条挂起请求（哪个工具/动作、要做什么、为什么需要人、
 * 自动拒绝期限），只提供两个回答：大号主按钮“同意”和次按钮“拒绝”。它不持有传输——
 * 决定经 owner 提供的回调走宿主同一条一次性、按 run 隔离的路径。面板把这张卡固定在
 * 画布上方，因此永远不会盖住图。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/NodeApprovalCard
 */

import { useEffect, useState } from 'react'
import type { FlowApprovalAudit, FlowApprovalDecision } from '@deepseek-ai/dsh-graph-flow-api'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { formatClock } from './model.ts'
import { formatRemaining } from './present.ts'
import css from './panel.module.css'

/** Props of the reusable approval card. */
export interface NodeApprovalCardProps {
    /** The pending audit entry (its outcome is undefined). */
    readonly audit: FlowApprovalAudit
    /** Answer this request; the panel forwards it to `flowCanvas/answer`. */
    readonly onDecision: (requestId: string, decision: FlowApprovalDecision) => void
    /** Panel translator. */
    readonly t: TranslateNS<'flowCanvas'>
    /** Readable node label, when the host knows which card owns the request. */
    readonly nodeLabel?: string
    /** How many further requests are queued behind this one. */
    readonly moreCount?: number
}

/** Props of the title row: what will happen, on which node, how many queued. */
interface ApprovalTitleRowProps {
    readonly request: FlowApprovalAudit['request']
    readonly nodeLabel: string | undefined
    readonly moreCount: number
    readonly t: TranslateNS<'flowCanvas'>
}

/** Badge, action, owning node and the queued-behind count. */
function ApprovalTitleRow({ request, nodeLabel, moreCount, t }: ApprovalTitleRowProps) {
    return (
        <div className={css.approvalTitleRow}>
            <span className={css.approvalBadge}>{t('approval.badge')}</span>
            <span className={css.approvalAction} title={request.action}>
                {t('approval.action', { action: request.action })}
            </span>
            {nodeLabel === undefined ? null : (
                <span className={css.approvalNode}>{t('approval.node', { node: nodeLabel })}</span>
            )}
            {moreCount > 0
                ? <span className={css.approvalMore}>{t('approval.more', { count: moreCount })}</span>
                : null}
        </div>
    )
}

/** Props of the timestamps row. */
interface ApprovalMetaProps {
    readonly request: FlowApprovalAudit['request']
    readonly expiresAt: number | undefined
    readonly remaining: string | undefined
    readonly expired: boolean
    readonly t: TranslateNS<'flowCanvas'>
}

/** Requested-at / expires-at plus the live countdown (or the expired mark). */
function ApprovalMeta({ request, expiresAt, remaining, expired, t }: ApprovalMetaProps) {
    return (
        <div className={css.approvalMeta}>
            <span>{t('approval.requestedAt', { time: formatClock(request.requestedAt) })}</span>
            {expiresAt === undefined
                ? null
                : <span>{t('approval.expiresAt', { time: formatClock(expiresAt) })}</span>}
            {remaining === undefined
                ? null
                : (
                    <strong className={expired ? css.approvalExpired : css.approvalCountdown}>
                        {expired ? t('approval.expired') : t('approval.remaining', { time: remaining })}
                    </strong>
                )}
        </div>
    )
}

/** Props of the card body (everything between the lead and the buttons). */
interface ApprovalDetailsProps {
    readonly request: FlowApprovalAudit['request']
    readonly nodeLabel: string | undefined
    readonly moreCount: number
    readonly expiresAt: number | undefined
    readonly remaining: string | undefined
    readonly expired: boolean
    readonly t: TranslateNS<'flowCanvas'>
}

/** What the request will do, why it needs a human, and the auto-deny deadline. */
function ApprovalDetails({ request, nodeLabel, moreCount, expiresAt, remaining, expired, t }: ApprovalDetailsProps) {
    return (
        <div className={css.approvalMain}>
            <ApprovalTitleRow request={request} nodeLabel={nodeLabel} moreCount={moreCount} t={t} />
            <p className={css.approvalHint}>{t('approval.hint')}</p>
            {request.reason === undefined ? null : (
                <p className={css.approvalReason}>
                    <strong>{t('approval.reason')}</strong>
                    <span>{request.reason}</span>
                </p>
            )}
            {request.summary === undefined ? null : (
                <div className={css.approvalArgs}>
                    <span className={css.approvalLabel}>{t('approval.arguments')}</span>
                    <pre className={css.approvalSummary}>{request.summary}</pre>
                </div>
            )}
            <ApprovalMeta request={request} expiresAt={expiresAt} remaining={remaining} expired={expired} t={t} />
        </div>
    )
}

/** Props of the two answers plus the answered marker. */
interface ApprovalButtonsProps {
    readonly answered: FlowApprovalDecision | undefined
    readonly expired: boolean
    readonly answer: (decision: FlowApprovalDecision) => void
    readonly t: TranslateNS<'flowCanvas'>
}

/** Exactly two answers: a large primary "agree" and a secondary "deny"; single use. */
function ApprovalButtons({ answered, expired, answer, t }: ApprovalButtonsProps) {
    return (
        <div className={css.approvalActions}>
            {answered === undefined ? null : (
                <span className={css.approvalAnswered} role="status">
                    {t(answered === 'allow' ? 'approval.settledAllow' : 'approval.settledDeny')}
                </span>
            )}
            <button
                type="button" className={`${css.approvalButton} ${css.approvalAllow}`} aria-label={t('approval.allow')}
                title={t('approval.allowHint')} disabled={answered !== undefined || expired} onClick={() => { answer('allow') }}
            >
                <span>{t('approval.allow')}</span>
                <small>{t('approval.allowHint')}</small>
            </button>
            <button
                type="button" className={`${css.approvalButton} ${css.approvalDeny}`} aria-label={t('approval.deny')}
                title={t('approval.denyHint')} disabled={answered !== undefined || expired} onClick={() => { answer('deny') }}
            >
                <span>{t('approval.deny')}</span>
                <small>{t('approval.denyHint')}</small>
            </button>
        </div>
    )
}

/**
 * Render one pending approval.
 * @param props - pending request, decision callback and translator.
 * @returns the approval card.
 */
export function NodeApprovalCard({ audit, onDecision, t, nodeLabel, moreCount = 0 }: NodeApprovalCardProps) {
    const [answered, setAnswered] = useState<FlowApprovalDecision>()
    const [now, setNow] = useState(() => Date.now())
    const request = audit.request
    const expiresAt = request.expiresAt
    useEffect(() => {
        if (expiresAt === undefined) return
        const timer = setInterval(() => { setNow(Date.now()) }, 1000)
        return () => { clearInterval(timer) }
    }, [expiresAt])
    const remaining = formatRemaining(expiresAt, now)
    const expired = expiresAt !== undefined && now >= expiresAt
    const answer = (decision: FlowApprovalDecision): void => {
        if (answered !== undefined) return
        setAnswered(decision)
        onDecision(request.id, decision)
    }
    return (
        <div className={css.approvalCard} role="group" aria-label={t('approval.title')}>
            <span className={css.approvalLead} aria-hidden="true">!</span>
            <ApprovalDetails
                request={request} nodeLabel={nodeLabel} moreCount={moreCount} expiresAt={expiresAt}
                remaining={remaining} expired={expired} t={t}
            />
            <ApprovalButtons answered={answered} expired={expired} answer={answer} t={t} />
        </div>
    )
}
