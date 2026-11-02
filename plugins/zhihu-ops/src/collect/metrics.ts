/**
 * 派生指标：从日快照算出"涨了多少""哪篇在动"。
 *
 * 派生只做纯函数：输入是存储里的行，输出是派生值，不碰存储、不碰网络。
 * 这样指标的口径可以被单测钉死，也让页面与报告读的是同一份口径。
 *
 * The derived metrics: from the day snapshots, "how much did it grow" and
 * "which piece is moving".
 *
 * Derivation is pure: rows in, derived values out — no storage, no network.
 * That pins the metric definitions in unit tests and makes the pages and the
 * report read one single definition.
 *
 * @module @veren/zhihu-ops/collect/metrics
 */
import type { AccountStatsRow, ContentRow, ContentStatsRow } from '../store/store.ts'

/** 账号级派生视图 / the account-level derived view */
export interface AccountTrend {
  /** 粉丝总数 / total followers */
  readonly followerCount: number
  /** 相比前一天的涨粉（正为涨）/ the follower change against the previous day */
  readonly followerDelta: number
  /** 区间内的涨粉合计 / the total growth over the window */
  readonly windowGrowth: number
  /** 区间天数 / how many days the window covers */
  readonly windowDays: number
  /** 日均涨粉 / the average daily growth */
  readonly dailyAverage: number
}

/**
 * 算账号趋势：取窗口内按日排序的快照，末行是今天。
 * Computes the account trend: the window's day-ordered snapshots, the last
 * row being today.
 *
 * @param rows - the account day snapshots / 账号日快照
 * @returns the derived trend / 派生趋势
 */
export function accountTrend(rows: readonly AccountStatsRow[]): AccountTrend {
  const ordered = [...rows].sort((a, b) => a.day.localeCompare(b.day))
  const last = ordered[ordered.length - 1]
  const first = ordered[0]
  const followerCount = last?.follower_count ?? 0
  const followerDelta = last?.follower_delta ?? 0
  const windowGrowth = first === undefined ? 0 : followerCount - first.follower_count
  const windowDays = ordered.length
  return {
    followerCount,
    followerDelta,
    windowGrowth,
    windowDays,
    dailyAverage: windowDays === 0 ? 0 : Math.round((windowGrowth / windowDays) * 10) / 10,
  }
}

/** 一篇内容的派生表现 / one content's derived performance */
export interface ContentPerformance {
  /** 内容 id / the content id */
  readonly contentId: string
  /** 标题 / the title */
  readonly title: string
  /** 内容类型 / the content type */
  readonly contentType: ContentRow['content_type']
  /** 最新阅读量 / the latest view count */
  readonly viewCount: number
  /** 区间阅读增量 / the view growth over the window */
  readonly viewDelta: number
  /** 曝光 UV / the exposure unique visitors */
  readonly exposureCount: number
  /** 最新赞同数 / the latest upvote count */
  readonly upvoteCount: number
  /** 最新喜欢数 / the latest like count */
  readonly likeCount: number
  /** 最新评论数 / the latest comment count */
  readonly commentCount: number
  /** 收藏数 / the collect count */
  readonly collectCount: number
  /** 读完率（官方比值）/ the read-finished rate (the official ratio) */
  readonly readFinishedRate: number | undefined
  /** 该篇带来的涨粉 / the followers this piece brought in */
  readonly followerGain: number
  /** 互动率代理（喜欢+评论+收藏）/ 阅读 / the interaction-rate proxy (likes + comments + collects) / views */
  readonly engagementRate: number
}

/**
 * 算单篇的表现：最新一行是当前值，窗口首尾之差是增量。
 * Computes one content's performance: the latest row is the current value and
 * the window's first-to-last difference is the growth.
 *
 * @param profile - the content profile / 内容档案
 * @param stats - that content's day stats rows / 该内容的日统计行
 * @returns the derived performance / 派生表现
 */
export function contentPerformance(profile: ContentRow, stats: readonly ContentStatsRow[]): ContentPerformance {
  const ordered = stats.filter((row) => row.content_id === profile.content_id).sort((a, b) => a.day.localeCompare(b.day))
  const last = ordered[ordered.length - 1]
  const first = ordered[0]
  const viewCount = last?.view_count ?? 0
  const viewDelta = first === undefined ? 0 : viewCount - (first.view_count ?? 0)
  const likeCount = last?.like_count ?? 0
  const commentCount = last?.comment_count ?? 0
  const collectCount = last?.collect_count ?? 0
  return {
    contentId: profile.content_id,
    title: profile.title,
    contentType: profile.content_type,
    viewCount,
    viewDelta,
    exposureCount: last?.exposure_count ?? 0,
    upvoteCount: last?.upvote_count ?? 0,
    likeCount,
    commentCount,
    collectCount,
    readFinishedRate: last?.read_finished_rate,
    followerGain: last?.follower_gain ?? 0,
    engagementRate: viewCount === 0 ? 0 : Math.round(((likeCount + commentCount + collectCount) / viewCount) * 1000) / 1000,
  }
}

/**
 * 按区间阅读增量挑出 movers（内容最多的在前）。
 * Picks the movers by the window's view growth (most growth first).
 *
 * @param performances - the derived performances / 派生表现
 * @param limit - how many to keep / 保留几条
 * @returns the movers / movers
 */
export function moversOf(performances: readonly ContentPerformance[], limit: number): ContentPerformance[] {
  return [...performances]
    .sort((a, b) => b.viewDelta - a.viewDelta || b.viewCount - a.viewCount)
    .slice(0, limit)
}

/**
 * 挑出最值得回评论的内容（评论多、但赞少——即"有话要说"的）。
 * Picks the content worth replying to (many comments, few likes — the ones
 * asking for something).
 *
 * @param performances - the derived performances / 派生表现
 * @param limit - how many to keep / 保留几条
 * @returns the reply candidates / 待回评论的内容
 */
export function replyCandidates(performances: readonly ContentPerformance[], limit: number): ContentPerformance[] {
  return [...performances]
    .filter((item) => item.commentCount > item.likeCount)
    .sort((a, b) => b.commentCount - a.commentCount)
    .slice(0, limit)
}
