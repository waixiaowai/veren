/**
 * 一次采集：把知乎账号的当前状态读进存储。
 *
 * 采集是**只读**的，而且是**按天幂等**的：同一天重采是覆盖，不是累加。因此
 * 一次失败的采集不会污染历史，失败的那天在采集账里如实记为 failed/partial。
 *
 * 内容按**链接**定位（官方契约里内容列表项没有独立 id，链接就是唯一标识），
 * 因此每篇的统计与评论都以它的链接为参数。
 *
 * A pull: reads the Zhihu account's current state into storage.
 *
 * A pull is **read-only** and **idempotent per day**: re-collecting the same
 * day overwrites rather than accumulates. So a failed pull never pollutes the
 * history, and the day it failed is recorded honestly as failed/partial.
 *
 * Contents are located by their **url** (the official content list items carry
 * no id of their own, so the url is the only identifier), and each piece's
 * stats and comments are requested with it.
 *
 * @module @veren/zhihu-ops/collect/pull
 */
import type { ZhihuDataSource } from '@veren/zhihu-client'
import { ZhihuError, ZhihuErrorCode } from '@veren/zhihu-client'
import type {
  AccountStatsRow,
  CommentRow,
  ContentRow,
  ContentStatsRow,
  HotItemRow,
  PullRunRow,
  QuestionRow,
} from '../store/store.ts'
import { dayKey } from './day.ts'

/**
 * 采集要的存储面——采集只认这些读写原语，不认具体的存储实现。
 * The storage face the pull needs — the pull knows only these read/write
 * primitives, not a concrete storage implementation.
 */
export interface PullStorage {
  /** 记一次采集 / record one pull run */
  putPullRun(row: PullRunRow): Promise<void>
  /** 写账号日快照 / write the account day snapshot */
  putAccountStats(row: AccountStatsRow): Promise<void>
  /** 写内容档案 / write the content profile */
  putContent(row: ContentRow): Promise<void>
  /** 写内容日统计 / write the per-content day stats */
  putContentStats(row: ContentStatsRow): Promise<void>
  /** 写评论存档 / write the archived comment */
  putComment(row: CommentRow): Promise<void>
  /** 写热榜日快照 / write the hot list day snapshot */
  putHotItem(row: HotItemRow): Promise<void>
  /** 写选题日快照 / write the topic day snapshot */
  putQuestion(row: QuestionRow): Promise<void>
  /** 全部账号日快照 / every account day snapshot */
  accountStats(): AccountStatsRow[]
  /** 全部内容档案 / every content profile */
  contents(): ContentRow[]
  /** 全部内容日统计 / every per-content day stats row */
  contentStats(): ContentStatsRow[]
}

/** 一次采集用到的面 / the faces one pull uses */
export interface PullFaces {
  /** 数据源 / the data source */
  readonly source: ZhihuDataSource
  /** 存储 / the storage */
  readonly storage: PullStorage
  /** 每次采集拉取的内容条数 / how many contents one pull reads */
  readonly contentLimit: number
  /** 钟面来源 / the clock source */
  readonly now: () => Date
}

/** 一次采集的结果 / the outcome of one pull */
export interface PullOutcome {
  /** 采集日 / the pull day */
  readonly day: string
  /** 结果状态 / the outcome state */
  readonly state: 'ok' | 'partial' | 'failed'
  /** 采集到的粉丝数 / the follower count collected */
  readonly followerCount: number
  /** 采集到的内容数 / how many contents were collected */
  readonly contentCount: number
  /** 本次发出的请求数 / how many requests this pull made */
  readonly requestCount: number
  /** 结束原因 / why it ended */
  readonly reason?: string
}

/** 采集期内的请求计数 / the request counter during a pull */
interface PullCounter {
  value: number
}

/**
 * 跑一次采集：账号 → 内容 → 评论 → 热榜 → 选题，逐段落库。
 * Runs one pull: account → contents → comments → hot list → topics, storing
 * section by section.
 *
 * @param faces - the pull faces / 采集用到的面
 * @returns the pull outcome / 采集结果
 */
export async function runPull(faces: PullFaces): Promise<PullOutcome> {
  const day = dayKey(faces.now())
  const counter: PullCounter = { value: 0 }
  const outcome = await collectAll(faces, day, counter)
  await faces.storage.putPullRun({
    day,
    state: outcome.state,
    follower_count: outcome.followerCount,
    content_count: outcome.contentCount,
    request_count: outcome.requestCount,
    ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
    collected_at: faces.now().toISOString(),
  })
  return outcome
}

/** 采集各段落；任一段失败按额度耗尽与否分成 partial 与 failed / the pull sections; a failing section splits into partial or failed */
async function collectAll(faces: PullFaces, day: string, counter: PullCounter): Promise<PullOutcome> {
  let followerCount = 0
  let contentCount = 0
  try {
    followerCount = await pullAccount(faces, day, counter)
    contentCount = await pullContents(faces, day, counter)
    await pullHotList(faces, day, counter)
    await pullQuestions(faces, day, counter)
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    const exhausted = error instanceof ZhihuError && error.code === ZhihuErrorCode.QuotaExhausted
    return { day, state: exhausted ? 'partial' : 'failed', followerCount, contentCount, requestCount: counter.value, reason }
  }
  return { day, state: 'ok', followerCount, contentCount, requestCount: counter.value }
}

/** 账号段：读账号统计并算涨粉 / the account section: the account stats plus the follower delta */
async function pullAccount(faces: PullFaces, day: string, counter: PullCounter): Promise<number> {
  counter.value += 1
  const account = await faces.source.accountStats()
  const previous = previousAccountDay(faces.storage, day)
  await faces.storage.putAccountStats({
    day,
    follower_count: account.followerCount,
    following_count: account.followingCount,
    answer_count: account.answerCount,
    article_count: account.articleCount,
    video_count: account.videoCount,
    total_like_count: account.totalLikeCount,
    follower_delta: previous === undefined ? 0 : account.followerCount - previous.follower_count,
    collected_at: faces.now().toISOString(),
  })
  return account.followerCount
}

/** 上一个有快照的日子（用于算日增）/ the last day with a snapshot (used for the daily delta) */
function previousAccountDay(storage: PullStorage, day: string) {
  return storage.accountStats().filter((row) => row.day < day).sort((a, b) => a.day.localeCompare(b.day)).pop()
}

/** 内容段：内容档案 + 每篇统计 + 评论 / the contents section: profiles, per-content stats, comments */
async function pullContents(faces: PullFaces, day: string, counter: PullCounter): Promise<number> {
  counter.value += 1
  const contents = await faces.source.contents(undefined, faces.contentLimit)
  for (const content of contents) {
    await faces.storage.putContent({
      content_id: content.contentId,
      content_type: content.contentType,
      title: content.title,
      url: content.url,
      first_seen_day: day,
      updated_day: day,
      ...(content.createdAt === undefined ? {} : { created_at: content.createdAt }),
    })
    await pullContentStats(faces, day, content.contentId, content.url, counter)
  }
  await pullComments(faces, day, contents.map((content) => ({ id: content.contentId, url: content.url })), counter)
  return contents.length
}

/** 单篇统计段 / the per-content stats section */
async function pullContentStats(faces: PullFaces, day: string, contentId: string, url: string, counter: PullCounter): Promise<void> {
  counter.value += 1
  const stats = await faces.source.contentStats(url)
  const previous = faces.storage.contentStats().filter((row) => row.content_id === contentId && row.day < day)
    .sort((a, b) => a.day.localeCompare(b.day)).pop()
  await faces.storage.putContentStats({
    day,
    content_id: contentId,
    ...definedOnly(stats),
    ...(previous?.view_count === undefined || stats.viewCount === undefined
      ? {}
      : { view_delta: stats.viewCount - previous.view_count }),
    collected_at: faces.now().toISOString(),
  })
}

/** 只保留有值的指标（官方明确"未返回不得补零"）/ keeps only the metrics that carry a value */
function definedOnly(stats: {
  readonly viewCount?: number
  readonly exposureCount?: number
  readonly upvoteCount?: number
  readonly likeCount?: number
  readonly commentCount?: number
  readonly collectCount?: number
  readonly shareCount?: number
  readonly readFinishedRate?: number
  readonly followerGain?: number
  readonly followerConversionRate?: number
}): Record<string, number> {
  const map = {
    view_count: stats.viewCount,
    exposure_count: stats.exposureCount,
    upvote_count: stats.upvoteCount,
    like_count: stats.likeCount,
    comment_count: stats.commentCount,
    collect_count: stats.collectCount,
    share_count: stats.shareCount,
    read_finished_rate: stats.readFinishedRate,
    follower_gain: stats.followerGain,
    follower_conversion_rate: stats.followerConversionRate,
  }
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(map)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/** 评论段：只读前几篇的评论，省额度 / the comments section: only the first pieces' comments, to save allowance */
async function pullComments(
  faces: PullFaces,
  day: string,
  contents: readonly { readonly id: string; readonly url: string }[],
  counter: PullCounter,
): Promise<void> {
  for (const content of contents.slice(0, COMMENT_PULL_LIMIT)) {
    counter.value += 1
    const comments = await faces.source.comments(content.url)
    for (const comment of comments) {
      await faces.storage.putComment({
        comment_id: comment.commentId,
        content_id: content.id,
        author_token: comment.authorToken,
        content: comment.content,
        like_count: comment.likeCount,
        created_at: comment.createdAt,
        day,
      })
    }
  }
}

/** 热榜段 / the hot list section */
async function pullHotList(faces: PullFaces, day: string, counter: PullCounter): Promise<void> {
  counter.value += 1
  const items = await faces.source.hotList()
  for (const item of items) {
    await faces.storage.putHotItem({
      day,
      rank: item.rank,
      title: item.title,
      url: item.url,
      ...(item.summary === undefined ? {} : { excerpt: item.summary }),
    })
  }
}

/** 选题段 / the topics section */
async function pullQuestions(faces: PullFaces, day: string, counter: PullCounter): Promise<void> {
  counter.value += 1
  const questions = await faces.source.suggestedQuestions()
  for (const question of questions) {
    await faces.storage.putQuestion({
      day,
      question_id: question.questionId,
      title: question.title,
      url: question.url,
    })
  }
}

/** 一次采集最多读几篇的评论 / how many pieces' comments one pull reads at most */
const COMMENT_PULL_LIMIT = 3
