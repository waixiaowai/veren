/**
 * Inner browser plugin: waits for the mounted `remote.flowCanvas` namespace,
 * owns the view store, and registers the page and its sidebar entry.
 *
 * Kept in its own module so package tests can mount the UI half without the
 * Remote contribution mount (the test runtime's `$mount` is a fail-loud double).
 *
 * 内层浏览器插件：等待已挂载的 `remote.flowCanvas` 命名空间，持有视图 store，并注册页面
 * 与侧栏入口。独立成模块，便于包测试在不挂载 Remote contribution 的情况下挂载 UI 半边
 * （测试运行时的 `$mount` 是显式失败替身）。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/panel-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './remote.ts'
import { en, NS, zh } from './locales.ts'
import { FlowCanvasPanel } from './Panel.tsx'
import type { FlowCanvasPanelInjected } from './slots.ts'
import { createFlowCanvasStore } from './store.ts'

/** Main-panel key and sidebar list id of the page. */
export const PANEL_ID = 'flow-canvas' as MainPanelId

/** The inner plugin value mounted after the Remote namespace is ready. */
export const PanelPlugin = {
    name: 'flow-canvas-panel:ui',
    inject: ['remote.flowCanvas', 'slots', 'locale'],
    /** @param ctx - panel-scope context over the mounted namespace. */
    apply(ctx: Context): void {
        const api = ctx.remote.flowCanvas
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'flow-canvas-panel: dictionaries')
        const store = createFlowCanvasStore(api)
        ctx.effect(() => () => { store.dispose() }, 'flow-canvas-panel: view store')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            children: { 'flow.canvas.node': { kind: 'keyed', scope: 'root' } },
            inject: (): FlowCanvasPanelInjected => ({
                hooks: { flow: store.source },
                onSelectFlow: store.selectFlow,
                onRun: store.startRun,
                onSelectNode: store.selectNode,
                onAnswerApproval: store.answerApproval,
                onCancelRun: store.cancelRun,
                onRefresh: store.refresh,
            }),
        }, FlowCanvasPanel))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 30,
            locale: NS,
            label: () => t('panel.title'),
        }, SideIcon))
    },
} as const

/** Sidebar entry icon: a small branching graph. */
function SideIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.5" y="6" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="10.5" y="1.5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="10.5" y="10.5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5.5 8h2.5v-4.5h2.5M8 8v4.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
    )
}
