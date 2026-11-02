/**
 * 数据源端口：调用方依赖的是**能力**，不是某一个具体采集实现。
 *
 * v1 的实现是官方开放平台客户端；v2 要加的创作者中心 Cookie 采集是同一个
 * 端口的另一个实现。调用方（运营分析插件）只认这个端口，因此换采集通道
 * 时它一行都不用改。
 *
 * 注意两个按**链接**定位的接口（单篇统计、单篇评论）：官方契约里内容列表项
 * 没有独立 id，链接就是唯一标识，因此端口也按链接说话。
 *
 * The data-source port: callers depend on a capability, not on one collector.
 *
 * The v1 implementation is the official open-platform client; the v2 creator
 * center (cookie-based) collector is another implementation of the same port.
 * The operations-analysis plugin only knows this port, so swapping the
 * collection channel does not touch it.
 *
 * Note the two interfaces that locate content by its **url** (per-content
 * stats and comments): the official content list items carry no id of their
 * own, so the url is the only identifier — and the port speaks url too.
 *
 * @module @veren/zhihu-client/port
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
} from './types.ts'

/**
 * 一条知乎数据源：读账号、读内容、读评论、读热榜与选题、读配额。
 * One Zhihu data source: account, content, comments, hot list, topics, quota.
 */
export interface ZhihuDataSource {
  /** 数据源名字（诊断用，如 `official-open-platform`）/ the source's name (diagnostics) */
  readonly name: string
  /** 账号级统计快照 / the account-level stats snapshot */
  accountStats(): Promise<AccountSnapshot>
  /** 自己的内容列表（可按类型过滤）/ the author's own content list */
  contents(contentType?: ContentType, limit?: number): Promise<readonly ContentRef[]>
  /** 单篇统计（含漏斗指标）/ the per-content stats (including the funnel metrics) */
  contentStats(contentUrl: string): Promise<ContentStats>
  /** 单篇评论 / the comments of one content */
  comments(contentUrl: string, limit?: number): Promise<readonly CommentItem[]>
  /** 热榜 / the hot list */
  hotList(limit?: number): Promise<readonly HotItem[]>
  /** 适合回答的问题（选题雷达的生料）/ the answerable questions (the topic radar's raw material) */
  suggestedQuestions(limit?: number): Promise<readonly QuestionSuggestion[]>
  /** 剩余配额 / the remaining allowance */
  quota(): Promise<QuotaState>
}
