/**
 * 页面实例记录与索引契约（§3.5）。
 * The page-instance record and index contract (§3.5).
 *
 * @module @veren/prompt-page/page-instance
 */
import type { AppIdString, PageInstanceKey } from './page-url.ts'

/**
 * 页面实例状态（§3.5.2）/ instance states:
 * - `reserved`：两阶段创建中（会话尚未建成，崩溃遗迹可清扫）；
 *   in the two-phase create (session not built yet; crash remnants sweepable);
 * - `live`：该 URL 当前的活会话；一个 URL 同一时刻至多一行 live；
 *   the url's one current live session (at most one live row per url);
 * - `deprecated`：被"重开同 URL"取代的历史会话行；仍可读，但不再通过 URL
 *   访问、不再挂页面工具、租约已释放。/ a historical session superseded by a
 *   fresh open of the same url; still readable, but never addressed via the
 *   url again, its page tools stripped and its task leases released.
 */
export type PageInstanceState = 'reserved' | 'live' | 'deprecated'

/** 一条页面实例记录 / one page-instance record */
export interface PageInstanceRecord {
  /** 规范 URL（主键，唯一）/ canonical url (unique) */
  readonly url: PageInstanceKey
  readonly state: PageInstanceState
  readonly appId: AppIdString
  /** 页面键：`appId/pageName` / page key */
  readonly page: string
  /** 对应的 DSH 会话（唯一）/ bound session id (unique) */
  readonly sessionId: string
  /** 会话列表里展示的实例标题 / instance title shown in session lists */
  readonly instanceTitle: string
  /** 参数快照 / params snapshot */
  readonly params: Readonly<Record<string, string>>
  /** 创建时的应用版本 / app version at creation */
  readonly appVersion: string
  readonly createdAt: string
  readonly lastOpenedAt: string
  /** 废弃时间（仅 `state = deprecated` 的历史行携带）/ deprecation time (deprecated history rows only) */
  readonly deprecatedAt?: string
}

/**
 * 页面实例索引（§3.5）：规范 URL → "当前活会话" 指针 + 历史废弃行。
 * 打开 URL 一律新建会话（用户决策，§9.1）：索引不再是"身份找回"，只回答
 * "这个 URL 现在哪条会话是活的、历史上哪些已废弃"。
 * 两阶段创建保留：崩溃中的创建最多留下 reserved 行（可清扫），不会把一条
 * 没建成的会话写成 live 指针或废弃历史。
 * The instance index (§3.5): canonical url → the current live session, plus
 * deprecated history rows. Opening a url ALWAYS creates a fresh session (user
 * decision, §9.1): the index no longer "recovers identity", it only records
 * which session is live on a url and which history rows were deprecated.
 * The two-phase create stays: a crash mid-creation leaves at most a reserved
 * row (sweepable); a half-built session never becomes a live pointer or a
 * deprecated history row.
 */
export interface PageInstanceIndex {
  /** 查规范 URL 当前指向的实例（deprecated 行不在此列，走 history 行）/ the url's current row */
  lookup(url: PageInstanceKey): Promise<PageInstanceRecord | undefined>
  /** 写 reserved 行（两阶段第一步）/ write a reserved row */
  reserve(url: PageInstanceKey, sessionId: string, snapshot: InstanceSnapshot): Promise<PageInstanceRecord>
  /** reserved → live（两阶段第二步）/ flip a reserved row to live */
  commit(url: PageInstanceKey, sessionId: string): Promise<PageInstanceRecord>
  /**
   * 把当前行标废弃并挪进历史（键 `deprecated:<sessionId>`），腾出 URL；
   * 返回废弃行，无行时返回 undefined。/ deprecate the current row into history
   * (key `deprecated:<sessionId>`), freeing the url; returns the deprecated row
   * or undefined when absent.
   */
  deprecate(url: PageInstanceKey, reason: string): Promise<PageInstanceRecord | undefined>
  /** 创建失败：删除 reserved 行，不留幽灵索引 / creation failed: drop the reserved row */
  fail(url: PageInstanceKey, reason: string): Promise<void>
  /** 会话已被删除：忘记这一行（下次打开重建）/ session gone: forget the row */
  forget(url: PageInstanceKey): Promise<void>
  /** 按应用列实例（含废弃历史；分组/卸载清理用）/ list instances of one app (history included) */
  listByApp(appId: AppIdString): Promise<readonly PageInstanceRecord[]>
  /**
   * 启动清扫：删掉会话已不在的 reserved 残留行，返回被删 URL（§3.5.3/§7.5）。
   * 没有会话存活探测能力时返回空数组（确认不了就不删，不假装做了）。
   * Startup sweep: drop reserved rows whose session is gone; without a
   * liveness probe it drops nothing (no confirmation, no pretend).
   */
  sweepReserved(): Promise<readonly PageInstanceKey[]>
}

/** reserve 时的快照入参 / snapshot accepted by reserve() */
export interface InstanceSnapshot {
  readonly appId: AppIdString
  readonly page: string
  readonly instanceTitle: string
  readonly params: Readonly<Record<string, string>>
  readonly appVersion: string
}
