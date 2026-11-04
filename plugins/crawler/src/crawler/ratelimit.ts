/**
 * 限频分类与退避重试（design/modules/crawler.md §4 失败分支）。
 * Rate-limit classification and backoff retry (crawler.md §4 failure
 * branches).
 *
 * 平台限频与封禁类错误优先走恢复路径（退避重试），只有恢复失败才作为
 * 终态错误上抛；封禁类错误直接上抛终止当前关键词。
 * Rate-limit errors recover via backoff and rethrow only when retries are
 * exhausted; block errors abort the current keyword immediately.
 *
 * @module @veren/crawler/crawler/ratelimit
 */
import { CrawlerError } from '../errors.ts'
import type { CrawlerErrorCode } from '../errors.ts'

/** 平台响应的机器可读分类信号 / machine-readable classification signals of a platform response */
export interface PlatformResponseSignal {
  /** HTTP 状态码 / the http status code */
  httpStatus: number
  /** 平台业务码 / the platform business code if any */
  bizCode?: number | null
}

/** 可恢复重试的错误码集合 / the retryable error-code set */
const RETRYABLE_CODES: ReadonlySet<CrawlerErrorCode> = new Set(['RATE_LIMITED', 'SESSION_EXPIRED'])

/** 非法参数类错误码（退避无意义）/ argument-class codes (backoff is meaningless) */
const FATAL_CODES: ReadonlySet<CrawlerErrorCode> = new Set(['IP_BLOCKED', 'PLATFORM_ACCESS_DENIED', 'CONTENT_NOT_FOUND'])

/**
 * 平台响应 → 稳定错误码：限频 / 封禁 / 拒绝 / 内容不存在。
 * Maps a platform response onto a stable error code.
 */
export function classifyPlatformResponse(signal: PlatformResponseSignal): CrawlerErrorCode | null {
  if (signal.httpStatus === 429) return 'RATE_LIMITED'
  if (signal.httpStatus === 403) return 'IP_BLOCKED'
  if (signal.httpStatus === 401) return 'SESSION_EXPIRED'
  if (signal.httpStatus === 404) return 'CONTENT_NOT_FOUND'
  return null
}

/** 错误是否可退避重试 / whether the error is retryable via backoff */
export function isRetryable(error: CrawlerError): boolean {
  return RETRYABLE_CODES.has(error.code)
}

/** 错误是否为封禁类终态（终止当前关键词）/ whether the error is a fatal block aborting the keyword */
export function isFatal(error: CrawlerError): boolean {
  return FATAL_CODES.has(error.code)
}

/** 退避重试选项 / backoff retry options */
export interface RetryOptions {
  /** 最大重试次数 / max retries */
  maxRetries: number
  /** 首次退避毫秒 / the first backoff in ms */
  baseDelayMs: number
  /** 退避倍率 / the backoff multiplier */
  factor: number
  /** 休眠实现（测试注入）/ the sleep implementation (injected in tests) */
  sleep: (ms: number) => Promise<void>
}

/** 毫秒休眠默认实现 / the default sleep */
export const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 默认重试参数 / the default retry parameters */
export const DEFAULT_RETRY: RetryOptions = { maxRetries: 3, baseDelayMs: 1000, factor: 2, sleep: defaultSleep }

/**
 * 可恢复重试包装：限频/会话过期指数退避后重试；封禁类立即上抛；
 * 非限频错误直接上抛。
 * The retryable wrapper: rate-limit/session-expiry retries with exponential
 * backoff; fatal blocks rethrow at once; everything else rethrows.
 */
export async function retryable<T>(task: () => Promise<T>, options: RetryOptions = DEFAULT_RETRY): Promise<T> {
  let lastError: CrawlerError | null = null
  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      if (!(error instanceof CrawlerError)) throw error
      if (isFatal(error) || !isRetryable(error)) throw error
      lastError = error
      if (attempt < options.maxRetries) {
        await options.sleep(options.baseDelayMs * options.factor ** attempt)
      }
    }
  }
  throw lastError
}
