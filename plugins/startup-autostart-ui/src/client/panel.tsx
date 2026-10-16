/**
 * The global startup-item page: search, filter, list, and the selected detail.
 *
 * The page reads one catalog snapshot from the injected observable and holds
 * only view state locally (query, filter, selection). It never subscribes on
 * its own: the observable arrives through the framework's `useCatalog` hook,
 * and every mutation goes back through an injected callback that reaches the
 * Remote namespace.
 *
 * 全局启动项页面：搜索、筛选、列表与选中项的详情。页面从注入的可观察对象读取一份目录
 * 快照，本地只持有视图状态（查询、筛选、选中）。它自己不做订阅：可观察对象通过框架的
 * `useCatalog` 钩子到达，所有写入都经注入回调回到 Remote 命名空间。
 *
 * @module @veren/startup-autostart/client/panel
 */

import { useMemo, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupCatalogSnapshot } from './catalog.ts'
import { StartupDetail, type StartupDetailActions } from './detail.tsx'
import type { StartupItemView } from './remote.ts'

/** Catalog, creation entry, and item actions injected into the page. */
export interface StartupPanelInjected extends StartupDetailActions {
  /** The item catalog observable and its read state. */
  readonly hooks: { readonly catalog: HostObservable<StartupCatalogSnapshot> }
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
  readonly selected: boolean
  readonly t: PropsLocale<'startup.panel'>['t']
  readonly onSelect: () => void
  readonly onToggle: (enabled: boolean) => void
}): React.ReactElement {
  const { item, selected, t, onSelect, onToggle } = props
  const outcome = item.lastOutcome
  return (
    <li className="sa-row" aria-current={selected}>
      <input className="sa-switch" type="checkbox" checked={item.enabled}
        aria-label={t(item.enabled ? 'panel.toggle.on' : 'panel.toggle.off', { name: item.name })}
        onChange={event => { onToggle(event.target.checked) }} />
      <button type="button" className="sa-row-main" aria-label={t('panel.select', { name: item.name })} onClick={onSelect}>
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
      </button>
    </li>
  )
}

/**
 * Render the startup-item management page.
 * @param props - framework runtime share, injected catalog and actions, localized copy.
 * @returns the searchable list beside the selected item's detail.
 */
export function StartupPanel(props: StartupPanelProps): React.ReactElement {
  const { useCatalog, onRetry, onNew, onUpdate, onDelete, onRun, t } = props
  const catalog = useCatalog(snapshot => snapshot)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return catalog.records.filter(item => (
      (filter === 'all' || item.enabled === (filter === 'enabled'))
      && (query === ''
        || item.name.toLowerCase().includes(query)
        || (item.message ?? '').toLowerCase().includes(query)
        || (item.sessionId ?? '').toLowerCase().includes(query))
    ))
  }, [catalog.records, search, filter])

  // A selection survives a refresh and falls back to the first visible row, so
  // the detail pane never shows an item the current filter hides.
  const selected = rows.find(item => item.id === selectedId) ?? rows[0]

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
              <Row key={item.id} item={item} selected={selected?.id === item.id} t={t}
                onSelect={() => { setSelectedId(item.id) }}
                onToggle={enabled => { void onUpdate({ id: item.id, enabled }) }} />
            ))}
          </ul>
        </div>
        <div className="sa-detail-wrap">
          {selected === undefined
            ? <p className="sa-hint">{t('panel.empty')}</p>
            : <StartupDetail key={selected.id} item={selected} t={t}
              onUpdate={onUpdate} onDelete={onDelete} onRun={onRun} />}
        </div>
      </div>
    </section>
  )
}
