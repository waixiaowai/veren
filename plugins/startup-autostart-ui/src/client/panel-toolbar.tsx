/**
 * The startup page's toolbar: search input, filter segment, sort picker and
 * the "new item" button.
 *
 * 启动页工具条：搜索框、筛选段、排序选择器与「新建启动项」按钮。
 *
 * @module @veren/startup-autostart/client/panel-toolbar
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SORT_KEYS } from './panel-view.ts'
import type { Filter, Sort, SortKey } from './panel-view.ts'

/** The localized text resolver face the subcomponents consume. */
type Text = PropsLocale<'startup.panel'>['t']

/** Props of {@link PanelToolbar}: the view-state face it reads and writes. */
export interface PanelToolbarProps {
  /** Current search text. */
  readonly search: string
  /** Replace the search text. */
  readonly onSearch: (value: string) => void
  /** Current list filter. */
  readonly filter: Filter
  /** Replace the list filter. */
  readonly onFilter: (filter: Filter) => void
  /** Current sort selection. */
  readonly sort: Sort
  /** Change the sort field, keeping the direction. */
  readonly onSortKey: (key: SortKey) => void
  /** Flip the sort direction, keeping the field. */
  readonly onSortDirection: () => void
  /** Open a session where the model registers a new item. */
  readonly onNew: () => void
  /** Localized text resolver. */
  readonly t: Text
}

/** 搜索、筛选与排序工具条。The search, filter and sort toolbar. */
export function PanelToolbar(props: PanelToolbarProps): React.ReactElement {
  const { search, onSearch, filter, onFilter, sort, onSortKey, onSortDirection, onNew, t } = props
  return (
    <div className="sa-toolbar">
      <input className="sa-input" type="search" value={search} placeholder={t('panel.search')}
        aria-label={t('panel.search')} onChange={event => { onSearch(event.target.value) }} />
      <div className="sa-seg" role="group" aria-label={t('panel.filter.all')}>
        {(['all', 'enabled', 'disabled'] as const).map(key => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => { onFilter(key) }}>
            {t(`panel.filter.${key}`)}
          </button>
        ))}
      </div>
      <select className="sa-input sa-sort" value={sort.key} aria-label={t('panel.sort')}
        onChange={event => { onSortKey(event.target.value as SortKey) }}>
        {SORT_KEYS.map(key => <option key={key} value={key}>{t(`panel.sort.${key}`)}</option>)}
      </select>
      <button type="button" className="sa-btn" aria-label={t('panel.sort')} onClick={onSortDirection}>
        {t(sort.asc ? 'panel.sort.asc' : 'panel.sort.desc')}
      </button>
      <button type="button" className="sa-btn sa-btn-primary" onClick={onNew}>{t('panel.new')}</button>
    </div>
  )
}
