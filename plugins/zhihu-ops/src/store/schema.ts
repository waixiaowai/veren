/**
 * 权威存储域：知乎运营分析的持久面。
 *
 * 八张表各司其职——采集账、账号日快照、内容档案、内容日统计、评论存档、
 * 热榜日快照、选题日快照、报告。域版本保持 1：新增字段都是可选的，缺失的表
 * 读作空表，因此旧文件仍能打开且不丢记录。
 *
 * The authoritative storage domain: the durable face of the Zhihu operations
 * analysis.
 *
 * Eight tables, one job each — the pull ledger, the account day snapshot, the
 * content profile, the per-content day stats, the comment archive, the hot
 * list day snapshot, the topic day snapshot, and the reports. The domain
 * version stays 1: every added field is optional and a missing table reads as
 * empty, so an older file still opens without losing records.
 *
 * @module @veren/zhihu-ops/store/schema
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { z } from 'zod'
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

/**
 * 权威存储域。
 * The authoritative storage domain.
 */
export const zhihuOpsDomain = defineDomain({
  name: 'zhihu_ops',
  version: 1,
  tables: {
    pull_runs: domainTable<string, z.infer<typeof pullRunSchema>>(pullRunSchema),
    account_stats_daily: domainTable<string, z.infer<typeof accountStatsSchema>>(accountStatsSchema),
    contents: domainTable<string, z.infer<typeof contentSchema>>(contentSchema),
    content_stats_daily: domainTable<string, z.infer<typeof contentStatsSchema>>(contentStatsSchema),
    comments: domainTable<string, z.infer<typeof commentSchema>>(commentSchema),
    hotlist_daily: domainTable<string, z.infer<typeof hotItemSchema>>(hotItemSchema),
    questions_daily: domainTable<string, z.infer<typeof questionSchema>>(questionSchema),
    reports: domainTable<string, z.infer<typeof reportSchema>>(reportSchema),
  },
})

/** 域名，与诊断共享 / the domain name, shared with diagnostics */
export const ZHIHU_OPS_DOMAIN_NAME = zhihuOpsDomain.name

/** 一个已打开的域 / one opened domain */
export type ZhihuOpsStore = Domain<typeof zhihuOpsDomain>
