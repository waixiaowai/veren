/**
 * 官方开放平台客户端：`ZhihuDataSource` 的 v1 实现。
 *
 * 职责边界：这个类只做"发请求 → 归一化 → 返回规范类型"。它不认识存储、不认识
 * 调度、不认识模型——那些是调用方（运营分析插件）的活。
 *
 * 鉴权两件套：`Authorization: Bearer <secret>` 与每次现取的
 * `X-Request-Timestamp`（秒级；与服务器时间相差不得超过十分钟，因此绝不缓存）。
 *
 * The official open-platform client: the v1 implementation of `ZhihuDataSource`.
 *
 * The responsibility boundary: this class only "send a request → normalize →
 * return canonical types". It knows nothing about storage, scheduling, or
 * models — those belong to the caller (the operations-analysis plugin).
 *
 * Two authentication pieces: `Authorization: Bearer <secret>` and a freshly
 * taken `X-Request-Timestamp` (epoch seconds; it must stay within ten minutes
 * of the server clock, so it is never cached).
 *
 * @module @veren/zhihu-client/official/client
 */
import type { ZhihuDataSource } from '../port.ts'
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
import { ZhihuError, ZhihuErrorCode, codeOfPlatform } from '../errors.ts'
import { DailyCallBudget } from './budget.ts'
import {
  AUTH_HEADER,
  CONTENT_TYPE_ALL,
  ENDPOINT_PATHS,
  EndpointName,
  PLATFORM_BASE_URL,
  QueryParam,
  TIMESTAMP_HEADER,
} from './endpoints.ts'
import { ENVELOPE_KEYS } from './fields.ts'
import { HttpTransport } from './http.ts'
import {
  asRows,
  normalizeAccountStats,
  normalizeComment,
  normalizeContentRef,
  normalizeContentStats,
  normalizeHotItem,
  normalizeQuestion,
  normalizeQuota,
  unwrapPayload,
} from './normalize.ts'

/** 客户端配置 / the client configuration */
export interface OfficialClientOptions {
  /** 平台 Access Secret（开发者中心创建）/ the platform access secret */
  readonly accessSecret: string
  /** 平台基址；缺省用端点表里的 / the platform base url; the endpoint table's by default */
  readonly baseUrl?: string
  /** 注入的 fetch 实现 / the injected fetch implementation */
  readonly fetchImpl?: typeof fetch
  /** 单次请求超时（毫秒）/ the per-request timeout */
  readonly timeoutMs?: number
  /** 请求间隔（毫秒）/ the request interval */
  readonly minIntervalMs?: number
  /** 本地日调用上限；0 = 不限 / the local daily call cap; 0 = unlimited */
  readonly dailyCallLimit?: number
  /** 钟面来源（注入以便测试）/ the clock source (injected for tests) */
  readonly now?: () => number
}

/** 一次采集里每类数据的默认条数上限 / the default row caps per pull */
const DEFAULT_CONTENT_LIMIT = 20
const DEFAULT_COMMENT_LIMIT = 30
const DEFAULT_HOT_LIMIT = 30
const DEFAULT_QUESTION_LIMIT = 10

/**
 * 官方开放平台的数据源实现。
 * The official open-platform data source.
 */
export class OfficialZhihuClient implements ZhihuDataSource {
  /** 数据源名字 / the source name */
  readonly name = 'official-open-platform'
  private readonly accessSecret: string
  private readonly transport: HttpTransport
  private readonly budget: DailyCallBudget
  private readonly now: () => number
  /** 当日缓存的平台配额读数 / the platform quota reading cached for the day */
  private cachedQuota: QuotaState | undefined

  /**
   * @param options - the client configuration / 客户端配置
   */
  constructor(options: OfficialClientOptions) {
    this.accessSecret = options.accessSecret
    this.now = options.now ?? (() => Date.now())
    this.budget = new DailyCallBudget(options.dailyCallLimit ?? 0, this.now)
    this.transport = new HttpTransport({
      baseUrl: options.baseUrl ?? PLATFORM_BASE_URL,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.minIntervalMs === undefined ? {} : { minIntervalMs: options.minIntervalMs }),
    })
  }

  /** 账号级统计快照 / the account-level stats snapshot */
  async accountStats(): Promise<AccountSnapshot> {
    const body = await this.call(EndpointName.AccountStats, { [QueryParam.ContentType]: CONTENT_TYPE_ALL })
    return normalizeAccountStats(body, this.isoNow())
  }

  /** 自己的内容列表 / the author's own content list */
  async contents(contentType?: ContentType, limit: number = DEFAULT_CONTENT_LIMIT): Promise<readonly ContentRef[]> {
    const query: Record<string, string> = {
      [QueryParam.ContentType]: contentType === undefined ? CONTENT_TYPE_ALL : contentType,
      [QueryParam.Limit]: String(limit),
    }
    const body = await this.call(EndpointName.Contents, query)
    return asRows(unwrapPayload(body)).map(normalizeContentRef).filter((ref): ref is ContentRef => ref !== undefined)
  }

  /** 单篇统计（漏斗指标在这里）/ the per-content stats (the funnel metrics live here) */
  async contentStats(contentUrl: string): Promise<ContentStats> {
    const body = await this.call(EndpointName.ContentStats, { [QueryParam.ContentUrl]: contentUrl })
    return normalizeContentStats(body, contentUrl)
  }

  /** 单篇评论 / the comments of one content */
  async comments(contentUrl: string, limit: number = DEFAULT_COMMENT_LIMIT): Promise<readonly CommentItem[]> {
    const body = await this.call(EndpointName.Comments, {
      [QueryParam.ContentUrl]: contentUrl,
      [QueryParam.Limit]: String(limit),
    })
    return asRows(unwrapPayload(body)).map(normalizeComment).filter((item): item is CommentItem => item !== undefined)
  }

  /** 热榜 / the hot list */
  async hotList(limit: number = DEFAULT_HOT_LIMIT): Promise<readonly HotItem[]> {
    const body = await this.call(EndpointName.HotList, { [QueryParam.Limit]: String(limit) })
    return asRows(unwrapPayload(body))
      .map((row, index) => normalizeHotItem(row, index + 1))
      .filter((item): item is HotItem => item !== undefined)
  }

  /** 适合回答的问题 / the answerable questions */
  async suggestedQuestions(limit: number = DEFAULT_QUESTION_LIMIT): Promise<readonly QuestionSuggestion[]> {
    const body = await this.call(EndpointName.Questions, { [QueryParam.Count]: String(limit) })
    return asRows(unwrapPayload(body)).map(normalizeQuestion).filter((item): item is QuestionSuggestion => item !== undefined)
  }

  /** 剩余配额 / the remaining allowance */
  async quota(): Promise<QuotaState> {
    const body = await this.call(EndpointName.Quota, {})
    this.cachedQuota = normalizeQuota(body)
    return this.cachedQuota
  }

  /** 本地日已用调用数 / how many calls the local budget spent today */
  usedToday(): number {
    return this.budget.usedToday()
  }

  /**
   * 发一次带鉴权的请求：先过本地预算，再过平台配额闸门，最后拆信封判业务码。
   * Sends one authenticated request: the local budget first, then the platform
   * quota gate, then the envelope's business code.
   */
  private async call(name: EndpointName, query: Readonly<Record<string, string>>): Promise<unknown> {
    this.budget.consume(name)
    await this.assertQuotaLeft(name)
    const headers = this.headers()
    const body = await this.transport.get(ENDPOINT_PATHS[name], query, headers)
    this.assertBusinessCode(name, body)
    return body
  }

  /** 鉴权头 + 现取的时间戳头 / the auth header plus the freshly taken timestamp header */
  private headers(): Record<string, string> {
    return {
      [AUTH_HEADER]: `Bearer ${this.accessSecret}`,
      [TIMESTAMP_HEADER]: String(Math.floor(this.now() / 1000)),
    }
  }

  /** 平台业务码 → 结构化错误 / the platform business code → a structured error */
  private assertBusinessCode(name: EndpointName, body: unknown): void {
    const record = body as Record<string, unknown> | undefined
    const raw = record?.[ENVELOPE_KEYS.Code]
    if (typeof raw !== 'number' || raw === 0) return
    const message = typeof record?.[ENVELOPE_KEYS.Message] === 'string'
      ? String(record?.[ENVELOPE_KEYS.Message])
      : `the platform answered code ${raw}`
    throw new ZhihuError(codeOfPlatform(raw), message, { endpoint: name, platformCode: raw })
  }

  /** 平台配额闸门：当日读数为 0 时响亮地停 / the platform quota gate: a zero daily reading stops the pull loudly */
  private async assertQuotaLeft(name: EndpointName): Promise<void> {
    if (this.cachedQuota !== undefined && this.cachedQuota.remaining <= 0) {
      throw new ZhihuError(
        ZhihuErrorCode.QuotaExhausted,
        'the platform reported no remaining quota today; the pull stops here',
        { endpoint: name },
      )
    }
  }

  /** 当前时刻的 ISO 串 / the current instant as an ISO string */
  private isoNow(): string {
    return new Date(this.now()).toISOString()
  }
}
