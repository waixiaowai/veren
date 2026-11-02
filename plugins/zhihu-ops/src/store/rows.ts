/**
 * 持久行的形状与 zod schema——存储域的记录契约。
 *
 * 字段全用 snake_case（与 im 域一致），且**新增字段一律可选**：这样采集功能
 * 之前写下的文件仍能打开，不丢记录。提升版本会直接拒绝那个文件，而不是
 * 迁移它。
 *
 * The durable row shapes and their zod schemas — the storage domain's record
 * contract.
 *
 * Fields are snake_case (like the `im` domain) and every added field is
 * optional: a file written before a feature landed still opens without
 * discarding records. Bumping the version would reject that file instead of
 * migrating it.
 *
 * @module @veren/zhihu-ops/store/rows
 */
import { z } from 'zod'

/** 一次采集的结果状态 / the outcome state of one pull */
export const PullState = z.enum(['ok', 'partial', 'failed', 'skipped'])
export type PullState = z.infer<typeof PullState>

/** 一次采集的记录 / one pull run */
export const pullRunSchema = z.object({
  /** 采集日（本地日期键）/ the pull day (local date key) */
  day: z.string().min(1),
  /** 状态 / the outcome state */
  state: PullState,
  /** 采集到的账号统计 / the account stats collected */
  follower_count: z.number().optional(),
  /** 本次采集读到的内容数 / how many contents this pull read */
  content_count: z.number().optional(),
  /** 本次采集发出的请求数 / how many requests this pull made */
  request_count: z.number().optional(),
  /** 结束原因（失败或跳过时）/ why it ended (on failure or skip) */
  reason: z.string().optional(),
  /** 采集时刻 / when the pull ran */
  collected_at: z.string().min(1),
})

/** 账号统计的日快照 / the account stats day snapshot */
export const accountStatsSchema = z.object({
  /** 快照日 / the snapshot day */
  day: z.string().min(1),
  /** 粉丝总数 / total followers */
  follower_count: z.number(),
  /** 关注总数 / total following */
  following_count: z.number(),
  /** 回答数 / answers published */
  answer_count: z.number(),
  /** 文章数 / articles published */
  article_count: z.number(),
  /** 视频数 / videos published */
  video_count: z.number(),
  /** 累计获赞 / lifetime likes */
  total_like_count: z.number(),
  /** 与前一天的粉丝差（正为涨）/ the follower delta from the previous day */
  follower_delta: z.number().optional(),
  /** 采集时刻 / when it was collected */
  collected_at: z.string().min(1),
})

/** 一条内容的档案（跨天稳定）/ one content's profile (stable across days) */
export const contentSchema = z.object({
  /** 内容 id / the content id */
  content_id: z.string().min(1),
  /** 内容类型 / the content type */
  content_type: z.enum(['answer', 'article', 'video', 'pin']),
  /** 标题 / the title */
  title: z.string(),
  /** 链接 / the url */
  url: z.string().optional(),
  /** 首次见到它的那天 / the day it was first seen */
  first_seen_day: z.string().min(1),
  /** 最后一次更新的那天 / the day it was last updated */
  updated_day: z.string().min(1),
  /** 发布时间 / the publish time */
  created_at: z.string().optional(),
})

/** 单篇统计的日快照 / the per-content stats day snapshot */
export const contentStatsSchema = z.object({
  /** 快照日 / the snapshot day */
  day: z.string().min(1),
  /** 内容 id / the content id */
  content_id: z.string().min(1),
  /** 阅读量 / the view count */
  view_count: z.number().optional(),
  /** 曝光 UV（官方叫 PageShowUV）/ the exposure unique visitors */
  exposure_count: z.number().optional(),
  /** 赞同数 / the upvote count */
  upvote_count: z.number().optional(),
  /** 喜欢数 / the like count */
  like_count: z.number().optional(),
  /** 评论数 / the comment count */
  comment_count: z.number().optional(),
  /** 收藏数 / the collect count */
  collect_count: z.number().optional(),
  /** 分享数 / the share count */
  share_count: z.number().optional(),
  /** 读完率（官方比值 0-1）/ the read-finished rate (the official ratio, 0-1) */
  read_finished_rate: z.number().optional(),
  /** 该篇带来的涨粉 / the followers this piece brought in */
  follower_gain: z.number().optional(),
  /** 涨粉转化率（官方比值）/ the follower conversion rate (the official ratio) */
  follower_conversion_rate: z.number().optional(),
  /** 与前一天的阅读差 / the view delta from the previous day */
  view_delta: z.number().optional(),
  /** 采集时刻 / when it was collected */
  collected_at: z.string().min(1),
})

/** 一条评论的存档 / one archived comment */
export const commentSchema = z.object({
  /** 评论 id / the comment id */
  comment_id: z.string().min(1),
  /** 所属内容 id / the owning content id */
  content_id: z.string().min(1),
  /** 评论者标识 / the commenter's token */
  author_token: z.string(),
  /** 正文 / the text */
  content: z.string(),
  /** 获赞数 / likes on the comment */
  like_count: z.number(),
  /** 发表时间 / when it was written */
  created_at: z.string().min(1),
  /** 采集日 / the day it was collected */
  day: z.string().min(1),
})

/** 热榜的一条日快照 / one hot list entry, per day */
export const hotItemSchema = z.object({
  /** 快照日 / the snapshot day */
  day: z.string().min(1),
  /** 名次 / the rank */
  rank: z.number(),
  /** 标题 / the title */
  title: z.string(),
  /** 链接 / the url */
  url: z.string(),
  /** 摘要 / the excerpt */
  excerpt: z.string().optional(),
})

/** 一条选题建议的日快照 / one topic suggestion, per day */
export const questionSchema = z.object({
  /** 快照日 / the snapshot day */
  day: z.string().min(1),
  /** 问题 id / the question id */
  question_id: z.string().min(1),
  /** 标题 / the title */
  title: z.string(),
  /** 链接 / the url */
  url: z.string(),
})

/** 一份分析报告 / one analysis report */
export const reportSchema = z.object({
  /** 报告 id / the report id */
  report_id: z.string().min(1),
  /** 报告覆盖的日期键 / the date key the report covers */
  day: z.string().min(1),
  /** 标题 / the title */
  title: z.string(),
  /** 正文（Markdown）/ the body (Markdown) */
  body: z.string(),
  /** 覆盖的数据天数 / how many days of data it covers */
  window_days: z.number(),
  /** 生成时刻 / when it was written */
  generated_at: z.string().min(1),
  /** 投递到的页面 URL / the page url it was delivered to */
  target_url: z.string().optional(),
})
