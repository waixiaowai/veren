/**
 * The default navigation registry.
 *
 * Contributions live in an in-memory map keyed by id, so the menu is a runtime
 * composition rather than persisted data. Every registration returns an
 * idempotent disposer; a duplicate id is a programming error and fails loudly
 * instead of silently replacing another module's entry.
 *
 * 默认导航注册表。贡献项存放在以 id 为键的内存 Map 中，因此菜单是运行期组合而非持久化数据。
 * 每次注册都返回幂等 disposer；重复 id 属于编程错误，会直接失败，而不是静默替换其他模块的
 * 条目。
 *
 * @module @veren/admin-navigation-default/provider
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  AdminError,
  type AdminNavContribution,
  type AdminNavNode,
  type AdminNavigation,
  type AuthenticatedPrincipal,
  type HealthReport,
} from '@veren/admin-contract'
import { DEFAULT_NAVIGATION } from './contributions.ts'
import { arrange, toNode } from './order.ts'

/** The navigation capability implementation. 导航能力的实现。 */
export class DefaultNavigation implements AdminNavigation {
  /** Owning context, used to resolve the access façade. 所属上下文，用于解析 access façade。 */
  private readonly ctx: Context

  /** Live contributions keyed by contribution id. 按贡献 id 索引的在线贡献项。 */
  private readonly contributions = new Map<string, AdminNavContribution>()

  /**
   * @param ctx - owning context 所属上下文
   */
  constructor(ctx: Context) {
    this.ctx = ctx
    for (const item of DEFAULT_NAVIGATION) this.register(item)
  }

  /**
   * Contribute one menu entry.
   *
   * @param item - the contribution 贡献项
   * @returns an idempotent disposer removing exactly this contribution 幂等移除本条贡献的 disposer
   * @throws AdminError `CONFLICT` when the id is already taken id 已被占用时抛出
   */
  register(item: AdminNavContribution): () => void {
    if (this.contributions.has(item.id)) {
      throw new AdminError('CONFLICT', `navigation contribution '${item.id}' is already registered`, { id: item.id })
    }
    this.contributions.set(item.id, item)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      // A stale disposer must not remove a newer contribution that reused the id.
      // 过期的 disposer 不得移除复用了同一 id 的新贡献。
      if (this.contributions.get(item.id) === item) this.contributions.delete(item.id)
    }
  }

  /**
   * Resolve the menu visible to one principal.
   *
   * Permission filtering happens before ordering, so gaps never appear in the
   * rendered sequence and unauthorized entries never reach the client.
   *
   * 解析某个主体可见的菜单。权限过滤发生在排序之前，因此渲染序列不会出现空洞，未授权的条目
   * 也绝不会到达客户端。
   *
   * @param principal - the authenticated principal 已认证主体
   * @returns admitted nodes in render order 按渲染顺序的可见节点
   */
  async tree(principal: AuthenticatedPrincipal): Promise<readonly AdminNavNode[]> {
    const admitted = [...this.contributions.values()].filter((item) => this.admits(principal, item))
    return arrange(admitted).map(toNode)
  }

  /**
   * Probe the registry.
   *
   * @returns always `ok` while the map is readable 只要映射可读就返回 `ok`
   */
  async health(): Promise<HealthReport> {
    return { status: 'ok' }
  }

  /**
   * Whether one principal may see a contribution.
   *
   * @param principal - the authenticated principal 已认证主体
   * @param item - candidate contribution 候选贡献项
   * @returns true when the entry needs no permission or the principal holds it 无需权限或主体持有时为 true
   */
  private admits(principal: AuthenticatedPrincipal, item: AdminNavContribution): boolean {
    if (item.permission === undefined) return true
    return this.ctx.adminAccess.can(principal, item.permission)
  }
}
