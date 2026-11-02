/**
 * 平台字段名 → 规范字段的映射表。
 *
 * 官方契约的键名首字母大写（`ViewCount`、`Followers`、`Items`），且不同端点
 * 的同名概念结构不同——账号统计与单篇统计各有一套 `Metrics`，字段集合不一样。
 * 因此映射表按端点分开，不共用一套。
 *
 * The platform field name → canonical field map.
 *
 * The official contract capitalizes its keys (`ViewCount`, `Followers`,
 * `Items`), and the same concept is structured differently per endpoint — the
 * account stats and the per-content stats each carry their own `Metrics` with
 * different field sets. So the maps are per endpoint rather than shared.
 *
 * @module @veren/zhihu-client/official/fields
 */

/** 信封键（首字母大写，写成小写运行时全 null）/ the envelope keys (capitalized; lowercase reads as all null) */
export const ENVELOPE_KEYS = {
  /** 业务码 / the business code */
  Code: 'Code',
  /** 消息 / the message */
  Message: 'Message',
  /** 载荷 / the payload */
  Data: 'Data',
} as const

/** 账号统计：粉丝段 / the account stats: the followers section */
export const ACCOUNT_FOLLOWERS_FIELDS = {
  total: ['Total'],
  yesterday: ['Yesterday', 'NetIncrease'],
} as const

/** 账号统计：创作计数段 / the account stats: the creation counts */
export const ACCOUNT_CREATION_FIELDS = {
  answer: ['Answer'],
  article: ['Article'],
  video: ['Video'],
} as const

/** 账号统计：指标段 / the account stats: the metrics */
export const ACCOUNT_METRICS_FIELDS = {
  viewCount: ['ViewCount'],
  upvoteCount: ['UpvoteCount'],
  likeCount: ['LikeCount'],
  commentCount: ['CommentCount'],
  collectCount: ['CollectCount'],
  shareCount: ['ShareCount'],
} as const

/** 内容列表条目的字段 / the content list entry fields */
export const CONTENT_FIELDS = {
  contentType: ['ContentType'],
  url: ['Url'],
  title: ['Title'],
  summary: ['Summary'],
  createdAt: ['CreatedAt'],
  likeCount: ['LikeCount'],
  commentCount: ['CommentCount'],
  favoriteCount: ['FavoriteCount'],
} as const

/** 单篇统计：指标段（比账号版多一批漏斗字段）/ the per-content stats: the metrics (a larger set than the account one) */
export const CONTENT_METRICS_FIELDS = {
  viewCount: ['ViewCount'],
  exposureCount: ['PageShowUV'],
  upvoteCount: ['UpvoteCount'],
  likeCount: ['LikeCount'],
  commentCount: ['CommentCount'],
  collectCount: ['CollectCount'],
  shareCount: ['ShareCount'],
  readFinishedRate: ['ReadFinishedRate'],
  clickRate: ['ClickRate'],
  followerGain: ['FollowerGain', 'NewFollowerCount'],
  followerConversionRate: ['FollowerConversionRate'],
} as const

/** 评论的字段（官方写作大写的 ID）/ the comment fields (the official contract writes a capitalized ID) */
export const COMMENT_FIELDS = {
  commentId: ['ID', 'Id'],
  content: ['Content'],
  likeCount: ['LikeCount'],
  dislikeCount: ['DislikeCount'],
  authorToken: ['AuthorToken'],
  createdAt: ['CreatedAt'],
} as const

/** 热榜条目的字段 / the hot list entry fields */
export const HOT_FIELDS = {
  title: ['Title'],
  url: ['Url'],
  summary: ['Summary'],
  thumbnailUrl: ['ThumbnailUrl'],
} as const

/** 选题建议的字段（官方只给标题与链接）/ the topic suggestion fields (the official contract gives only a title and a url) */
export const QUESTION_FIELDS = {
  title: ['Title'],
  url: ['Url'],
} as const

/** 配额读数的字段 / the quota reading fields */
export const QUOTA_FIELDS = {
  apiId: ['APIID'],
  apiName: ['APIName'],
  total: ['TotalQuota'],
  used: ['TotalUsed'],
  remaining: ['RemainingQuota'],
} as const

/** 载荷里的列表键 / the list key inside a payload */
export const LIST_KEYS = ['Items'] as const

/** 内容统计端点的"内容链接"参数名 / the "content url" parameter name of the content-stats endpoint */
export const CONTENT_URL_PARAM = 'ContentUrl'
