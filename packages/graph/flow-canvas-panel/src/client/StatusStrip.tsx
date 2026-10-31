/**
 * Run status strip: one line that answers "is it running, what needs me, and
 * how is the run doing?".
 *
 * Actionable facts (a suspended approval, a failure) become buttons that open
 * the exact node; the neutral completion counters stay quiet on the right.
 *
 * 运行状态条：一行回答“在跑吗、有什么需要我处理、整体结果如何”。需要人处理的事实
 * （挂起的授权、失败）变成按钮并直接打开对应节点；中性的完成计数安静地放在右侧。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/StatusStrip
 */

import type { CanvasFlow, CanvasRunSnapshot } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RunDigest } from './model.ts'
import type { AttentionNode } from './present.ts'
import type { RunView } from './store.ts'
import css from './panel.module.css'

/** Inputs of the status strip. */
export interface StatusStripProps {
    /** Loading phase of the flow list. */
    readonly phase: 'loading' | 'ready' | 'error'
    /** Load error, when the phase is error. */
    readonly error: string | undefined
    /** Number of registered flows. */
    readonly flowCount: number
    /** Selected static flow, when projected. */
    readonly flow: CanvasFlow | undefined
    /** Current run, when one exists. */
    readonly run: RunView | undefined
    /** Outcome counters of the run. */
    readonly digest: RunDigest | undefined
    /** Nodes needing a human, in projection order. */
    readonly attention: { readonly awaiting: readonly AttentionNode[]; readonly failed: readonly AttentionNode[] }
    /** Open the inspector for one node. */
    readonly onSelectNode: (nodeId: string) => void
    /** Panel translator. */
    readonly t: TranslateNS<'flowCanvas'>
}

/** CSS class of a run status pill. */
function runClass(status: CanvasRunSnapshot['status']): string {
    const classes = {
        running: css.runRunning,
        completed: css.runCompleted,
        failed: css.runFailed,
        cancelled: css.runCancelled,
    } as const
    return classes[status] ?? ''
}

/** Props of the left run-state segment. */
interface RunStateLineProps {
    readonly phase: StatusStripProps['phase']
    readonly error: string | undefined
    readonly flowCount: number
    readonly flow: CanvasFlow | undefined
    readonly run: RunView | undefined
    readonly t: TranslateNS<'flowCanvas'>
}

/** The left segment: load phase message or the run status pill. */
function RunStateLine({ phase, error, flowCount, flow, run, t }: RunStateLineProps) {
    return (
        <div className={css.statusLeft}>
            {phase === 'error'
                ? <span className={css.error}>{t('panel.error', { message: error ?? '' })}</span>
                : flowCount === 0 && phase !== 'loading'
                    ? <span className={css.muted}>{t('panel.emptyFlows')}</span>
                    : run === undefined
                        ? <span className={css.muted}>{flow === undefined ? t('panel.loading') : t('panel.noRun')}</span>
                        : (
                            <span className={`${css.runPill} ${runClass(run.status)}`}>
                                <span className={css.runDot} aria-hidden="true" />
                                {t(`run.status.${run.status}`)}
                            </span>
                        )}
        </div>
    )
}

/** Props of one actionable attention button. */
interface AttentionButtonProps {
    /** Extra tone class (`attentionApproval` / `attentionFailed`). */
    readonly tone: string | undefined
    /** The icon glyph (`!` / `×`). */
    readonly icon: string
    /** The localized headline with its count. */
    readonly label: string
    /** The localized hint line. */
    readonly hint: string
    /** The localized action verb. */
    readonly action: string
    /** The node to open when clicked. */
    readonly nodeId: string
    readonly onSelectNode: (nodeId: string) => void
}

/** One actionable fact (a suspended approval, a failure) that opens the exact node. */
function AttentionButton({ tone, icon, label, hint, action, nodeId, onSelectNode }: AttentionButtonProps) {
    return (
        <button type="button" className={`${css.attention} ${tone}`} onClick={() => { onSelectNode(nodeId) }}>
            <span className={css.attentionIcon} aria-hidden="true">{icon}</span>
            <span className={css.attentionText}>
                <strong>{label}</strong>
                <small>{hint}</small>
            </span>
            <span className={css.attentionAction}>{action} ›</span>
        </button>
    )
}

/** One neutral completion counter chip. */
interface DigestChip {
    readonly key: string
    readonly label: string
    readonly value: number
    readonly tone: string | undefined
}

/** The neutral completion counters; quiet on the right, absent when empty. */
function DigestChips({ counts }: { readonly counts: readonly DigestChip[] }) {
    if (counts.length === 0) return null
    return (
        <div className={css.digest}>
            {counts.map(count => (
                <span key={count.key} className={`${css.chip} ${count.tone}`}>
                    <span className={css.chipDot} aria-hidden="true" />
                    {count.label}
                    <strong>{count.value}</strong>
                </span>
            ))}
        </div>
    )
}

/**
 * Render the status strip.
 * @param props - run, counters and attention queue.
 * @returns the strip.
 */
export function StatusStrip({
    phase, error, flowCount, flow, run, digest, attention, onSelectNode, t,
}: StatusStripProps) {
    const counts = digest === undefined
        ? []
        : [
            { key: 'clean', label: t('digest.clean'), value: digest.clean, tone: css.chipClean },
            { key: 'recovered', label: t('digest.recovered'), value: digest.recovered, tone: css.chipRecovered },
            { key: 'failed', label: t('digest.failed'), value: digest.failed, tone: css.chipFailed },
            { key: 'skipped', label: t('digest.skipped'), value: digest.skipped, tone: css.chipSkipped },
        ].filter(count => count.value > 0)
    return (
        <div className={css.statusBar} aria-live="polite">
            <RunStateLine phase={phase} error={error} flowCount={flowCount} flow={flow} run={run} t={t} />
            {attention.awaiting.length > 0 ? (
                <AttentionButton
                    tone={css.attentionApproval} icon="!" nodeId={attention.awaiting[0]!.nodeId} onSelectNode={onSelectNode}
                    label={t('attention.approval', { count: attention.awaiting.length })} hint={t('attention.approvalHint')}
                    action={t('attention.handle')}
                />
            ) : null}
            {attention.failed.length > 0 ? (
                <AttentionButton
                    tone={css.attentionFailed} icon="×" nodeId={attention.failed[0]!.nodeId} onSelectNode={onSelectNode}
                    label={t('attention.failed', { count: attention.failed.length })} hint={t('attention.failedHint')}
                    action={t('attention.review')}
                />
            ) : null}
            <DigestChips counts={counts} />
        </div>
    )
}
