/**
 * The startup page's view state: the filter/sort vocabulary, the row
 * derivation, and the local view-state hook.
 *
 * Pure derivation lives at module level; React glue stays inside the hook. The
 * hook holds only view state (query, filter, sort, the item being edited) -
 * the catalog itself is business data owned by the observable.
 *
 * 启动页的视图状态：筛选/排序词汇、行集派生与本地视图状态钩子。纯派生是模块级
 * 函数；React 粘合留在钩子内。钩子只持有视图状态（查询、筛选、排序、正在编辑的
 * 项）——目录本身是可观察对象持有的业务数据。
 *
 * @module @veren/startup-autostart/client/panel-view
 */

import { useMemo, useState } from 'react'
import type { StartupCatalogSnapshot } from './catalog.ts'
import type { StartupItemView } from './remote.ts'

/** The three list filters. */
export type Filter = 'all' | 'enabled' | 'disabled'

/** The field a sort orders by. */
export type SortKey = 'name' | 'lastRunAt' | 'runCount' | 'createdAt'

/** A sort selection: field plus direction. */
export interface Sort { readonly key: SortKey; readonly asc: boolean }

/** The sort dropdown's choices, in display order. */
export const SORT_KEYS: readonly SortKey[] = ['name', 'createdAt', 'lastRunAt', 'runCount']

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
export function compareItems(a: StartupItemView, b: StartupItemView, sort: Sort): number {
  const flip = sort.asc ? 1 : -1
  switch (sort.key) {
    case 'name': return flip * byText(a.name, b.name)
    case 'createdAt': return flip * byText(a.createdAt, b.createdAt)
    case 'lastRunAt': return flip * byText(a.lastRunAt ?? '', b.lastRunAt ?? '')
    case 'runCount': return flip * (a.runCount - b.runCount)
  }
}

/**
 * 过滤并排序列表行：查询匹配名称/消息/会话 id，筛选按启用态，排序按当前选择。
 * Filter and sort the list rows: the query matches name/message/session id,
 * the filter by enabled state, the sort by the active selection.
 */
export function filterRows(records: readonly StartupItemView[], search: string, filter: Filter, sort: Sort): StartupItemView[] {
  const query = search.trim().toLowerCase()
  return records
    .filter(item => (
      (filter === 'all' || item.enabled === (filter === 'enabled'))
      && (query === ''
        || item.name.toLowerCase().includes(query)
        || (item.message ?? '').toLowerCase().includes(query)
        || (item.sessionId ?? '').toLowerCase().includes(query))
    ))
    .sort((a, b) => compareItems(a, b, sort))
}

/** The panel's local view state plus the derived rows and the drawer handles. */
export interface PanelViewState {
  /** Current search text. */
  readonly search: string
  /** Replace the search text. */
  readonly setSearch: (value: string) => void
  /** Current list filter. */
  readonly filter: Filter
  /** Replace the list filter. */
  readonly setFilter: (filter: Filter) => void
  /** Current sort selection. */
  readonly sort: Sort
  /** Change the sort field, keeping the direction. */
  readonly setSortKey: (key: SortKey) => void
  /** Flip the sort direction, keeping the field. */
  readonly toggleSortDirection: () => void
  /** Filtered and sorted rows, derived on demand. */
  readonly rows: readonly StartupItemView[]
  /** The item whose edit drawer is open, or undefined. */
  readonly editing: StartupItemView | undefined
  /** Open the edit drawer for one item id. */
  readonly openDrawer: (id: string) => void
  /** Close the edit drawer, discarding only the view. */
  readonly closeDrawer: () => void
}

/**
 * The panel's local view state: query, filter, sort, and the item being edited,
 * with the derived row set. Only view state lives here - the catalog snapshot
 * arrives as an argument and is never duplicated.
 * 面板的本地视图状态：查询、筛选、排序与正在编辑的项，以及派生行集。这里只放
 * 视图状态——目录快照由参数传入，绝不在此复制。
 * @param catalog - the catalog snapshot the rows derive from.
 * @returns the view state face the page and its subcomponents consume.
 */
export function usePanelViewState(catalog: StartupCatalogSnapshot): PanelViewState {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>({ key: 'name', asc: true })
  // The id whose edit drawer is open; `undefined` means no form on screen.
  // 打开着编辑抽屉的 id；undefined 表示屏幕上没有表单。
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const rows = useMemo(() => filterRows(catalog.records, search, filter, sort), [catalog.records, search, filter, sort])
  const editing = catalog.records.find(item => item.id === editingId)
  const closeDrawer = (): void => { setEditingId(undefined) }
  return {
    search,
    setSearch,
    filter,
    setFilter,
    sort,
    setSortKey: key => { setSort(current => ({ ...current, key })) },
    toggleSortDirection: () => { setSort(current => ({ ...current, asc: !current.asc })) },
    rows,
    editing,
    openDrawer: setEditingId,
    closeDrawer,
  }
}
