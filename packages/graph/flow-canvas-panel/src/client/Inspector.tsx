/**
 * Node inspector: the full story for one node — readable type, status, policy,
 * timing, errors, approval audit, and the one contract-safe output read.
 *
 * Output comes from `snapshot.result.nodes[id].output` only; the canvas runtime
 * never carries it. Missing output is explained instead of rendered as `{}`.
 *
 * 节点详情：一个节点的完整故事——可读类型、状态、策略、耗时、错误、授权审计，以及唯一
 * 契约安全的 output 读取。output 只来自 `snapshot.result.nodes[id].output`；画布运行时
 * 从不携带它。缺失时会解释原因，而不是渲染成 `{}`。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/Inspector
 */

import type { ReactNode } from 'react'
import type { CanvasNode, CanvasNodeRuntime } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowApprovalAudit } from '@deepseek-ai/dsh-graph-flow-api'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RunView } from './store.ts'
import type { FlowCanvasKey } from './locales.ts'
import { approvalAuditLine, durationMs, jsonText, nodeOutput, outcomeLabelKey, statusVisual } from './model.ts'
import { nodeTypeLabel, policyLabelKey, skipReasonLabel } from './present.ts'
import css from './panel.module.css'

/** Inputs of the inspector. */
export interface InspectorProps {
    /** The inspected node, absent when nothing is selected. */
    readonly node: CanvasNode | undefined
    /** Its live record, when the run has one. */
    readonly runtime: CanvasNodeRuntime | undefined
    /** The current run view, used for output and duration. */
    readonly run: RunView | undefined
    /** Clear the selection. */
    readonly onClose: () => void
    /** Panel translator. */
    readonly t: TranslateNS<'flowCanvas'>
}

/** Locale key explaining why output is unavailable. */
const OUTPUT_REASONS = {
    'no-run': 'output.noRun',
    'running': 'output.running',
    'missing-node': 'output.missingNode',
    'no-output': 'output.noOutput',
} as const satisfies Record<string, FlowCanvasKey>

/** Status tone → CSS class. */
function toneClass(tone: ReturnType<typeof statusVisual>['tone']): string {
    const classes = {
        pending: css.tonePending,
        ready: css.toneReady,
        running: css.toneRunning,
        awaiting: css.toneAwaiting,
        completed: css.toneCompleted,
        recovered: css.toneRecovered,
        failed: css.toneFailed,
        skipped: css.toneSkipped,
        cancelled: css.toneCancelled,
    } as const
    return classes[tone] ?? ''
}

/** One labeled field row of the inspector grid. */
function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
    return (
        <div className={css.field}>
            <dt className={css.inspectorFieldLabel}>{label}</dt>
            <dd className={css.fieldValue}>{children}</dd>
        </div>
    )
}

/** Props of the inspector header (title, status pill, close). */
interface InspectorHeaderProps {
    readonly node: CanvasNode
    readonly visual: ReturnType<typeof statusVisual>
    readonly onClose: () => void
    readonly t: TranslateNS<'flowCanvas'>
}

/** Kicker, node label, status pill and the close button. */
function InspectorHeader({ node, visual, onClose, t }: InspectorHeaderProps) {
    return (
        <div className={css.inspectorHeader}>
            <div className={css.inspectorHeading}>
                <span className={css.inspectorKicker}>{t('inspector.title')}</span>
                <h2 className={css.inspectorTitle}>{node.display.label}</h2>
            </div>
            <div className={css.inspectorActions}>
                <span className={`${css.statusPill} ${toneClass(visual.tone)}`}>
                    <span className={css.statusDot} aria-hidden="true" />
                    {t(visual.labelKey)}
                </span>
                <button type="button" className={css.closeButton} aria-label={t('inspector.close')} title={t('inspector.close')} onClick={onClose}>×</button>
            </div>
        </div>
    )
}

/** The runtime error box when the node carries one. */
function ErrorBox({ error, t }: { readonly error: { code: string; message: string }; readonly t: TranslateNS<'flowCanvas'> }) {
    return (
        <section className={css.errorBox} role="alert">
            <span className={css.errorTitle}>{t('inspector.error')}</span>
            <code className={css.errorCode}>{error.code}</code>
            <p className={css.errorMessage}>{error.message}</p>
        </section>
    )
}

/** The approval audit list of this node (pending entries have no outcome). */
function ApprovalList({ approvals, t }: { readonly approvals: readonly FlowApprovalAudit[]; readonly t: TranslateNS<'flowCanvas'> }) {
    return (
        <section className={css.inspectorSection}>
            <h3 className={css.sectionTitle}>{t('inspector.approvals')}</h3>
            <ul className={css.approvalList}>
                {approvals.map((audit) => {
                    const line = approvalAuditLine(audit)
                    return (
                        <li key={audit.request.id} className={css.approvalItem}>
                            <span className={css.approvalItemTitle}>
                                {t('approval.action', { action: audit.request.action })}
                                {' · '}
                                {t(outcomeLabelKey(audit.outcome))}
                            </span>
                            {audit.request.reason === undefined
                                ? null
                                : <span className={css.muted}>{audit.request.reason}</span>}
                            {line === undefined ? null : <span className={css.muted}>{t(line.key, line.params)}</span>}
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}

/** Props of the output section. */
interface OutputSectionProps {
    readonly node: CanvasNode
    readonly output: ReturnType<typeof nodeOutput>
    readonly t: TranslateNS<'flowCanvas'>
}

/**
 * The one contract-safe output read: `snapshot.result.nodes[id].output` only.
 * Missing output is explained instead of rendered as `{}`.
 * 唯一契约安全的 output 读取。缺失时会解释原因，而不是渲染成 `{}`。
 */
function OutputSection({ node, output, t }: OutputSectionProps) {
    return (
        <section className={css.inspectorSection}>
            <div className={css.sectionTitleRow}>
                <h3 className={css.sectionTitle}>{t('inspector.output')}</h3>
                <span className={css.outputPathLabel}>{t('inspector.outputSource')}</span>
            </div>
            <code className={css.outputPath}>{t('inspector.outputPath', { id: node.id })}</code>
            {output.available
                ? <pre className={css.pre}>{jsonText(output.value)}</pre>
                : <p className={css.muted}>{t(OUTPUT_REASONS[output.reason])}</p>}
        </section>
    )
}

/**
 * Render the inspector.
 * @param props - node, runtime, run, close callback and translator.
 * @returns the inspector column, or nothing when no node is selected.
 */
export function Inspector({ node, runtime, run, onClose, t }: InspectorProps) {
    if (node === undefined) return null
    const visual = statusVisual(runtime?.status ?? 'pending', runtime?.recovered)
    const output = nodeOutput(run, node.id)
    const elapsed = runtime === undefined ? undefined : durationMs(runtime)
    const policyKey = policyLabelKey(node.onError)
    const typeLabel = nodeTypeLabel(node.type, t)
    return (
        <aside className={css.inspector} aria-label={t('inspector.title')}>
            <InspectorHeader node={node} visual={visual} onClose={onClose} t={t} />
            <dl className={css.fieldGrid}>
                <Field label={t('inspector.type')}>{typeLabel}<code className={css.typeCode}>{node.type}</code></Field>
                <Field label={t('inspector.policy')}>{policyKey === undefined ? node.onError : t(policyKey)}</Field>
                {elapsed === undefined ? null : <Field label={t('inspector.duration')}>{t('inspector.durationValue', { ms: elapsed })}</Field>}
                {node.retry === undefined
                    ? null
                    : <Field label={t('inspector.retry')}>{t('inspector.retryValue', { tries: node.retry.tries, backoffMs: node.retry.backoffMs })}</Field>}
                {node.timeout === undefined
                    ? null
                    : <Field label={t('inspector.timeout')}>{t('inspector.timeoutValue', { ms: node.timeout })}</Field>}
            </dl>
            {runtime?.error === undefined ? null : <ErrorBox error={runtime.error} t={t} />}
            {runtime?.status === 'awaiting-approval' ? <p className={css.pendingHint}>{t('inspector.pendingHint')}</p> : null}
            {runtime?.skipReason === undefined
                ? null
                : <p className={css.pendingHint}>{t('node.detail.skip', { reason: skipReasonLabel(runtime.skipReason, t) })}</p>}
            {runtime?.approvals === undefined ? null : <ApprovalList approvals={runtime.approvals} t={t} />}
            <OutputSection node={node} output={output} t={t} />
        </aside>
    )
}
