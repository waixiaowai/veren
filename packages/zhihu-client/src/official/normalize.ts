/**
 * 归一化层：把平台原始响应折成规范类型。
 *
 * 官方契约有三处必须在这一层处理掉的细节：信封键首字母大写（`Code`/`Data`）、
 * `Data` 的形状随端点而变（列表包 / 扁平对象 / 数组）、以及"未返回的指标
 * 不得补零"。因此取值一律防御式：平台少给一个字段，结果就少一个字段。
 *
 * The normalization layer: folds the platform's raw responses into canonical
 * types.
 *
 * Three details of the official contract must be handled here: the envelope
 * keys are capitalized (`Code`/`Data`), the shape of `Data` varies per endpoint
 * (a list wrapper, a flat object, an array), and "an omitted metric must not
 * be zero-filled". Every read is therefore defensive: a missing field yields a
 * missing field.
 *
 * @module @veren/zhihu-client/official/normalize
 */
import type {
  AccountSnapshot,
  CommentItem,
  ContentRef,
  ContentStats,
  ContentType,
  HotItem,
  QuestionSuggestion,
  QuotaState,
} from '../types.ts'
import {
  ACCOUNT_CREATION_FIELDS,
  ACCOUNT_FOLLOWERS_FIELDS,
  ACCOUNT_METRICS_FIELDS,
  COMMENT_FIELDS,
  CONTENT_FIELDS,
  CONTENT_METRICS_FIELDS,
  ENVELOPE_KEYS,
  HOT_FIELDS,
  LIST_KEYS,
  QUESTION_FIELDS,
  QUOTA_FIELDS,
} from './fields.ts'
import { PLATFORM_CONTENT_TYPES } from './endpoints.ts'

/** 一条原始记录 / one raw record */
type Raw = Record<string, unknown>

/** 原始值是不是一个对象 / whether a raw value is a plain object */
function asRecord(value: unknown): Raw | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Raw
}

/** 按候选表取第一个存在的字段值 / reads the first present candidate field */
function pick(raw: Raw | undefined, candidates: readonly string[]): unknown {
  if (raw === undefined) return undefined
  for (const key of candidates) {
    const value = raw[key]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

/** 取数字字段（无法解析成数字就缺省）/ reads a numeric field (unparsable values are absent) */
function pickNumber(raw: Raw | undefined, candidates: readonly string[]): number | undefined {
  const value = pick(raw, candidates)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

/** 取字符串字段 / reads a string field */
function pickString(raw: Raw | undefined, candidates: readonly string[]): string | undefined {
  const value = pick(raw, candidates)
  if (typeof value === 'string') return value.length === 0 ? undefined : value
  if (typeof value === 'number') return String(value)
  return undefined
}

/** 取子对象 / reads a nested object */
function pickRecord(raw: Raw | undefined, candidates: readonly string[]): Raw | undefined {
  return asRecord(pick(raw, candidates))
}

/**
 * 时间 → ISO 8601（支持秒/毫秒时间戳与 ISO 串）。
 * A time → ISO 8601 (epoch seconds/millis or an ISO string).
 *
 * @param value - the raw time / 原始时间
 * @returns the ISO string, or undefined when unparsable / ISO 串，不可解析则缺省
 */
export function toIso(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 1e12 ? value * 1000 : value
    return new Date(millis).toISOString()
  }
  return undefined
}

/**
 * 平台内容类型 → 规范内容类型。
 * A platform content type → the canonical content type.
 *
 * @param value - the raw type / 原始类型
 * @returns the canonical type / 规范类型
 */
export function toContentType(value: unknown): ContentType {
  const text = typeof value === 'string' ? value.toLowerCase() : ''
  const mapped = PLATFORM_CONTENT_TYPES[text]
  if (mapped !== undefined) return mapped as ContentType
  if (text.includes('answer')) return 'answer'
  if (text.includes('video')) return 'video'
  if (text.includes('pin')) return 'pin'
  return 'article'
}

/**
 * 从链接末段解析短 id：官方的内容列表项没有独立 id，链接是唯一标识。
 * Parses the short id off the url's last segment: the official content list
 * items carry no id of their own, so the url is the only identifier.
 *
 * @param url - the content url / 内容链接
 * @returns the short id / 短 id
 */
export function contentIdOf(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? url
  const segments = withoutQuery.split('/').filter((segment) => segment.length > 0)
  return segments[segments.length - 1] ?? withoutQuery
}

/**
 * 拆信封：取 `Data`，并按 `Code` 判定业务失败。
 * Unwraps the envelope: reads `Data` and judges business failure by `Code`.
 *
 * @param body - the raw response body / 原始响应体
 * @returns the payload / 载荷
 */
export function unwrapPayload(body: unknown): unknown {
  const record = asRecord(body)
  if (record === undefined) return body
  const data = record[ENVELOPE_KEYS.Data]
  return data === undefined ? body : data
}

/** 取出载荷里的列表 / reads the list inside a payload */
export function asRows(payload: unknown): Raw[] {
  if (Array.isArray(payload)) {
    return payload.map((entry) => asRecord(entry)).filter((entry): entry is Raw => entry !== undefined)
  }
  const record = asRecord(payload)
  if (record === undefined) return []
  for (const key of LIST_KEYS) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value.map((entry) => asRecord(entry)).filter((entry): entry is Raw => entry !== undefined)
    }
  }
  return []
}

/** 账号统计的归一化 / the account stats normalization */
export function normalizeAccountStats(body: unknown, collectedAt: string): AccountSnapshot {
  const data = asRecord(unwrapPayload(body)) ?? {}
  const followers = pickRecord(data, ['Followers'])
  const creation = pickRecord(data, ['CreationCounts'])
  const metrics = pickRecord(data, ['Metrics'])
  return {
    followerCount: pickNumber(followers, ACCOUNT_FOLLOWERS_FIELDS.total) ?? 0,
    followingCount: 0,
    answerCount: pickNumber(creation, ACCOUNT_CREATION_FIELDS.answer) ?? 0,
    articleCount: pickNumber(creation, ACCOUNT_CREATION_FIELDS.article) ?? 0,
    videoCount: pickNumber(creation, ACCOUNT_CREATION_FIELDS.video) ?? 0,
    totalLikeCount: pickNumber(metrics, ACCOUNT_METRICS_FIELDS.likeCount) ?? 0,
    totalUpvoteCount: pickNumber(metrics, ACCOUNT_METRICS_FIELDS.upvoteCount) ?? 0,
    totalViewCount: pickNumber(metrics, ACCOUNT_METRICS_FIELDS.viewCount) ?? 0,
    collectedAt,
  }
}

/** 内容引用的归一化 / the content reference normalization */
export function normalizeContentRef(body: unknown): ContentRef | undefined {
  const record = asRecord(body)
  if (record === undefined) return undefined
  const url = pickString(record, CONTENT_FIELDS.url)
  if (url === undefined) return undefined
  const title = pickString(record, CONTENT_FIELDS.title)
  const summary = pickString(record, CONTENT_FIELDS.summary)
  const createdAt = toIso(pick(record, CONTENT_FIELDS.createdAt))
  const likeCount = pickNumber(record, CONTENT_FIELDS.likeCount)
  const commentCount = pickNumber(record, CONTENT_FIELDS.commentCount)
  const collectCount = pickNumber(record, CONTENT_FIELDS.favoriteCount)
  return {
    contentId: contentIdOf(url),
    contentType: toContentType(pick(record, CONTENT_FIELDS.contentType)),
    title: title ?? '(untitled)',
    url,
    ...(summary === undefined ? {} : { summary }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(likeCount === undefined ? {} : { likeCount }),
    ...(commentCount === undefined ? {} : { commentCount }),
    ...(collectCount === undefined ? {} : { collectCount }),
  }
}

/** 单篇统计的归一化 / the per-content stats normalization */
export function normalizeContentStats(body: unknown, fallbackId: string): ContentStats {
  const rows = asRows(unwrapPayload(body))
  const first = rows[0]
  const metrics = pickRecord(first, ['Metrics'])
  const url = pickString(first, ['Url'])
  const stats: ContentStats = { contentId: url === undefined ? fallbackId : contentIdOf(url) }
  const numbers = {
    viewCount: pickNumber(metrics, CONTENT_METRICS_FIELDS.viewCount),
    exposureCount: pickNumber(metrics, CONTENT_METRICS_FIELDS.exposureCount),
    upvoteCount: pickNumber(metrics, CONTENT_METRICS_FIELDS.upvoteCount),
    likeCount: pickNumber(metrics, CONTENT_METRICS_FIELDS.likeCount),
    commentCount: pickNumber(metrics, CONTENT_METRICS_FIELDS.commentCount),
    collectCount: pickNumber(metrics, CONTENT_METRICS_FIELDS.collectCount),
    shareCount: pickNumber(metrics, CONTENT_METRICS_FIELDS.shareCount),
    readFinishedRate: pickNumber(metrics, CONTENT_METRICS_FIELDS.readFinishedRate),
    clickRate: pickNumber(metrics, CONTENT_METRICS_FIELDS.clickRate),
    followerGain: pickNumber(metrics, CONTENT_METRICS_FIELDS.followerGain),
    followerConversionRate: pickNumber(metrics, CONTENT_METRICS_FIELDS.followerConversionRate),
  }
  return { ...stats, ...definedOnly(numbers) }
}

/** 只保留有值的键（官方明确"未返回不得补零"）/ keeps only the keys that carry a value */
function definedOnly(numbers: Readonly<Record<string, number | undefined>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(numbers)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/** 评论的归一化（官方把评论装在 `Comment` 里，子回复在 `Children` 里）/ the comment normalization */
export function normalizeComment(body: unknown): CommentItem | undefined {
  const wrapper = asRecord(body)
  if (wrapper === undefined) return undefined
  const record = pickRecord(wrapper, ['Comment']) ?? wrapper
  const commentId = pickString(record, COMMENT_FIELDS.commentId)
  if (commentId === undefined) return undefined
  const createdAt = toIso(pick(record, COMMENT_FIELDS.createdAt))
  return {
    commentId,
    authorToken: pickString(record, COMMENT_FIELDS.authorToken) ?? '',
    content: pickString(record, COMMENT_FIELDS.content) ?? '',
    likeCount: pickNumber(record, COMMENT_FIELDS.likeCount) ?? 0,
    createdAt: createdAt ?? new Date(0).toISOString(),
  }
}

/** 热榜条目的归一化 / the hot list entry normalization */
export function normalizeHotItem(body: unknown, rank: number): HotItem | undefined {
  const record = asRecord(body)
  if (record === undefined) return undefined
  const title = pickString(record, HOT_FIELDS.title)
  if (title === undefined) return undefined
  const url = pickString(record, HOT_FIELDS.url)
  const summary = pickString(record, HOT_FIELDS.summary)
  return {
    rank,
    title,
    url: url ?? '',
    ...(summary === undefined ? {} : { summary }),
  }
}

/** 选题建议的归一化 / the topic suggestion normalization */
export function normalizeQuestion(body: unknown): QuestionSuggestion | undefined {
  const record = asRecord(body)
  if (record === undefined) return undefined
  const title = pickString(record, QUESTION_FIELDS.title)
  const url = pickString(record, QUESTION_FIELDS.url)
  if (title === undefined || url === undefined) return undefined
  return { questionId: contentIdOf(url), title, url }
}

/** 配额读数的归一化（官方的 `Data` 是数组，按额度组逐项给出）/ the quota reading normalization */
export function normalizeQuota(body: unknown): QuotaState {
  const rows = asRows(unwrapPayload(body))
  let total = 0
  let used = 0
  let remaining = 0
  for (const row of rows) {
    total += pickNumber(row, QUOTA_FIELDS.total) ?? 0
    used += pickNumber(row, QUOTA_FIELDS.used) ?? 0
    remaining += pickNumber(row, QUOTA_FIELDS.remaining) ?? 0
  }
  return { total, used, remaining }
}
