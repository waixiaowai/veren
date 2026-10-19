/**
 * Audit query semantics: filtering, newest-first ordering, cursor paging and
 * the retention decision.
 *
 * The helpers here are pure so the provider owns only persistence and the route
 * owns only wire parsing. Cursors encode a numeric offset in base64; they are
 * opaque to clients and the encoding may change without notice.
 *
 * 审计查询语义：过滤、按时间倒序、游标分页与保留决策。这里的辅助函数是纯函数，因此
 * provider 只拥有持久化，路由只拥有线上格式解析。游标以 base64 编码数字偏移量；它对客户端
 * 不透明，编码方式可能随时变化。
 *
 * @module @veren/admin-audit-default/query
 */

import {
  AdminError,
  type AdminAuditEntry,
  type AdminAuditQuery,
} from '@veren/admin-contract'

/** Page size used when the query omits `limit`. 查询省略 `limit` 时使用的页大小。 */
export const DEFAULT_LIMIT = 50

/** Largest page size the provider serves. provider 提供的最大页大小。 */
export const MAX_LIMIT = 200

/** One page of audit entries. 一页审计记录。 */
export interface AuditPage {
  /** Entries of this page, newest first. 本页条目，最新的在前。 */
  readonly items: readonly AdminAuditEntry[]
  /** Opaque cursor for the next page, absent on the last page. 下一页的不透明游标，末页缺失。 */
  readonly nextCursor?: string
}

/** Inclusive time bounds resolved from the query. 由查询解析出的闭区间时间边界。 */
interface TimeBounds {
  /** Lower bound in epoch milliseconds. 下界（毫秒）。 */
  readonly since: number | undefined
  /** Upper bound in epoch milliseconds. 上界（毫秒）。 */
  readonly until: number | undefined
}

/**
 * Clamp the requested page size into the supported range.
 *
 * @param limit - requested page size 请求的页大小
 * @returns a page size between 1 and {@link MAX_LIMIT} 1 到 {@link MAX_LIMIT} 之间的页大小
 * @throws AdminError `VALIDATION_FAILED` when the value is not a positive integer 不是正整数时抛出
 */
export function pageLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1) {
    throw new AdminError('VALIDATION_FAILED', 'audit query limit must be a positive integer', { limit })
  }
  return Math.min(limit, MAX_LIMIT)
}

/**
 * Encode a numeric offset as an opaque cursor.
 *
 * @param offset - zero-based offset into the filtered sequence 过滤后序列的零基偏移
 * @returns the base64 cursor base64 游标
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64')
}

/**
 * Decode an opaque cursor, refusing values this provider did not produce.
 *
 * @param cursor - cursor from a previous page 上一页的游标
 * @returns the zero-based offset 零基偏移
 * @throws AdminError `VALIDATION_FAILED` when the cursor is malformed 游标格式错误时抛出
 */
export function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  const decoded = Buffer.from(cursor, 'base64').toString('utf8')
  const offset = Number(decoded)
  if (!/^\d+$/.test(decoded) || !Number.isSafeInteger(offset)) {
    throw new AdminError('VALIDATION_FAILED', 'audit cursor is not a valid page cursor', { cursor })
  }
  return offset
}

/**
 * The retention cutoff: the oldest instant still worth keeping.
 *
 * @param now - current epoch milliseconds 当前毫秒时刻
 * @param retentionDays - retention window in days 保留天数
 * @returns the cutoff as an ISO-8601 UTC instant 截止时刻的 ISO-8601 UTC 表示
 */
export function retentionCutoff(now: number, retentionDays: number): string {
  return new Date(now - retentionDays * 86_400_000).toISOString()
}

/**
 * Order two entries from oldest to newest, with the id breaking ties.
 *
 * An `at` tie is possible because several rows can share a millisecond; the id
 * keeps the total order deterministic across calls and replicas.
 *
 * 把两条记录从最早排到最新，`at` 相同时用 id 打破并列。多行可能共享同一毫秒，因此用 id
 * 让全序在多次调用与多个副本之间保持确定。
 *
 * @param a - first entry 第一条记录
 * @param b - second entry 第二条记录
 * @returns negative when `a` is older, positive when newer 负数表示 `a` 更早，正数表示更新
 */
export function compareOldestFirst(a: AdminAuditEntry, b: AdminAuditEntry): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1
  return a.id.localeCompare(b.id)
}

/**
 * Select one filtered, newest-first, cursor-addressed page.
 *
 * @param rows - every stored entry 全部已存记录
 * @param query - filter and paging 过滤与分页
 * @returns the page and its next cursor 本页及其下一页游标
 */
export function selectPage(rows: readonly AdminAuditEntry[], query: AdminAuditQuery): AuditPage {
  const limit = pageLimit(query.limit)
  const offset = decodeCursor(query.cursor)
  const bounds = timeBounds(query)
  const ordered = rows.filter((entry) => matches(entry, query, bounds)).sort(compareNewestFirst)
  const items = ordered.slice(offset, offset + limit)
  const next = offset + limit < ordered.length ? encodeCursor(offset + limit) : undefined
  return next === undefined ? { items } : { items, nextCursor: next }
}

/**
 * Decide which entries retention must drop.
 *
 * The candidates are walked oldest first, so a newer entry is never dropped
 * while an older one survives: the cap consumes a prefix of that order and the
 * cutoff is a time boundary.
 *
 * 决定保留策略要丢弃哪些条目。候选按从旧到新遍历，因此绝不会在新条目仍存活时丢弃更旧的
 * 条目：条目上限消耗该顺序的前缀，截止时间则是时间边界。
 *
 * @param rows - every stored entry 全部已存记录
 * @param maxEntries - effective entry cap 生效的条目上限
 * @param cutoff - retention cutoff, ISO-8601 UTC 保留截止时刻（ISO-8601 UTC）
 * @returns the entries to remove, oldest first 要移除的条目，最旧的在前
 */
export function selectDoomed(
  rows: readonly AdminAuditEntry[],
  maxEntries: number,
  cutoff: string,
): readonly AdminAuditEntry[] {
  const ordered = [...rows].sort(compareOldestFirst)
  const excess = Math.max(0, ordered.length - maxEntries)
  return ordered.filter((entry, index) => index < excess || entry.at < cutoff)
}

/**
 * Order two entries from newest to oldest.
 *
 * @param a - first entry 第一条记录
 * @param b - second entry 第二条记录
 * @returns negative when `a` is newer 负数表示 `a` 更新
 */
function compareNewestFirst(a: AdminAuditEntry, b: AdminAuditEntry): number {
  return compareOldestFirst(b, a)
}

/**
 * Whether one entry satisfies every supplied filter.
 *
 * @param entry - stored entry 已存记录
 * @param query - filter 过滤条件
 * @param bounds - resolved time bounds 已解析的时间边界
 * @returns true when the entry belongs in the result 记录属于结果集时为 true
 */
function matches(entry: AdminAuditEntry, query: AdminAuditQuery, bounds: TimeBounds): boolean {
  if (query.actorId !== undefined && entry.actorId !== query.actorId) return false
  if (query.action !== undefined && !entry.action.startsWith(query.action)) return false
  if (query.result !== undefined && entry.result !== query.result) return false
  const at = Date.parse(entry.at)
  if (bounds.since !== undefined && at < bounds.since) return false
  if (bounds.until !== undefined && at > bounds.until) return false
  return true
}

/**
 * Resolve `since` and `until` into comparable instants.
 *
 * @param query - audit query 审计查询
 * @returns the resolved bounds 已解析边界
 * @throws AdminError `VALIDATION_FAILED` when a bound is not an ISO-8601 instant 边界不是 ISO-8601 时刻时抛出
 */
function timeBounds(query: AdminAuditQuery): TimeBounds {
  return {
    since: instant(query.since, 'since'),
    until: instant(query.until, 'until'),
  }
}

/**
 * Parse one optional ISO-8601 instant.
 *
 * @param value - raw query value 原始查询值
 * @param field - field name used in the error 错误中使用的字段名
 * @returns epoch milliseconds, or `undefined` when absent 毫秒时刻；缺失时为 `undefined`
 * @throws AdminError `VALIDATION_FAILED` when the value cannot be parsed 无法解析时抛出
 */
function instant(value: string | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    throw new AdminError('VALIDATION_FAILED', `audit query ${field} is not an ISO-8601 instant`, { [field]: value })
  }
  return parsed
}
