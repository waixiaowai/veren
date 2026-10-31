/**
 * The `audit` capability: the append-only governance trail and its query shape.
 *
 * `audit` 能力：只追加的治理轨迹及其查询形状。
 *
 * @module @veren/admin-contract/audit
 */

import type { HealthReport } from './index.ts'

/** Outcome recorded for one audited action. 单次审计动作记录的结果。 */
export type AdminAuditResult = 'intent' | 'success' | 'failure' | 'denied'

/** One append-only audit entry. 单条只追加审计记录。 */
export interface AdminAuditEntry {
  /** Entry id. 记录 id。 */
  readonly id: string
  /** Instant, ISO-8601 UTC. 时刻，ISO-8601 UTC。 */
  readonly at: string
  /** Acting user id, or `null` for anonymous attempts. 操作者用户 id；匿名尝试为 `null`。 */
  readonly actorId: string | null
  /** Acting user label captured at write time. 写入时记录的操作者标签。 */
  readonly actorLabel: string
  /** Action name such as `auth.login`. 形如 `auth.login` 的动作名。 */
  readonly action: string
  /** Outcome. 结果。 */
  readonly result: AdminAuditResult
  /** Affected resource reference. 受影响资源引用。 */
  readonly target?: string
  /** Structured context. 结构化上下文。 */
  readonly detail?: Readonly<Record<string, unknown>>
  /** Request correlation id. 请求关联 id。 */
  readonly requestId?: string
  /** Peer address. 对端地址。 */
  readonly ip?: string
}

/** Audit query filter. 审计查询过滤。 */
export interface AdminAuditQuery {
  /** Page size. 分页大小。 */
  readonly limit?: number
  /** Opaque cursor from the previous page. 上一页的不透明游标。 */
  readonly cursor?: string
  /** Filter by actor. 按操作者过滤。 */
  readonly actorId?: string
  /** Filter by action prefix. 按动作前缀过滤。 */
  readonly action?: string
  /** Filter by outcome. 按结果过滤。 */
  readonly result?: AdminAuditResult
  /** Lower time bound, inclusive. 时间下界（含）。 */
  readonly since?: string
  /** Upper time bound, inclusive. 时间上界（含）。 */
  readonly until?: string
}

/** The `audit` capability: append-only governance trail. `audit` 能力：只追加治理轨迹。 */
export interface AdminAudit {
  /**
   * Append one entry. Retention trimming must never drop a newer entry first.
   * @param entry - entry without id and timestamp 不含 id 与时间戳的记录
   */
  record(entry: Omit<AdminAuditEntry, 'id' | 'at'>): Promise<void>

  /**
   * Query entries, newest first.
   * @param query - filter and paging 过滤与分页
   * @returns one page of entries 一页记录
   */
  list(query: AdminAuditQuery): Promise<{
    /** Page items. 本页条目。 */
    readonly items: readonly AdminAuditEntry[]
    /** Cursor for the next page. 下一页游标。 */
    readonly nextCursor?: string
  }>

  /**
   * Probe the provider.
   * @returns the health verdict 健康结论
   */
  health?(): Promise<HealthReport>
}
