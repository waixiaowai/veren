/**
 * The append-only audit trail over the shared data port.
 *
 * Entries live in the `admin_audit` collection and are never edited in place:
 * the provider only appends, then trims. Trimming reads the whole collection,
 * which the DSH KV adapter can afford at its documented scale but which a SQL
 * adapter with an `at` index would do far better; see the README.
 *
 * 基于共享 data 端口的只追加审计轨迹。记录存放在 `admin_audit` 集合中，永不就地修改：
 * provider 只追加，随后裁剪。裁剪会读取整个集合；DSH KV 适配器在其文档规模下尚可承受，
 * 而带 `at` 索引的 SQL 适配器会高效得多；详见 README。
 *
 * @module @veren/admin-audit-default/provider
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  type AdminAudit,
  type AdminAuditEntry,
  type AdminAuditQuery,
  type AdminTable,
  type HealthReport,
} from '@veren/admin-contract'
import type { ResolvedConfig } from './config.ts'
import { retentionCutoff, selectDoomed, selectPage, type AuditPage } from './query.ts'

/** Collection that owns audit rows. 存放审计行的集合。 */
export const AUDIT_TABLE = 'admin_audit'

/** The audit capability implementation. 审计能力的实现。 */
export class AuditDefault implements AdminAudit {
  /** Owning context, used to resolve the data façade lazily. 所属上下文，用于惰性解析 data façade。 */
  private readonly ctx: Context

  /** Effective entry cap and retention window. 生效的条目上限与保留窗口。 */
  private readonly config: ResolvedConfig

  /**
   * @param ctx - owning context 所属上下文
   * @param config - resolved provider config 已解析的 provider 配置
   */
  constructor(ctx: Context, config: ResolvedConfig) {
    this.ctx = ctx
    this.config = config
  }

  /**
   * Append one entry, then enforce the cap and the retention window.
   *
   * @param entry - entry without id and timestamp 不含 id 与时间戳的记录
   */
  async record(entry: Omit<AdminAuditEntry, 'id' | 'at'>): Promise<void> {
    const stored: AdminAuditEntry = { ...entry, id: randomUUID(), at: new Date().toISOString() }
    await this.table().save(stored)
    await this.trim()
  }

  /**
   * Read one filtered, newest-first page.
   *
   * @param query - filter and paging 过滤与分页
   * @returns the page 本页
   */
  async list(query: AdminAuditQuery): Promise<AuditPage> {
    return selectPage(this.table().list(), query)
  }

  /**
   * Probe the data port that backs the trail.
   *
   * @returns `ok`, or `down` with the failure detail 成功为 `ok`，失败为带细节的 `down`
   */
  async health(): Promise<HealthReport> {
    try {
      this.table().size
      return { status: 'ok' }
    } catch (error) {
      return { status: 'down', detail: messageOf(error) }
    }
  }

  /**
   * Resolve the audit collection through the data façade.
   *
   * @returns the collection handle 集合句柄
   */
  private table(): AdminTable<AdminAuditEntry> {
    return this.ctx.adminData.table<AdminAuditEntry>(AUDIT_TABLE)
  }

  /**
   * Drop entries beyond the cap or older than the cutoff, oldest first.
   *
   * Removal is sequential on purpose: a partial trim is still a correct trim,
   * whereas a reordered one could drop a newer row before an older one.
   *
   * 丢弃超出上限或早于截止时刻的条目，最旧的先删。刻意顺序删除：部分完成仍是正确的裁剪，
   * 而乱序删除可能先丢弃较新的行。
   */
  private async trim(): Promise<void> {
    const rows = this.table().list()
    const cutoff = retentionCutoff(Date.now(), this.config.retentionDays)
    for (const entry of selectDoomed(rows, this.config.maxEntries, cutoff)) {
      await this.table().remove(entry.id)
    }
  }
}

/**
 * Render an unknown failure as human-readable text.
 *
 * @param error - any thrown value 任意抛出值
 * @returns the message 消息文本
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
