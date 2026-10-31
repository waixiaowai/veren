/**
 * The `navigation` capability: menu contributions and the resolved menu.
 *
 * `navigation` 能力：菜单贡献与解析后的菜单。
 *
 * @module @veren/admin-contract/navigation
 */

import type { HealthReport } from './index.ts'
import type { AuthenticatedPrincipal } from './identity.ts'

/** One menu entry contributed by a module. 模块贡献的单条菜单项。 */
export interface AdminNavContribution {
  /** Unique contribution id. 唯一贡献 id。 */
  readonly id: string
  /** Locale key of the label. 标签的 i18n key。 */
  readonly labelKey: string
  /** SPA path. SPA 路径。 */
  readonly path: string
  /** Icon name resolved by the icon pack. 图标包解析的图标名。 */
  readonly icon?: string
  /** Permission required to see it. 可见所需权限。 */
  readonly permission?: string
  /** Grouping key; entries in one group render together. 分组键；同组条目一起渲染。 */
  readonly group?: string
  /** Sort order inside the group. 组内排序值。 */
  readonly order?: number
}

/** One rendered navigation node. 渲染出的导航节点。 */
export interface AdminNavNode {
  /** Source contribution id. 来源贡献 id。 */
  readonly id: string
  /** Locale key of the label. 标签的 i18n key。 */
  readonly labelKey: string
  /** SPA path. SPA 路径。 */
  readonly path: string
  /** Icon name. 图标名。 */
  readonly icon?: string
  /** Permission that admitted this node. 允许该节点的权限。 */
  readonly permission?: string
  /** Badge count, when the owning module has one. 所属模块有计数时的角标数字。 */
  readonly badge?: number
}

/** The `navigation` capability. `navigation` 能力。 */
export interface AdminNavigation {
  /**
   * Contribute one menu entry.
   * @param item - the contribution 贡献项
   * @returns the disposer removing it 移除它的 disposer
   */
  register(item: AdminNavContribution): () => void

  /**
   * Resolve the visible menu for one principal.
   * @param principal - the authenticated principal 已认证主体
   * @returns admitted nodes in render order 按渲染顺序的可见节点
   */
  tree(principal: AuthenticatedPrincipal): Promise<readonly AdminNavNode[]>

  /**
   * Probe the provider.
   * @returns the health verdict 健康结论
   */
  health?(): Promise<HealthReport>
}
