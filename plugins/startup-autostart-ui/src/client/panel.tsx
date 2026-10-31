/**
 * The global startup-item page: search, filter, sort, list, and an edit drawer.
 *
 * The page reads one catalog snapshot from the injected observable and holds
 * only view state locally (query, filter, sort, the item being edited). The
 * edit form is hidden by default: an "edit" button on a row opens it as a
 * right-side drawer, and closing the drawer discards nothing but the view.
 * It never subscribes on its own: the observable arrives through the
 * framework's `useCatalog` hook, and every mutation goes back through an
 * injected callback that reaches the Remote namespace.
 *
 * 全局启动项页面：搜索、筛选、排序、列表与编辑抽屉。页面从注入的可观察对象读取一份
 * 目录快照，本地只持有视图状态（查询、筛选、排序、正在编辑的项）。编辑表单默认隐藏：
 * 行上的「编辑」按钮以右侧抽屉形式打开它，关闭抽屉只收起视图。它自己不做订阅：可观
 * 察对象通过框架的 `useCatalog` 钩子到达，所有写入都经注入回调回到 Remote 命名空间。
 *
 * 组合拆分：视图状态与行集派生在 panel-view.ts，列表区在 panel-list.tsx，
 * 工具条在 panel-toolbar.tsx，编辑抽屉在 panel-drawer.tsx；本文件只保留页面
 * 组合与注入面的装配。
 * Composition split: view state and the row derivation live in panel-view.ts,
 * the list area in panel-list.tsx, the toolbar in panel-toolbar.tsx, and the
 * edit drawer in panel-drawer.tsx; this file keeps only the page composition
 * and the injected-face assembly.
 *
 * @module @veren/startup-autostart/client/panel
 */

import { useMemo } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupChoicesSnapshot } from './choices.ts'
import type { StartupCatalogSnapshot } from './catalog.ts'
import type { StartupDetailActions } from './detail.tsx'
import { EditDrawer } from './panel-drawer.tsx'
import { PanelList } from './panel-list.tsx'
import { PanelToolbar } from './panel-toolbar.tsx'
import { usePanelViewState } from './panel-view.ts'

/** Catalog, creation entry, and item actions injected into the page. */
export interface StartupPanelInjected extends StartupDetailActions {
  /** The item catalog observable and its read state. */
  readonly hooks: { readonly catalog: HostObservable<StartupCatalogSnapshot>; readonly choices: HostObservable<StartupChoicesSnapshot> }
  /** Re-read the catalog after a failed read. */
  readonly onRetry: () => void
  /** Open a session where the model registers a new item. */
  readonly onNew: () => void
}

/** Props of {@link StartupPanel}, derived from the framework shares. */
export type StartupPanelProps = PropsRuntime<'main'>
  & InjectFace<StartupPanelInjected>
  & PropsLocale<'startup.panel'>

/**
 * Render the startup-item management page.
 * @param props - framework runtime share, injected catalog and actions, localized copy.
 * @returns the searchable, sortable list with an edit drawer on demand.
 */
export function StartupPanel(props: StartupPanelProps): React.ReactElement {
  const { useCatalog, useChoices, useWorkspaces, onRetry, onNew, onUpdate, onDelete, onRun, t } = props
  const catalog = useCatalog(snapshot => snapshot)
  const choices = useChoices(snapshot => snapshot)
  const workspaces = useWorkspaces(state => state)
  const view = usePanelViewState(catalog)
  const workspaceOptions = useMemo(() => workspaces.items.map(workspace => ({ value: workspace.workspaceId, label: workspace.title })), [workspaces.items])

  return (
    <section className="sa-page" aria-label={t('panel.title')}>
      <header className="sa-head">
        <h2 className="sa-title">{t('panel.title')}</h2>
        <p className="sa-subtitle">{t('panel.subtitle')}</p>
      </header>
      <PanelToolbar search={view.search} onSearch={view.setSearch} filter={view.filter} onFilter={view.setFilter}
        sort={view.sort} onSortKey={view.setSortKey} onSortDirection={view.toggleSortDirection}
        onNew={onNew} t={t} />
      {catalog.status === 'error' && <p className="sa-note-bad" role="alert">{t('panel.error')} <button type="button" className="sa-btn" onClick={onRetry}>{t('panel.retry')}</button></p>}
      <div className="sa-body">
        <PanelList catalog={catalog} rows={view.rows} t={t}
          onToggle={(item, enabled) => { void onUpdate({ id: item.id, enabled }) }} onEdit={view.openDrawer} />
      </div>
      {/* The edit drawer: rendered only while an item is being edited. 编辑抽屉：仅在编辑某个启动项时渲染。 */}
      {view.editing !== undefined && (
        <EditDrawer item={view.editing} t={t} workspaces={workspaceOptions} choices={choices}
          onUpdate={onUpdate} onDelete={onDelete} onRun={onRun} onClose={view.closeDrawer} />
      )}
    </section>
  )
}
