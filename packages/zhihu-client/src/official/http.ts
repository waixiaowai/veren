/**
 * 官方通道的 HTTP 传输层：注入式 fetch、超时、请求间隔节流、错误分类。
 *
 * 这一层只管"把一个请求安全地送出去并把结果读回来"：它不认识平台的业务
 * 字段，也不解平台信封——那是 `client.ts` 的活。分层的理由是让节流与错误
 * 分类只实现一次，也让测试能换掉网络。
 *
 * The HTTP transport for the official channel: an injectable fetch, a timeout,
 * a request-interval throttle, and error classification.
 *
 * This layer only "sends one request safely and reads the result back": it
 * knows no platform business field and unwraps no envelope — that is
 * `client.ts`'s job. The split keeps throttling and error classification
 * implemented once, and lets tests swap the network out.
 *
 * @module @veren/zhihu-client/official/http
 */
import { ZhihuError, ZhihuErrorCode } from '../errors.ts'

/** 传输层配置 / the transport configuration */
export interface TransportOptions {
  /** 平台基址 / the platform base url */
  readonly baseUrl: string
  /** 注入的 fetch 实现（测试用）/ the injected fetch implementation */
  readonly fetchImpl?: typeof fetch
  /** 单次请求超时（毫秒）/ the per-request timeout in milliseconds */
  readonly timeoutMs?: number
  /** 两次请求之间的最小间隔（毫秒）/ the minimum gap between two requests */
  readonly minIntervalMs?: number
}

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_INTERVAL_MS = 3_000

/** 等待一段毫秒 / wait for a number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * 一个串行化的 HTTP 传输：所有请求排成一条链，天然保证最小间隔。
 * A serialized HTTP transport: every request joins one chain, which
 * inherently guarantees the minimum interval.
 */
export class HttpTransport {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly minIntervalMs: number
  /** 排队的请求链 / the queued request chain */
  private chain: Promise<unknown> = Promise.resolve()
  /** 上一个请求开始的时刻 / when the previous request started */
  private lastStart = 0

  /**
   * @param options - the transport configuration / 传输层配置
   */
  constructor(options: TransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_INTERVAL_MS
  }

  /**
   * 发一个 GET 请求并返回解析后的 JSON 体（平台信封不拆）。
   * Sends one GET request and returns the parsed JSON body (envelopes intact).
   *
   * @param path - the request path / 请求路径
   * @param query - the query parameters / 查询参数
   * @param headers - the request headers / 请求头
   * @returns the parsed body / 解析后的响应体
   * @throws ZhihuError on transport, status, or parse failure / 传输、状态码或解析失败
   */
  async get(path: string, query: Readonly<Record<string, string>>, headers: Readonly<Record<string, string>>): Promise<unknown> {
    const run = this.chain.then(
      () => this.perform(path, query, headers),
      () => this.perform(path, query, headers),
    )
    this.chain = run.then(() => undefined, () => undefined)
    return await run
  }

  /** 真正执行一次请求：节流 → fetch → 状态分类 → 解析 / one request: throttle → fetch → classify → parse */
  private async perform(
    path: string,
    query: Readonly<Record<string, string>>,
    headers: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    await this.throttle()
    const url = this.urlOf(path, query)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (cause) {
      throw new ZhihuError(
        ZhihuErrorCode.Network,
        `request to ${path} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { endpoint: path },
      )
    }
    if (!response.ok) throw this.statusError(path, response)
    return await this.parse(path, response)
  }

  /** 节流：保证与上一个请求开始时刻相距至少最小间隔 / throttle: keep the gap from the previous request start */
  private async throttle(): Promise<void> {
    const wait = this.lastStart + this.minIntervalMs - Date.now()
    this.lastStart = Date.now() + Math.max(wait, 0)
    if (wait > 0) await sleep(wait)
  }

  /** 拼出完整 URL（跳过空参数）/ builds the full url (empty parameters skipped) */
  private urlOf(path: string, query: Readonly<Record<string, string>>): string {
    const entries = Object.entries(query).filter(([, value]) => value.length > 0)
    const search = entries.length === 0
      ? ''
      : `?${entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`
    return `${this.baseUrl}${path}${search}`
  }

  /** 状态码 → 结构化错误 / the status code → a structured error */
  private statusError(path: string, response: Response): ZhihuError {
    const status = response.status
    if (status === 401 || status === 403) {
      return new ZhihuError(ZhihuErrorCode.AuthRejected, `the platform rejected the credential (${status})`, { endpoint: path, status })
    }
    if (status === 429) {
      return new ZhihuError(ZhihuErrorCode.RateLimited, `the platform throttled the request (${status})`, { endpoint: path, status })
    }
    return new ZhihuError(ZhihuErrorCode.EndpointDrift, `the platform answered ${status} for ${path}`, { endpoint: path, status })
  }

  /** 解析响应体：非 JSON 是漂移，不是网络故障 / parses the body: non-JSON is drift, not a transport failure */
  private async parse(path: string, response: Response): Promise<unknown> {
    const text = await response.text()
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new ZhihuError(
        ZhihuErrorCode.InvalidResponse,
        `the platform answered ${path} with a non-JSON body: ${text.slice(0, 200)}`,
        { endpoint: path, status: response.status },
      )
    }
  }
}
