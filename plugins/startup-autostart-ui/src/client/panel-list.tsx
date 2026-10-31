/**
 * The startup page's list area: one row widget and the list with its
 * loading/empty states.
 *
 * 启动页的列表区：单行组件与带加载/空态的列表。
 *
 * @module @veren/startup-autostart/client/panel-list
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupCatalogSnapshot } from './catalog.ts'
import type { StartupItemView } from './remote.ts'

/** The localized text resolver face the subcomponents consume. */
type Text = PropsLocale<'startup.panel'>['t']

/**
 * One row's target summary: the first target field this action actually uses.
 * @param item - the item to describe.
 * @param t - localized text resolver.
 * @returns the summary line shown under the item's name.
 */
function targetSummary(item: StartupItemView, t: Text): string {
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
  readonly t: Text
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

/** Props of {@link PanelList}. */
export interface PanelListProps {
  /** The catalog snapshot the empty states read. */
  readonly catalog: StartupCatalogSnapshot
  /** The filtered, sorted rows to render. */
  readonly rows: readonly StartupItemView[]
  /** Localized text resolver. */
  readonly t: Text
  /** Toggle one item's enabled flag. */
  readonly onToggle: (item: StartupItemView, enabled: boolean) => void
  /** Open the edit drawer for one item id. */
  readonly onEdit: (id: string) => void
}

/** 列表区：加载/空态与行集合。The list area: loading/empty states and the rows. */
export function PanelList(props: PanelListProps): React.ReactElement {
  const { catalog, rows, t, onToggle, onEdit } = props
  return (
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
            onToggle={enabled => { onToggle(item, enabled) }} onEdit={() => { onEdit(item.id) }} />
        ))}
      </ul>
    </div>
  )
}
