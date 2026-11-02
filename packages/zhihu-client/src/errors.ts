/**
 * 结构化错误面：稳定 code + 机器可读字段。
 *
 * 每个失败都归到一个稳定 code 上，调用方据此分支，不解析消息文本——消息是给
 * 人读的，code 是给程序读的。平台的业务错误码（`Code`）在这里映射成稳定
 * code，因此上游改了文案也不影响分支。
 *
 * The structured error face: a stable code plus machine-readable fields.
 *
 * Every failure lands on a stable code, so callers branch on the code and
 * never parse message text — the message is for humans, the code is for
 * programs. The platform's business codes (`Code`) map onto stable codes here,
 * so an upstream copy change never breaks a branch.
 *
 * @module @veren/zhihu-client/errors
 */

/** 稳定错误码 / the stable error codes */
export const ZhihuErrorCode = {
  /** 没配 Access Secret / no access secret is configured */
  AuthMissing: 'ZHIHU_AUTH_MISSING',
  /** 平台拒绝了凭据（HTTP 401/403 或业务码 20001）/ the platform rejected the credential */
  AuthRejected: 'ZHIHU_AUTH_REJECTED',
  /** 官方免费额度耗尽（业务码 30001/30002）/ the platform's free allowance is exhausted */
  QuotaExhausted: 'ZHIHU_QUOTA_EXHAUSTED',
  /** 本地日调用上限到了 / the local daily call cap is reached */
  DailyCapReached: 'ZHIHU_DAILY_CAP_REACHED',
  /** 被平台限流（HTTP 429 或业务码 30001）/ the platform throttled the client */
  RateLimited: 'ZHIHU_RATE_LIMITED',
  /** 平台风控拒绝（业务码 30003，官方要求不要立即重试）/ the platform's risk control refused it */
  RiskControlled: 'ZHIHU_RISK_CONTROLLED',
  /** 端点/字段漂移：响应形状对不上 / endpoint or field drift: the shape does not match */
  EndpointDrift: 'ZHIHU_ENDPOINT_DRIFT',
  /** 参数非法或内容不可用（业务码 10001）/ an illegal parameter or unavailable content */
  InvalidRequest: 'ZHIHU_INVALID_REQUEST',
  /** 网络层失败 / a transport failure */
  Network: 'ZHIHU_NETWORK',
  /** 响应不是合法 JSON / the response is not valid JSON */
  InvalidResponse: 'ZHIHU_INVALID_RESPONSE',
} as const

export type ZhihuErrorCode = (typeof ZhihuErrorCode)[keyof typeof ZhihuErrorCode]

/** 错误的机器可读明细：全是标量 id/数字，不放任意对象 / the machine-readable detail: scalars only */
export interface ZhihuErrorDetails {
  /** 涉及的端点名 / the endpoint name involved */
  readonly endpoint?: string
  /** HTTP 状态码 / the HTTP status code */
  readonly status?: number
  /** 平台业务码 / the platform business code */
  readonly platformCode?: number
  /** 本地日限额 / the local daily cap */
  readonly dailyCap?: number
  /** 本日已用调用数 / how many calls were made today */
  readonly usedToday?: number
}

/**
 * 知乎客户端的错误：带稳定 code 与机器可读明细。
 * The client error: a stable code plus machine-readable detail.
 */
export class ZhihuError extends Error {
  /** 稳定错误码 / the stable code */
  readonly code: ZhihuErrorCode
  /** 机器可读明细 / the machine-readable detail */
  readonly details: ZhihuErrorDetails

  /**
   * @param code - the stable code / 稳定错误码
   * @param message - the human-readable message / 人读消息
   * @param details - the machine-readable detail / 机器可读明细
   */
  constructor(code: ZhihuErrorCode, message: string, details: ZhihuErrorDetails = {}) {
    super(message)
    this.name = 'ZhihuError'
    this.code = code
    this.details = details
  }
}

/**
 * 平台业务码 → 稳定错误码。
 * The platform business code → the stable error code.
 *
 * @param platformCode - the envelope's `Code` / 信封里的业务码
 * @returns the stable code / 稳定错误码
 */
export function codeOfPlatform(platformCode: number): ZhihuErrorCode {
  if (platformCode === 10001) return ZhihuErrorCode.InvalidRequest
  if (platformCode === 20001) return ZhihuErrorCode.AuthRejected
  if (platformCode === 30001) return ZhihuErrorCode.RateLimited
  if (platformCode === 30002) return ZhihuErrorCode.QuotaExhausted
  if (platformCode === 30003) return ZhihuErrorCode.RiskControlled
  return ZhihuErrorCode.EndpointDrift
}

/**
 * 把任意抛出物折成结构化错误：已知错误原样保留，未知错误归入网络故障。
 * Folds any thrown value into a structured error: a known error passes
 * through, an unknown one becomes a transport failure.
 *
 * @param error - the thrown value / 被抛出的值
 * @param endpoint - the endpoint the call was making / 调用中的端点名
 * @returns the structured error / 结构化错误
 */
export function toZhihuError(error: unknown, endpoint?: string): ZhihuError {
  if (error instanceof ZhihuError) return error
  const message = error instanceof Error ? error.message : String(error)
  const details: ZhihuErrorDetails = endpoint === undefined ? {} : { endpoint }
  return new ZhihuError(ZhihuErrorCode.Network, message, details)
}
