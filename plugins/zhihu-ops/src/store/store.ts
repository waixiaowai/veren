/**
 * 存储访问器：域句柄的开关与每张表的类型化读写。
 *
 * 键的形状在这里定死——日快照的键是日期，内容的键是内容 id，评论的键是
 * `内容 id + 评论 id`——因此"按天 upsert"天然幂等：同一天再采一次就是覆盖。
 *
 * 每张表一个显式的读取器（不写泛型访问器）：域的表类型是按表名索引的，
 * 显式读取器让每个调用点的行类型都是确定的，不需要类型体操。
 *
 * The storage accessor: opening and closing the domain handle plus typed
 * accessors for every table.
 *
 * The key shapes are pinned here — a day snapshot keys by date, a content keys
 * by content id, a comment by content id plus comment id — so the "upsert per
 * day" is inherently idempotent: collecting the same day again overwrites.
 *
 * Every table gets an explicit reader (no generic accessor): the domain's table
 * types are indexed by table name, and explicit readers make each call site's
 * row type certain without type gymnastics.
 *
 * @module @veren/zhihu-ops/store/store
 */
import type { Context } from '@deepseek-ai/cordis'
import type { z } from 'zod'
import { ZHIHU_OPS_DOMAIN_NAME, zhihuOpsDomain } from './schema.ts'
import type { ZhihuOpsStore } from './schema.ts'
import {
  accountStatsSchema,
  commentSchema,
  contentSchema,
  contentStatsSchema,
  hotItemSchema,
  pullRunSchema,
  questionSchema,
  reportSchema,
} from './rows.ts'

/** 采集账行 / a pull ledger row */
export type PullRunRow = z.infer<typeof pullRunSchema>
/** 账号日快照行 / an account day snapshot row */
export type AccountStatsRow = z.infer<typeof accountStatsSchema>
/** 内容档案行 / a content profile row */
export type ContentRow = z.infer<typeof contentSchema>
/** 内容日统计行 / a per-content day stats row */
export type ContentStatsRow = z.infer<typeof contentStatsSchema>
/** 评论存档行 / an archived comment row */
export type CommentRow = z.infer<typeof commentSchema>
/** 热榜日快照行 / a hot list day snapshot row */
export type HotItemRow = z.infer<typeof hotItemSchema>
/** 选题日快照行 / a topic day snapshot row */
export type QuestionRow = z.infer<typeof questionSchema>
/** 报告行 / a report row */
export type ReportRow = z.infer<typeof reportSchema>

/** 评论行的键：`内容 id + 分隔符 + 评论 id` / the comment row key: content id + separator + comment id */
export function commentKey(contentId: string, commentId: string): string {
  return `${contentId}::${commentId}`
}

/** 内容日统计行的键：`日期 + 分隔符 + 内容 id` / the content stats row key: date + separator + content id */
export function contentStatsKey(day: string, contentId: string): string {
  return `${day}::${contentId}`
}

/**
 * 知乎运营分析的持久化存储。
 * The durable storage of the Zhihu operations analysis.
 */
export class ZhihuOpsStorage {
  private domain: ZhihuOpsStore | undefined

  /**
   * 打开域；上一次激活留下的句柄先关掉。
   * Opens the domain; a handle left by a previous activation closes first.
   *
   * @param ctx - the context carrying `storageDomain` / 带存储域的上下文
   */
  async open(ctx: Context): Promise<void> {
    const stale = ctx.storageDomain.get(ZHIHU_OPS_DOMAIN_NAME)
    if (stale !== undefined) {
      try {
        await stale.close()
        ctx.logger.warn('zhihu-ops: closed the storage domain left open by a previous activation')
      } catch (error: unknown) {
        ctx.logger.warn(`zhihu-ops: the previous storage domain could not close: ${String(error)}`)
      }
    }
    this.domain = await ctx.storageDomain.open(zhihuOpsDomain)
  }

  /** 关闭域；可重复调用 / closes the domain; safe to call twice */
  async close(): Promise<void> {
    const domain = this.domain
    this.domain = undefined
    await domain?.close()
  }

  /** 域是否已开 / whether the domain is open */
  isOpen(): boolean {
    return this.domain !== undefined
  }

  /** 记一次采集 / record one pull run */
  async putPullRun(row: PullRunRow): Promise<void> {
    await this.opened().table('pull_runs').put(row.day, row)
  }

  /** 取某天的采集账 / the pull ledger of one day */
  getPullRun(day: string): PullRunRow | undefined {
    return this.opened().table('pull_runs').get(day)
  }

  /** 全部采集账（按日排序）/ every pull run, ordered by day */
  pullRuns(): PullRunRow[] {
    return [...this.opened().table('pull_runs').entries()].map(([, row]) => row).sort((a, b) => a.day.localeCompare(b.day))
  }

  /** 写账号日快照 / write the account day snapshot */
  async putAccountStats(row: AccountStatsRow): Promise<void> {
    await this.opened().table('account_stats_daily').put(row.day, row)
  }

  /** 全部账号日快照（按日排序）/ every account day snapshot, ordered by day */
  accountStats(): AccountStatsRow[] {
    return [...this.opened().table('account_stats_daily').entries()].map(([, row]) => row).sort((a, b) => a.day.localeCompare(b.day))
  }

  /** 写内容档案 / write the content profile */
  async putContent(row: ContentRow): Promise<void> {
    await this.opened().table('contents').put(row.content_id, row)
  }

  /** 全部内容档案 / every content profile */
  contents(): ContentRow[] {
    return [...this.opened().table('contents').entries()].map(([, row]) => row)
  }

  /** 写内容日统计 / write the per-content day stats */
  async putContentStats(row: ContentStatsRow): Promise<void> {
    await this.opened().table('content_stats_daily').put(contentStatsKey(row.day, row.content_id), row)
  }

  /** 全部内容日统计（按日排序）/ every per-content day stats row, ordered by day */
  contentStats(): ContentStatsRow[] {
    return [...this.opened().table('content_stats_daily').entries()].map(([, row]) => row).sort((a, b) => a.day.localeCompare(b.day))
  }

  /** 写评论存档 / write the archived comment */
  async putComment(row: CommentRow): Promise<void> {
    await this.opened().table('comments').put(commentKey(row.content_id, row.comment_id), row)
  }

  /** 某内容的评论 / the comments of one content */
  commentsOf(contentId: string): CommentRow[] {
    return this.comments().filter((row) => row.content_id === contentId)
  }

  /** 全部评论 / every archived comment */
  comments(): CommentRow[] {
    return [...this.opened().table('comments').entries()].map(([, row]) => row)
  }

  /** 写热榜日快照 / write the hot list day snapshot */
  async putHotItem(row: HotItemRow): Promise<void> {
    await this.opened().table('hotlist_daily').put(`${row.day}::${row.rank}`, row)
  }

  /** 某天的热榜 / the hot list of one day */
  hotItemsOf(day: string): HotItemRow[] {
    return this.hotItems().filter((row) => row.day === day).sort((a, b) => a.rank - b.rank)
  }

  /** 全部热榜日快照 / every hot list day snapshot */
  hotItems(): HotItemRow[] {
    return [...this.opened().table('hotlist_daily').entries()].map(([, row]) => row)
  }

  /** 写选题日快照 / write the topic day snapshot */
  async putQuestion(row: QuestionRow): Promise<void> {
    await this.opened().table('questions_daily').put(`${row.day}::${row.question_id}`, row)
  }

  /** 某天的选题建议 / the topic suggestions of one day */
  questionsOf(day: string): QuestionRow[] {
    return this.questions().filter((row) => row.day === day)
  }

  /** 全部选题日快照 / every topic day snapshot */
  questions(): QuestionRow[] {
    return [...this.opened().table('questions_daily').entries()].map(([, row]) => row)
  }

  /** 写报告 / write the report */
  async putReport(row: ReportRow): Promise<void> {
    await this.opened().table('reports').put(row.report_id, row)
  }

  /** 全部报告（最新在前）/ every report, newest first */
  reports(): ReportRow[] {
    return [...this.opened().table('reports').entries()].map(([, row]) => row).sort((a, b) => b.generated_at.localeCompare(a.generated_at))
  }

  /** 取出已开的域；没开就是内部错误 / the opened domain; an unopened domain is an internal error */
  private opened(): ZhihuOpsStore {
    const domain = this.domain
    if (domain === undefined) {
      throw new Error('[zhihu-ops] the storage domain is not open')
    }
    return domain
  }
}
