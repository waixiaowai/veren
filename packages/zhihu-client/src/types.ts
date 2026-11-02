/**
 * 知乎数据的规范类型面——本库对外的唯一词汇表。
 *
 * 规范类型是**平台无关**的：官方契约的键名带平台色彩（`ViewCount`、
 * `Followers.Total` 之类），本文件把它们归平成一套稳定的形状，调用方只认
 * 这套形状。平台漂移被挡在 `official/` 目录里。
 *
 * 口径说明：官方的"赞同"（UpvoteCount）与"喜欢"（LikeCount）是**两个不同的
 * 指标**，本文件分别保留，不合并成一个"点赞"。
 *
 * The canonical type face of Zhihu data — this library's only vocabulary.
 *
 * Canonical types are platform-neutral: the official contract's keys carry
 * platform flavor (`ViewCount`, `Followers.Total`), and this file flattens
 * them into one stable shape. Platform drift stays behind the `official/`
 * directory.
 *
 * On the measures: the official "upvote" (`UpvoteCount`) and "like"
 * (`LikeCount`) are **two different metrics** — this file keeps both apart
 * rather than merging them into one "likes" number.
 *
 * @module @veren/zhihu-client/types
 */

/** 内容类型：知乎的创作形态 / the content shapes Zhihu publishes */
export type ContentType = 'answer' | 'article' | 'video' | 'pin'

/** 全部内容类型 / every content type */
export const CONTENT_TYPES: readonly ContentType[] = ['answer', 'article', 'video', 'pin']

/**
 * 一条内容的引用（列表级信息，不含逐篇统计）。
 * One content reference (list-level facts, without the per-content stats).
 */
export interface ContentRef {
  /** 内容标识：从链接末段解析出的短 id / the content identifier: the short id parsed off the url's last segment */
  readonly contentId: string
  /** 内容类型 / the content type */
  readonly contentType: ContentType
  /** 标题 / the title */
  readonly title: string
  /** 公开链接（官方用它定位内容，也是列表项里的唯一标识）/ the public url (the official API locates content by it, and it is the list item's only identifier) */
  readonly url: string
  /** 摘要 / the excerpt */
  readonly summary?: string
  /** 发布时间（ISO 8601）/ the publish time (ISO 8601) */
  readonly createdAt?: string
  /** 列表里的喜欢数 / the like count on the list */
  readonly likeCount?: number
  /** 列表里的评论数 / the comment count on the list */
  readonly commentCount?: number
  /** 列表里的收藏数 / the collect count on the list */
  readonly collectCount?: number
}

/**
 * 单篇内容的统计快照（含官方给出的漏斗指标）。
 * One content's stats snapshot (including the funnel metrics the official
 * channel provides).
 */
export interface ContentStats {
  /** 内容标识 / the content identifier */
  readonly contentId: string
  /** 阅读量 / the view count */
  readonly viewCount?: number
  /** 曝光 UV（官方叫 PageShowUV）/ the exposure unique visitors (the official name is PageShowUV) */
  readonly exposureCount?: number
  /** 赞同数 / the upvote count */
  readonly upvoteCount?: number
  /** 喜欢数 / the like count */
  readonly likeCount?: number
  /** 评论数 / the comment count */
  readonly commentCount?: number
  /** 收藏数 / the collect count */
  readonly collectCount?: number
  /** 分享数 / the share count */
  readonly shareCount?: number
  /** 读完率（官方给的比值，0-1）/ the read-finished rate (the official ratio, 0-1) */
  readonly readFinishedRate?: number
  /** 点击率（官方给的比值，0-1）/ the click rate (the official ratio, 0-1) */
  readonly clickRate?: number
  /** 该篇带来的涨粉 / the followers this piece brought in */
  readonly followerGain?: number
  /** 涨粉转化率（官方给的比值）/ the follower conversion rate (the official ratio) */
  readonly followerConversionRate?: number
}

/**
 * 账号级统计快照。
 * The account-level stats snapshot.
 */
export interface AccountSnapshot {
  /** 粉丝总数 / total followers */
  readonly followerCount: number
  /** 关注总数 / total following */
  readonly followingCount: number
  /** 回答数 / answers published */
  readonly answerCount: number
  /** 文章数 / articles published */
  readonly articleCount: number
  /** 视频数 / videos published */
  readonly videoCount: number
  /** 累计获赞（喜欢）/ the lifetime likes received */
  readonly totalLikeCount: number
  /** 累计赞同 / the lifetime upvotes received */
  readonly totalUpvoteCount: number
  /** 累计阅读 / the lifetime views */
  readonly totalViewCount: number
  /** 快照时刻（ISO 8601）/ when the snapshot was taken */
  readonly collectedAt: string
}

/**
 * 一条评论。
 * One comment on a content.
 */
export interface CommentItem {
  /** 评论 id（大整数，官方用字符串精度承载）/ the comment id (a big integer the official contract carries as a string) */
  readonly commentId: string
  /** 评论者标识 / the commenter's token */
  readonly authorToken: string
  /** 评论正文（官方给的可能含 HTML 片段）/ the comment text (the official contract may hand over HTML fragments) */
  readonly content: string
  /** 获赞数 / likes on the comment */
  readonly likeCount: number
  /** 发表时间（ISO 8601）/ when it was written */
  readonly createdAt: string
}

/**
 * 热榜上的一条。
 * One entry of the hot list.
 */
export interface HotItem {
  /** 名次（1 起）/ the rank, starting at 1 */
  readonly rank: number
  /** 标题 / the title */
  readonly title: string
  /** 链接 / the url */
  readonly url: string
  /** 摘要 / the excerpt */
  readonly summary?: string
}

/**
 * 一条「适合回答的问题」——选题雷达的生料。
 * One answerable question — the raw material of the topic radar.
 */
export interface QuestionSuggestion {
  /** 问题标识：从链接末段解析出的短 id / the question identifier: the short id parsed off the url's last segment */
  readonly questionId: string
  /** 问题标题 / the question title */
  readonly title: string
  /** 链接 / the url */
  readonly url: string
}

/**
 * 配额状态：官方免费额度的读数。
 * The quota state: the reading of the platform's free allowance.
 */
export interface QuotaState {
  /** 总额度 / the total allowance */
  readonly total: number
  /** 已用 / how much is used */
  readonly used: number
  /** 剩余 / how much is left */
  readonly remaining: number
}
