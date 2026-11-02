/**
 * 官方开放平台的端点表——平台细节在本库里的**唯一**居所。
 *
 * 全部路径与查询参数名按官方 HTTP 契约逐字写死：上游改路径、改参数名、改信封，
 * 都只改这一个文件（连同 `fields.ts` 的字段映射）。其余代码只认规范类型，
 * 因此平台漂移不会扩散成全库返工。
 *
 * The official open platform's endpoint table — the **only** place platform
 * details live in this library.
 *
 * Every path and query-parameter name is written verbatim from the official
 * HTTP contract: when upstream changes a path, a parameter name, or the
 * envelope, only this file (plus the field map in `fields.ts`) changes.
 * Everything else knows only the canonical types, so platform drift never
 * spreads across the library.
 *
 * @module @veren/zhihu-client/official/endpoints
 */

/** 平台基址（官方 v0.1 服务域名固定）/ the platform base url (the official v0.1 service domain is fixed) */
export const PLATFORM_BASE_URL = 'https://developer.zhihu.com'

/** 平台 API 版本前缀 / the platform api version prefix */
export const API_PREFIX = '/api/v1'

/** 端点名（诊断与预算记账用）/ the endpoint names (diagnostics and budget bookkeeping) */
export const EndpointName = {
  /** 账号统计 / the account stats */
  AccountStats: 'account-stats',
  /** 本人内容列表 / the author's own content list */
  Contents: 'contents',
  /** 单篇创作数据（漏斗指标在这里）/ the per-content creation stats (the funnel metrics live here) */
  ContentStats: 'content-stats',
  /** 本人作品的评论 / the comments on the author's own works */
  Comments: 'comments',
  /** 热榜 / the hot list */
  HotList: 'hot-list',
  /** 适合回答的问题（问题发现）/ the answerable questions (question discovery) */
  Questions: 'questions',
  /** 配额 / the allowance */
  Quota: 'quota',
} as const

export type EndpointName = (typeof EndpointName)[keyof typeof EndpointName]

/** 端点路径表：名字 → 相对路径 / the endpoint path table: name → relative path */
export const ENDPOINT_PATHS: Readonly<Record<EndpointName, string>> = {
  [EndpointName.AccountStats]: `${API_PREFIX}/user/creator_account_stats`,
  [EndpointName.Contents]: `${API_PREFIX}/user/contents`,
  [EndpointName.ContentStats]: `${API_PREFIX}/user/creator_content_stats`,
  [EndpointName.Comments]: `${API_PREFIX}/user/content_comments`,
  [EndpointName.HotList]: `${API_PREFIX}/content/hot_list`,
  [EndpointName.Questions]: `${API_PREFIX}/user/question_recommendations`,
  [EndpointName.Quota]: `${API_PREFIX}/quota`,
}

/**
 * 各端点消耗的额度组——配额读数按组给出，因此本地账本也按组记账。
 * The quota group each endpoint spends — the allowance reading is per group,
 * so the local ledger counts per group too.
 */
export const QUOTA_API_IDS: Readonly<Record<EndpointName, string>> = {
  [EndpointName.AccountStats]: 'creator',
  [EndpointName.Contents]: 'user_data',
  [EndpointName.ContentStats]: 'creator',
  [EndpointName.Comments]: 'creator',
  [EndpointName.HotList]: 'hot_list',
  [EndpointName.Questions]: 'question_discovery',
  [EndpointName.Quota]: 'global_search',
}

/** 鉴权头：标准 Bearer 形式（Access Secret 走这个头）/ the auth header: the standard Bearer form */
export const AUTH_HEADER = 'Authorization'

/** 时间戳头：秒级 Unix 时间戳，与服务器时间相差不得超过十分钟 / the timestamp header: epoch seconds, within ten minutes of the server clock */
export const TIMESTAMP_HEADER = 'X-Request-Timestamp'

/** 查询参数名（端点共享，逐字取自官方契约）/ the query parameter names (shared by the endpoints, verbatim from the official contract) */
export const QueryParam = {
  /** 内容类型过滤 / the content type filter */
  ContentType: 'ContentType',
  /** 分页偏移 / the pagination offset */
  Offset: 'Offset',
  /** 条数上限 / the row limit */
  Limit: 'Limit',
  /** 内容链接（单篇端点用它定位内容）/ the content url (the per-content endpoints locate content by it) */
  ContentUrl: 'ContentUrl',
  /** 起始日期 / the start date */
  StartDate: 'StartDate',
  /** 结束日期 / the end date */
  EndDate: 'EndDate',
  /** 条数上限（问题发现端点）/ the row limit (the question-discovery endpoint) */
  Count: 'Count',
  /** 主题关键词（问题发现端点）/ the topic keyword (the question-discovery endpoint) */
  Query: 'Query',
  /** 额度组（配额端点）/ the allowance groups (the quota endpoint) */
  APIIDs: 'APIIDs',
  /** 排序字段 / the sort field */
  SortField: 'SortField',
  /** 排序方向 / the sort order */
  SortOrder: 'SortOrder',
  /** 评论排序 / the comment order */
  Order: 'Order',
} as const

/** 平台对"所有内容"的过滤值 / the platform's value for "every content type" */
export const CONTENT_TYPE_ALL = 'all'

/** 平台侧的内容类型取值 → 规范内容类型 / the platform's content-type values → the canonical content types */
export const PLATFORM_CONTENT_TYPES: Readonly<Record<string, string>> = {
  answer: 'answer',
  article: 'article',
  zvideo: 'video',
  video: 'video',
  pin: 'pin',
  question: 'question',
}
