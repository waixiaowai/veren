/**
 * Custom renderer for the `echo` node type.
 *
 * It receives the panel's node-slot owner props and proves the extension point:
 * the card looks deliberately different from the default one, so a screenshot
 * shows which renderer is active. Unmounting this plugin falls back to the
 * panel's default card.
 *
 * `echo` 节点类型的自定义渲染器。它接收面板的节点槽位 owner props，用来证明扩展点：
 * 卡片刻意与默认卡片不同，截图一眼能看出当前生效的渲染器。卸载插件后回落到面板默认卡片。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-node-echo/client/EchoNode
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CanvasNodeRuntime } from '@deepseek-ai/dsh-graph-flow-canvas'
import type {} from '@deepseek-ai/dsh-graph-flow-canvas-panel/client'
import { NS, type EchoKey } from './locales.ts'
import css from './echo.module.css'

/** Props of the echo card: the node slot's owner currency plus this plugin's locale. */
export type EchoNodeProps = PropsRuntime<'flow.canvas.node'> & PropsLocale<typeof NS>

/** Status value → locale key. */
const STATUS_KEYS: Record<CanvasNodeRuntime['status'], EchoKey> = {
    pending: 'status.pending',
    ready: 'status.ready',
    running: 'status.running',
    'awaiting-approval': 'status.awaiting',
    completed: 'status.completed',
    failed: 'status.failed',
    skipped: 'status.skipped',
    cancelled: 'status.cancelled',
}

/** Status value → tone class (CSS modules may type a missing class as undefined). */
const TONE_CLASSES: Record<CanvasNodeRuntime['status'], string | undefined> = {
    pending: '',
    ready: css.ready,
    running: css.running,
    'awaiting-approval': css.awaiting,
    completed: css.completed,
    failed: css.failed,
    skipped: css.skipped,
    cancelled: css.cancelled,
}

/**
 * Render the custom echo card.
 * @param props - node, runtime record, selection, select callback and translator.
 * @returns the custom card.
 */
export function EchoNode({ node, runtime, selected, onSelect, t }: EchoNodeProps) {
    const status = runtime?.status ?? 'pending'
    const recovered = runtime?.recovered !== undefined
    const tone = recovered ? css.recovered : TONE_CLASSES[status]
    return (
        <button
            type="button"
            data-flow-node-card={node.id}
            data-node-tone={recovered ? 'recovered' : status}
            className={[css.card, selected ? css.selected : '', tone].filter(Boolean).join(' ')}
            aria-pressed={selected}
            aria-label={`${node.display.label} · ${node.display.subtitle} · ${t(recovered ? 'status.recovered' : STATUS_KEYS[status])}`}
            title={`${node.display.label} · ${node.display.subtitle}`}
            onClick={() => { onSelect(node.id) }}
        >
            <span className={css.icon} aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 5.6h6.4a3.1 3.1 0 0 1 0 6.2H6.4" />
                    <path d="M5.4 3.2 3 5.6l2.4 2.4" />
                </svg>
            </span>
            <span className={css.body}>
                <span className={css.titleRow}>
                    <span className={css.label} title={node.display.label}>{node.display.label}</span>
                    <span className={css.status}>
                        <span className={css.statusDot} aria-hidden="true" />
                        {t(recovered ? 'status.recovered' : STATUS_KEYS[status])}
                    </span>
                </span>
                <span className={css.metaRow}>
                    <span className={css.badge}>{t('badge')}</span>
                </span>
            </span>
        </button>
    )
}
