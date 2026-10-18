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
            {attention.awaiting.length > 0
                ? (
                    <button
                        type="button"
                        className={`${css.attention} ${css.attentionApproval}`}
                        onClick={() => { onSelectNode(attention.awaiting[0]!.nodeId) }}
                    >
                        <span className={css.attentionIcon} aria-hidden="true">!</span>
                        <span className={css.attentionText}>
                            <strong>{t('attention.approval', { count: attention.awaiting.length })}</strong>
                            <small>{t('attention.approvalHint')}</small>
                        </span>
                        <span className={css.attentionAction}>{t('attention.handle')} ›</span>
                    </button>
                )
                : null}
            {attention.failed.length > 0
                ? (
                    <button
                        type="button"
                        className={`${css.attention} ${css.attentionFailed}`}
                        onClick={() => { onSelectNode(attention.failed[0]!.nodeId) }}
                    >
                        <span className={css.attentionIcon} aria-hidden="true">×</span>
                        <span className={css.attentionText}>
                            <strong>{t('attention.failed', { count: attention.failed.length })}</strong>
                            <small>{t('attention.failedHint')}</small>
                        </span>
                        <span className={css.attentionAction}>{t('attention.review')} ›</span>
                    </button>
                )
                : null}
            {counts.length === 0 ? null : (
                <div className={css.digest}>
                    {counts.map(count => (
                        <span key={count.key} className={`${css.chip} ${count.tone}`}>
                            <span className={css.chipDot} aria-hidden="true" />
                            {count.label}
                            <strong>{count.value}</strong>
                        </span>
                    ))}
                </div>
            )}
        </div>
    )
}
