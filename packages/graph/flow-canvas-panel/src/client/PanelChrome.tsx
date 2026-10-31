/**
 * Page chrome of the canvas panel: the header (title, flow selector, run
 * controls) and the edge legend footer. Pure presentation; every fact arrives
 * as a prop so the page component stays a small composer.
 *
 * 画布面板的页面框架：顶栏（标题、flow 选择器、运行控件）与图例页脚。纯展示组件，
 * 全部事实经 props 传入，让页面组件保持为小的组合器。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/PanelChrome
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { flowLabel } from './present.ts'
import type { FlowCanvasViewState } from './store.ts'
import css from './panel.module.css'

/** Props of the flow selector. */
interface FlowSelectProps {
    readonly flows: FlowCanvasViewState['flows']
    readonly flowId: string | undefined
    readonly onSelectFlow: (flowId: string) => void
    readonly t: TranslateNS<'flowCanvas'>
}

/** The registered-flow `<select>`; shows the empty hint when nothing is registered. */
function FlowSelect({ flows, flowId, onSelectFlow, t }: FlowSelectProps) {
    return (
        <>
            <label className={css.fieldLabel} htmlFor="flow-canvas-select">{t('panel.flow')}</label>
            <select
                id="flow-canvas-select"
                className={css.select}
                value={flowId ?? ''}
                disabled={flows.length === 0}
                onChange={(event) => { onSelectFlow(event.target.value) }}
            >
                {flows.length === 0
                    ? <option value="">{t('panel.emptyFlows')}</option>
                    : flows.map(entry => (
                        <option key={entry.id} value={entry.id} title={entry.id}>
                            {flowLabel(entry.id, t)}
                        </option>
                    ))}
            </select>
        </>
    )
}

/** Props of the run/cancel button. */
interface RunButtonProps {
    readonly running: boolean
    readonly canRun: boolean
    readonly hasRun: boolean
    readonly onRun: () => void
    readonly onCancelRun: () => void
    readonly t: TranslateNS<'flowCanvas'>
}

/** Start (or re-run) the selected flow; while running it becomes a cancel button. */
function RunButton({ running, canRun, hasRun, onRun, onCancelRun, t }: RunButtonProps) {
    if (running) {
        return (
            <button type="button" className={`${css.button} ${css.danger}`} onClick={onCancelRun}>
                <span aria-hidden="true">■</span>
                {t('panel.cancel')}
            </button>
        )
    }
    return (
        <button
            type="button"
            className={`${css.button} ${css.primary}`}
            disabled={!canRun}
            onClick={onRun}
        >
            <span aria-hidden="true">▶</span>
            {hasRun ? t('panel.rerun') : t('panel.run')}
        </button>
    )
}

/** Props of the refresh button. */
interface RefreshButtonProps {
    readonly onRefresh: () => void
    readonly t: TranslateNS<'flowCanvas'>
}

/** Re-read the flow list. */
function RefreshButton({ onRefresh, t }: RefreshButtonProps) {
    return (
        <button
            type="button"
            className={`${css.button} ${css.ghost}`}
            title={t('panel.refreshHint')}
            onClick={onRefresh}
        >
            <span aria-hidden="true">↻</span>
            {t('panel.refresh')}
        </button>
    )
}

/** Props of the page header. */
export interface PanelHeaderProps {
    readonly flows: FlowCanvasViewState['flows']
    readonly flowId: string | undefined
    readonly running: boolean
    readonly canRun: boolean
    readonly hasRun: boolean
    readonly onSelectFlow: (flowId: string) => void
    readonly onRun: () => void
    readonly onCancelRun: () => void
    readonly onRefresh: () => void
    readonly t: TranslateNS<'flowCanvas'>
}

/** Title row plus the toolbar (flow selector, run controls, refresh). */
export function PanelHeader({
    flows, flowId, running, canRun, hasRun, onSelectFlow, onRun, onCancelRun, onRefresh, t,
}: PanelHeaderProps) {
    return (
        <header className={css.header}>
            <div className={css.titleRow}>
                <h1 className={css.title}>{t('panel.title')}</h1>
                <span className={css.subtitle}>{t('panel.subtitle')}</span>
            </div>
            <div className={css.toolbar}>
                <FlowSelect flows={flows} flowId={flowId} onSelectFlow={onSelectFlow} t={t} />
                <RunButton running={running} canRun={canRun} hasRun={hasRun} onRun={onRun} onCancelRun={onCancelRun} t={t} />
                <RefreshButton onRefresh={onRefresh} t={t} />
            </div>
        </header>
    )
}

/** Props of the legend footer. */
export interface PanelLegendProps {
    readonly t: TranslateNS<'flowCanvas'>
}

/** The edge legend: unconditional, conditional and dashed lines. */
export function PanelLegend({ t }: PanelLegendProps) {
    return (
        <footer className={css.legend}>
            <span className={css.legendHint}>{t('legend.hint')}</span>
            <span className={css.legendDivider} aria-hidden="true" />
            <strong>{t('legend.title')}</strong>
            <span className={css.legendItem}><i className={`${css.legendLine} ${css.legendAlways}`} />{t('legend.edgeAlways')}</span>
            <span className={css.legendItem}><i className={`${css.legendLine} ${css.legendConditional}`} />{t('legend.edgeConditional')}</span>
            <span className={css.legendItem}><i className={`${css.legendLine} ${css.legendDashed}`} />{t('legend.edgeDashed')}</span>
        </footer>
    )
}
