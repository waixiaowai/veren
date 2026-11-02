/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 单篇页：一篇内容的逐日曲线与评论。
 *
 * URL 参数 `:contentId` 逐字对应注册时的 params 键——注册期与挂载期都以它为
 * 门禁，因此本页拿到的就是那一条内容，没有"猜"的余地。
 *
 * The single-content page: one content's day-by-day curve and its comments.
 *
 * The url parameter `:contentId` matches the registration's params key
 * verbatim — both registration and mount gate on it, so this page reads
 * exactly that content with no room for guessing.
 *
 * @module @veren/zhihu-ops/page-content-detail
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { contentPerformance } from './collect/metrics.ts'
import { toolOf } from './runtime.ts'
import { requireRuntime } from './runtime.ts'
import type { CommentRow, ContentRow, ContentStatsRow } from './store/store.ts'
import { STRINGS, URL_PREFIX } from './pages.tsx'

/** 本页的参数 / this page's parameters */
interface ContentDetailParams extends Record<string, unknown> {
  /** 内容 id / the content id */
  readonly contentId: string
}

/**
 * 本页挂载的工具：看单篇趋势、列内容。
 * The tools this page mounts: read one content's trend, list contents.
 *
 * @param agent - the page session's agent / 页面会话的 agent
 */
function registerDetailTools(agent: Agent): void {
  for (const localName of ['content_trend', 'list_contents']) {
    agent.ctx.tools.register(toolOf(localName))
  }
}

/** 单篇页组件体（一次性渲染）/ the single-content page's body (the one-shot render) */
export const ContentDetailPage: PageFC = (props, agent) => {
  registerDetailTools(agent)
  const runtime = requireRuntime()
  const params = props as ContentDetailParams
  const profile = runtime.storage.contents().find((row) => row.content_id === params.contentId)
  const rows = runtime.storage.contentStats().filter((row) => row.content_id === params.contentId)
    .sort((a, b) => a.day.localeCompare(b.day))
  const comments = runtime.storage.commentsOf(params.contentId)
  return (
    <>
      <h1>{profile?.title ?? params.contentId}</h1>
      <p>{summaryOf(profile, rows)}</p>
      <h2>逐日曲线</h2>
      <ul>{trendRows(rows)}</ul>
      <h2>评论</h2>
      <ul>{commentRows(comments)}</ul>
      <blockquote>{STRINGS.snapshot.zh}</blockquote>
    </>
  )
}

/** 头部一句话摘要 / the one-line head summary */
function summaryOf(profile: ContentRow | undefined, rows: readonly ContentStatsRow[]): string {
  if (profile === undefined) return '这篇内容不在档案里。'
  const performance = contentPerformance(profile, rows)
  return `类型 ${profile.content_type} · 阅读 ${performance.viewCount} · 喜欢 ${performance.likeCount} · 评论 ${performance.commentCount}`
}

/** 逐日曲线行 / the day-by-day curve rows */
function trendRows(rows: readonly ContentStatsRow[]): JSX.Element[] {
  if (rows.length === 0) return [<li key="empty">{STRINGS.empty.zh}</li>]
  return rows.map((row) => (
    <li key={row.day}>
      {row.day}：阅读 {row.view_count ?? 0}{row.view_delta === undefined ? '' : `（${row.view_delta >= 0 ? '+' : ''}${row.view_delta}）`}
      {' · '}曝光 {row.exposure_count ?? 0} · 喜欢 {row.like_count ?? 0} · 评论 {row.comment_count ?? 0} · 收藏 {row.collect_count ?? 0}
    </li>
  ))
}

/** 评论行 / the comment rows */
function commentRows(comments: readonly CommentRow[]): JSX.Element[] {
  if (comments.length === 0) return [<li key="empty">没有采集到评论。</li>]
  return comments.slice(0, 20).map((comment) => (
    <li key={comment.comment_id}>{comment.author_token || '(匿名)'}（赞 {comment.like_count}）：{comment.content}</li>
  ))
}

export const ContentDetailMeta: ComponentPageMeta = {
  name: 'content',
  url: `${URL_PREFIX}/content/:contentId`,
  description: '单篇内容的逐日曲线与最新评论',
  writes: false,
  unattended: {
    serves: '复盘某一篇内容的表现曲线与评论信号',
    level: 'L0',
    evidence: 'read-only',
    escape: 'none-needed',
  },
  instructions: [
    '这是单篇内容页。正文给出该篇的逐日阅读、赞、评论、收藏曲线与采集到的评论。',
    '要机器可读的逐日数据用 content_trend（参数是本页的 contentId）；要横向比较用 list_contents。',
    '评论只覆盖采集窗口内取到的那些，不是全量。',
  ].join(''),
}
