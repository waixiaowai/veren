/**
 * Menu ordering and node projection.
 *
 * Ordering is grouped, not global: entries render as contiguous runs per
 * `group`, groups appear in the order their first member was registered, and
 * members sort by `order` then id. That keeps a module's entries together even
 * when another module contributes a smaller `order`.
 *
 * 菜单排序与节点投影。排序按组而非全局：条目按 `group` 形成连续段，组的顺序取其首个成员
 * 的注册顺序，组内按 `order` 再按 id 排序。这样即使别的模块贡献了更小的 `order`，一个模块
 * 的条目仍然保持相邻。
 *
 * @module @veren/admin-navigation-default/order
 */

import type { AdminNavContribution, AdminNavNode } from '@veren/admin-contract'

/**
 * Arrange contributions into render order.
 *
 * @param items - admitted contributions in registration order 已准入的贡献项，按注册顺序
 * @returns contributions grouped by first appearance and sorted inside groups 按首次出现分组、组内已排序的贡献项
 */
export function arrange(items: readonly AdminNavContribution[]): readonly AdminNavContribution[] {
  const groups = new Map<string, AdminNavContribution[]>()
  for (const item of items) {
    const key = item.group ?? ''
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [item])
    else bucket.push(item)
  }
  return [...groups.values()].flatMap((bucket) => sortGroup(bucket))
}

/**
 * Sort one group by order, then by id for a deterministic tie-break.
 *
 * @param items - members of one group 同一组的成员
 * @returns the sorted copy 排好序的副本
 */
function sortGroup(items: readonly AdminNavContribution[]): readonly AdminNavContribution[] {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
}

/**
 * Project one contribution into a rendered node.
 *
 * `badge` is deliberately omitted: badge counts belong to the module that owns
 * them, and this provider has no data to compute one.
 *
 * 把一条贡献投影为渲染节点。刻意省略 `badge`：角标计数属于拥有它的模块，本 provider 没有
 * 可计算角标的数据。
 *
 * @param item - admitted contribution 已准入的贡献项
 * @returns the navigation node 导航节点
 */
export function toNode(item: AdminNavContribution): AdminNavNode {
  return {
    id: item.id,
    labelKey: item.labelKey,
    path: item.path,
    ...(item.icon === undefined ? {} : { icon: item.icon }),
    ...(item.permission === undefined ? {} : { permission: item.permission }),
  }
}
