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
 * @module @veren/startup-autostart/client/panel
 */

import { useMemo, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupChoicesSnapshot } from './choices.ts'
import type { StartupCatalogSnapshot } from './catalog.ts'
import { StartupDetail, type StartupDetailActions } from './detail.tsx'
import type { StartupItemView } from './remote.ts'

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

/** The three list filters. */
type Filter = 'all' | 'enabled' | 'disabled'

/** The field a sort orders by. */
type SortKey = 'name' | 'lastRunAt' | 'runCount' | 'createdAt'

/** A sort selection: field plus direction. */
interface Sort { readonly key: SortKey; readonly asc: boolean }

/** The sort dropdown's choices, in display order. */
const SORT_KEYS: readonly SortKey[] = ['name', 'createdAt', 'lastRunAt', 'runCount']

/** Collate two strings by locale-aware order. */
function byText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

/**
 * Compare two items under one sort selection; items without the field sink.
 * @param a - the left item.
 * @param b - the right item.
 * @param sort - the active sort.
 * @returns a negative number when `a` sorts before `b`.
 */
function compareItems(a: StartupItemView, b: StartupItemView, sort: Sort): number {
  const flip = sort.asc ? 1 : -1
  switch (sort.key) {
    case 'name': return flip * byText(a.name, b.name)
    case 'createdAt': return flip * byText(a.createdAt, b.createdAt)
    case 'lastRunAt': return flip * byText(a.lastRunAt ?? '', b.lastRunAt ?? '')
    case 'runCount': return flip * (a.runCount - b.runCount)
  }
}

/**
 * One row's target summary: the first target field this action actually uses.
 * @param item - the item to describe.
 * @param t - localized text resolver.
 * @returns the summary line shown under the item's name.
 */
function targetSummary(item: StartupItemView, t: PropsLocale<'startup.panel'>['t']): string {
  if (item.action === 'new_session') {
    if (item.cwd !== undefined) return t('panel.target.cwd', { value: item.cwd })
    if (item.workspaceId !== undefined) return t('panel.target.workspace', { value: item.workspaceId })
    return t('panel.target.none')
  }
  if (item.sessionId === undefined) return t('panel.target.none')
  return t('panel.target.session', { value: item.sessionId })
}

/** One item's row in the list. */
function Row(props: {
  readonly item: StartupItemView
  readonly t: PropsLocale<'startup.panel'>['t']
  readonly onToggle: (enabled: boolean) => void
  readonly onEdit: () => void
}): React.ReactElement {
  const { item, t, onToggle, onEdit } = props
  const outcome = item.lastOutcome
  return (
    <li className="sa-row" aria-current={undefined}>
      <input className="sa-switch" type="checkbox" checked={item.enabled}
        aria-label={t(item.enabled ? 'panel.toggle.on' : 'panel.toggle.off', { name: item.name })}
        onChange={event => { onToggle(event.target.checked) }} />
      <div className="sa-row-main">
        <span className="sa-row-name">{item.name}</span>
        <span className="sa-row-meta">
          <span className="sa-badge">{t(`panel.action.${item.action}`)}</span>
          {' '}{targetSummary(item, t)}
        </span>
        <span className="sa-row-meta">
          {t('panel.run.count', { count: item.runCount })}
          {' · '}
          {outcome === undefined
            ? t('panel.run.never')
            : <span className={outcome.status === 'ok' ? 'sa-badge sa-badge-ok' : 'sa-badge sa-badge-bad'}>
              {t(outcome.status === 'ok' ? 'panel.run.ok' : 'panel.run.failed')}
            </span>}
          {item.lastRunAt === undefined ? '' : ` · ${item.lastRunAt}`}
        </span>
      </div>
      {/* The form stays hidden until this button opens the edit drawer. */}
      {/* 表单默认隐藏，由本按钮打开编辑抽屉。 */}
      <button type="button" className="sa-btn sa-row-edit" aria-label={t('panel.edit', { name: item.name })}
        onClick={onEdit}>{t('panel.edit.short')}</button>
    </li>
  )
}

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
  const workspaceOptions = useMemo(() => workspaces.items.map(workspace => ({
    value: workspace.workspaceId,
    label: workspace.title,
  })), [workspaces.items])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>({ key: 'name', asc: true })
  // The id whose edit drawer is open; `undefined` means no form on screen.
  // 打开着编辑抽屉的 id；undefined 表示屏幕上没有表单。
  const [editingId, setEditingId] = useState<string | undefined>(undefined)

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return catalog.records
      .filter(item => (
        (filter === 'all' || item.enabled === (filter === 'enabled'))
        && (query === ''
          || item.name.toLowerCase().includes(query)
          || (item.message ?? '').toLowerCase().includes(query)
          || (item.sessionId ?? '').toLowerCase().includes(query))
      ))
      .sort((a, b) => compareItems(a, b, sort))
  }, [catalog.records, search, filter, sort])

  const editing = catalog.records.find(item => item.id === editingId)
  const closeDrawer = (): void => { setEditingId(undefined) }

  return (
    <section className="sa-page" aria-label={t('panel.title')}>
      <header className="sa-head">
        <h2 className="sa-title">{t('panel.title')}</h2>
        <p className="sa-subtitle">{t('panel.subtitle')}</p>
      </header>
      <div className="sa-toolbar">
        <input className="sa-input" type="search" value={search} placeholder={t('panel.search')}
          aria-label={t('panel.search')} onChange={event => { setSearch(event.target.value) }} />
        <div className="sa-seg" role="group" aria-label={t('panel.filter.all')}>
          {(['all', 'enabled', 'disabled'] as const).map(key => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key) }}>
              {t(`panel.filter.${key}`)}
            </button>
          ))}
        </div>
        <select className="sa-input sa-sort" value={sort.key} aria-label={t('panel.sort')}
          onChange={event => { setSort(current => ({ ...current, key: event.target.value as SortKey })) }}>
          {SORT_KEYS.map(key => <option key={key} value={key}>{t(`panel.sort.${key}`)}</option>)}
        </select>
        <button type="button" className="sa-btn" aria-label={t('panel.sort')}
          onClick={() => { setSort(current => ({ ...current, asc: !current.asc })) }}>
          {t(sort.asc ? 'panel.sort.asc' : 'panel.sort.desc')}
        </button>
        <button type="button" className="sa-btn sa-btn-primary" onClick={onNew}>{t('panel.new')}</button>
      </div>
      {catalog.status === 'error' && (
        <p className="sa-note-bad" role="alert">
          {t('panel.error')} <button type="button" className="sa-btn" onClick={onRetry}>{t('panel.retry')}</button>
        </p>
      )}
      <div className="sa-body">
        <div className="sa-list-wrap">
          {catalog.status === 'loading' && !catalog.settled && <p className="sa-empty">{t('panel.loading')}</p>}
          {catalog.settled && rows.length === 0 && (
            <div className="sa-empty">
              <p>{catalog.records.length === 0 ? t('panel.empty') : t('panel.emptyFiltered')}</p>
              <p className="sa-hint">{t('panel.newHint')}</p>
            </div>
          )}
          <ul className="sa-list">
            {rows.map(item => (
              <Row key={item.id} item={item} t={t}
                onToggle={enabled => { void onUpdate({ id: item.id, enabled }) }}
                onEdit={() => { setEditingId(item.id) }} />
            ))}
          </ul>
        </div>
      </div>
      {/* The edit drawer: rendered only while an item is being edited. */}
      {/* 编辑抽屉：仅在编辑某个启动项时渲染。 */}
      {editing !== undefined && (
        <div className="sa-drawer-veil" onClick={closeDrawer}>
          <aside className="sa-drawer" role="dialog" aria-label={t('panel.detail.title')}
            onClick={event => { event.stopPropagation() }}>
            <header className="sa-drawer-head">
              <span className="sa-detail-title">{t('panel.detail.title')}</span>
              <button type="button" className="sa-btn" aria-label={t('panel.detail.close')}
                onClick={closeDrawer}>{t('panel.detail.close.short')}</button>
            </header>
            <div className="sa-drawer-body">
              <StartupDetail key={editing.id} item={editing} t={t}
                workspaces={workspaceOptions} choices={choices}
                onUpdate={onUpdate} onDelete={onDelete} onRun={onRun} />
            </div>
          </aside>
        </div>
      )}
    </section>
  )
}
