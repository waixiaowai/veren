/**
 * 报告的事实块：把存储里的行装配成模型可读的事实。
 *
 * 这是**纯装配**——不调模型、不碰网络，因此事实口径可以被单测钉死：模型
 * 看到什么，取决于这里给了什么。
 *
 * The report's fact block: assembles the stored rows into model-readable
 * facts.
 *
 * This is **pure assembly** — no model call, no network — so the fact
 * definitions can be pinned in unit tests: what the model sees depends on
 * exactly what is given here.
 *
 * @module @veren/zhihu-ops/report/facts
 */
import type { AccountStatsRow, CommentRow, ContentRow, ContentStatsRow, HotItemRow, QuestionRow } from '../store/store.ts'
import { accountTrend, contentPerformance, moversOf, replyCandidates } from '../collect/metrics.ts'
import type { ContentPerformance } from '../collect/metrics.ts'

/** 事实块需要的一切输入 / everything the fact block needs */
export interface FactInput {
  /** 账号日快照 / the account day snapshots */
  readonly accountStats: readonly AccountStatsRow[]
  /** 内容档案 / the content profiles */
  readonly contents: readonly ContentRow[]
  /** 内容日统计 / the per-content day stats */
  readonly contentStats: readonly ContentStatsRow[]
  /** 评论存档 / the archived comments */
  readonly comments: readonly CommentRow[]
  /** 热榜日快照 / the hot list day snapshot */
  readonly hotItems: readonly HotItemRow[]
  /** 选题日快照 / the topic day snapshot */
  readonly questions: readonly QuestionRow[]
  /** 窗口天数 / how many days the window covers */
  readonly windowDays: number
}

/** 装配好的事实块 / the assembled fact block */
export interface FactBlock {
  /** 账号段 / the account section */
  readonly account: string
  /** 内容段 / the contents section */
  readonly contents: string
  /** 待回评论段 / the reply-candidates section */
  readonly replies: string
  /** 热点段 / the hot-list section */
  readonly hot: string
  /** 选题段 / the topics section */
  readonly topics: string
}

/** 事实块的各段 / the sections of the fact block */
export interface FactSections {
  readonly account: string
  readonly contents: string
  readonly replies: string
  readonly hot: string
  readonly topics: string
}

/**
 * 装配事实块。
 * Assembles the fact block.
 *
 * @param input - the stored rows / 存储里的行
 * @returns the assembled sections / 装配好的各段
 */
export function assembleFacts(input: FactInput): FactSections {
  const performances = input.contents.map((profile) => contentPerformance(profile, input.contentStats))
  return {
    account: accountSection(input.accountStats),
    contents: contentsSection(performances),
    replies: repliesSection(performances, input.comments),
    hot: hotSection(input.hotItems),
    topics: topicsSection(input.questions),
  }
}

/** 账号段：粉丝趋势与区间变化 / the account section: the follower trend and the window change */
function accountSection(rows: readonly AccountStatsRow[]): string {
  const trend = accountTrend(rows)
  const daily = [...rows].sort((a, b) => a.day.localeCompare(b.day)).slice(-7)
    .map((row) => `- ${row.day}：粉丝 ${row.follower_count}（${(row.follower_delta ?? 0) >= 0 ? '+' : ''}${row.follower_delta ?? 0}）· 回答 ${row.answer_count} · 文章 ${row.article_count} · 累计喜欢 ${row.total_like_count}`)
  return [
    `窗口 ${trend.windowDays} 天：粉丝 ${trend.followerCount}，区间净增 ${trend.windowGrowth}，日均 ${trend.dailyAverage}。`,
    ...daily,
  ].join('\n')
}

/** 内容段：区间 movers / the contents section: the window movers */
function contentsSection(performances: readonly ContentPerformance[]): string {
  const movers = moversOf(performances, 8)
  if (movers.length === 0) return '窗口内没有内容数据。'
  return movers.map((item) => [
    `- ${item.title}（${item.contentType}）`,
    `  阅读 ${item.viewCount}（区间 ${item.viewDelta >= 0 ? '+' : ''}${item.viewDelta}）· 曝光 ${item.exposureCount}`
    + ` · 赞同 ${item.upvoteCount} · 喜欢 ${item.likeCount} · 评论 ${item.commentCount} · 收藏 ${item.collectCount}`,
    `  读完率 ${item.readFinishedRate === undefined ? '未覆盖' : item.readFinishedRate}`
    + ` · 本篇涨粉 ${item.followerGain} · 互动率 ${item.engagementRate}`,
  ].join('\n')).join('\n')
}

/** 待回评论段：评论多于赞的内容与最新评论 / the reply section: the pieces with more comments than likes, plus the latest comments */
function repliesSection(performances: readonly ContentPerformance[], comments: readonly CommentRow[]): string {
  const candidates = replyCandidates(performances, 3)
  if (candidates.length === 0) return '窗口内没有"评论多于赞"的内容。'
  const lines = candidates.map((item) => `- ${item.title}：评论 ${item.commentCount} > 喜欢 ${item.likeCount}`)
  const recent = comments.slice(0, 5).map((row) => `  · ${row.author_token || '(匿名)'}：${row.content.slice(0, 60)}`)
  return [...lines, ...recent].join('\n')
}

/** 热点段：热榜前若干 / the hot section: the top of the hot list */
function hotSection(items: readonly HotItemRow[]): string {
  if (items.length === 0) return '窗口内没有热榜数据。'
  return items.slice(0, 8).map((item) => `- ${item.rank}. ${item.title}`).join('\n')
}

/** 选题段：适合回答的问题 / the topics section: the answerable questions */
function topicsSection(questions: readonly QuestionRow[]): string {
  if (questions.length === 0) return '窗口内没有选题建议数据。'
  return questions.slice(0, 8).map((question) => `- ${question.title}`).join('\n')
}
