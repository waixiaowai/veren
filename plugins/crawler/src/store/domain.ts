/**
 * 权威存储域：多平台内容采集的持久面（意见 2：存储适配 dsh storage）。
 * The authoritative storage domain: the durable face of the crawler
 * (directive 2: storage adapts to dsh storage).
 *
 * 两张表各司其职——内容档案（键：平台 + 内容 id）、评论存档（键：平台 +
 * 内容 id + 评论 id）——因此「主键存在即更新」天然幂等：同一内容再采
 * 一次就是覆盖（design/modules/store.md 验收 4）。
 * Two tables, one job each — the content archive and the comment archive —
 * so "upsert by business key" is inherently idempotent: recollecting a
 * content overwrites (design store.md acceptance 4).
 *
 * 域版本保持 1：新增字段一律可选，缺表的读取视作空表，旧文件不丢记录。
 * Domain version stays 1: added fields stay optional; a missing table
 * reads as empty, so an older file still opens without losing records.
 *
 * @module @veren/crawler/store/domain
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { z } from 'zod'
import { commentSchema, contentSchema } from './rows.ts'

/** 内容行类型 / the content row type */
export type ContentRow = z.infer<typeof contentSchema>
/** 评论行类型 / the comment row type */
export type CommentRow = z.infer<typeof commentSchema>

/**
 * 权威存储域。
 * The authoritative storage domain.
 */
export const crawlerDomain = defineDomain({
  name: 'crawler',
  version: 1,
  tables: {
    contents: domainTable<string, ContentRow>(contentSchema),
    comments: domainTable<string, CommentRow>(commentSchema),
  },
})

/** 域名，与诊断共享 / the domain name, shared with diagnostics */
export const CRAWLER_DOMAIN_NAME = crawlerDomain.name

/** 一个已打开的域 / one opened domain */
export type CrawlerStore = Domain<typeof crawlerDomain>

/** 内容行键：`平台 + 分隔符 + 内容 id` / the content row key: platform + separator + content id */
export function contentKey(platform: string, contentId: string): string {
  return `${platform}::${contentId}`
}

/** 评论行键：`平台 + 内容 id + 评论 id` / the comment row key: platform + content id + comment id */
export function commentKey(platform: string, contentId: string, commentId: string): string {
  return `${platform}::${contentId}::${commentId}`
}
