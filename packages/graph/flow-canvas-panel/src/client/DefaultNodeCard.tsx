/**
 * Default node card: the fallback renderer of `flow.canvas.node`.
 *
 * The visual grammar is deliberately close to mature flow editors: a type
 * glyph, a strong title, a quiet type subtitle, one status accent, and one
 * secondary line (error code / skip reason / approval hint). The coloured rail
 * is the single status carrier; the card border stays neutral so status, type
 * and selection never compete for attention.
 *
 * 默认节点卡片：`flow.canvas.node` 的回落渲染器。视觉语法刻意贴近成熟流程工具：
 * 类型图标、清晰标题、安静的类型副标题、一个状态主视觉，以及一行次要信息
 * （错误码/跳过原因/授权提示）。左侧色条是唯一的状态色载体；卡片描边保持中性，
 * 让状态、类型与选中态不会互相抢注意力。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/DefaultNodeCard
 */

import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DetailLine } from './model.ts'
import { nodeDetail, statusVisual } from './model.ts'
import { NodeGlyph } from './NodeGlyph.tsx'
import { detailText, nodeTypeLabel, skipReasonLabel } from './present.ts'
import type { FlowCanvasNodeOwnerProps } from './slots.ts'
import css from './panel.module.css'

/** Props of the default card: slot owner currency plus this plugin's locale. */
export type DefaultNodeCardProps = FlowCanvasNodeOwnerProps & PropsLocale<'flowCanvas'>

/** Map a status tone onto the CSS variable carrier. */
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

/**
 * The card's one secondary line: the stable code/reason only. Full messages
 * belong to the inspector, where they have room and can wrap.
 * 卡片的唯一次要信息行：只保留稳定的错误码/原因；完整消息属于检查器。
 */
function detailLineOf(detail: DetailLine | undefined, detailTitle: string | undefined, t: TranslateNS<'flowCanvas'>): string | undefined {
    if (detail === undefined) return undefined
    if (detail.key === 'node.detail.skip') return skipReasonLabel(String(detail.params['reason']), t)
    if (detail.key === 'node.detail.error' || detail.key === 'node.detail.recovered') return String(detail.params['code'])
    return detailTitle
}

/** Props of the card body: title row plus the secondary line. */
interface NodeCardBodyProps {
    readonly node: FlowCanvasNodeOwnerProps['node']
    readonly labelKey: ReturnType<typeof statusVisual>['labelKey']
    readonly subtitle: string
    readonly subtitleTitle: string | undefined
    readonly pendingApproval: FlowCanvasNodeOwnerProps['pendingApproval']
    readonly t: TranslateNS<'flowCanvas'>
}

/** Title row (label + status) and the secondary line (detail or approval hint). */
function NodeCardBody({ node, labelKey, subtitle, subtitleTitle, pendingApproval, t }: NodeCardBodyProps) {
    return (
        <span className={css.nodeBody}>
            <span className={css.nodeTitleRow}>
                <span className={css.nodeLabel} title={node.display.label}>{node.display.label}</span>
                <span className={css.nodeStatus}>{t(labelKey)}</span>
            </span>
            <span className={css.nodeMetaRow}>
                {pendingApproval === undefined
                    ? <span className={css.nodeDetail} title={subtitleTitle}>{subtitle}</span>
                    : <span className={css.nodeApprovalHint}>{t('node.approvalHint')}</span>}
            </span>
        </span>
    )
}

/**
 * The panel's own node card.
 * @param props - node, runtime record, selection, approval face and translator.
 * @returns one clickable, compact node card.
 */
export function DefaultNodeCard({
    node, runtime, selected, onSelect, pendingApproval, t,
}: DefaultNodeCardProps) {
    const visual = statusVisual(runtime?.status ?? 'pending', runtime?.recovered)
    const detail = nodeDetail(runtime)
    const detailTitle = detail === undefined ? undefined : detailText(detail, t)
    const typeLabel = nodeTypeLabel(node.type, t)
    // Without a detail line the subtitle names the type; the icon carries the same information at a glance.
    // 无详情行时副标题显示类型；图标一眼传达同样的信息。
    const subtitle = detailLineOf(detail, detailTitle, t) ?? typeLabel
    return (
        <div className={css.nodeShell}>
            <button
                type="button"
                data-flow-node-card={node.id}
                data-node-tone={visual.tone}
                className={[css.nodeCard, toneClass(visual.tone), selected ? css.nodeCardSelected : ''].filter(Boolean).join(' ')}
                aria-pressed={selected}
                aria-label={`${node.display.label} · ${typeLabel} · ${t(visual.labelKey)}`}
                title={`${node.display.label} · ${t(visual.labelKey)}`}
                onClick={() => { onSelect(node.id) }}
            >
                <span className={css.nodeRail} data-node-rail aria-hidden="true" />
                <span className={css.nodeIcon} title={typeLabel} aria-hidden="true">
                    <NodeGlyph type={node.type} />
                </span>
                <NodeCardBody
                    node={node} labelKey={visual.labelKey} subtitle={subtitle}
                    subtitleTitle={detailTitle ?? typeLabel} pendingApproval={pendingApproval} t={t}
                />
            </button>
        </div>
    )
}

/** Keep the owner-props type on the public face for extension authors. */
export type { FlowCanvasNodeOwnerProps }
