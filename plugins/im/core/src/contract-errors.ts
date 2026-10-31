/**
 * Structured IM failures: the stable error-code union and the one error class
 * every IM failure is carried by.
 *
 * 结构化 IM 失败：稳定的错误码联合与承载一切 IM 失败的唯一错误类。
 *
 * @module @veren/im/contract-errors
 */

/** Stable error codes a provider or the router may refuse with. */
/** provider 或路由可以拒绝时使用的稳定错误码。 */
export type ImErrorCode =
  | 'IM_INVALID_REQUEST'
  | 'IM_UNSUPPORTED'
  | 'IM_AUTH_REQUIRED'
  | 'IM_BIND_PENDING'
  | 'IM_BIND_EXPIRED'
  | 'IM_NOT_FOUND'
  | 'IM_AMBIGUOUS'
  | 'IM_NO_ADDRESS'
  | 'IM_SEND_REJECTED'
  | 'IM_RATE_LIMITED'
  | 'IM_DELIVERY_UNCERTAIN'
  | 'IM_INTERNAL'

/** One structured IM failure; callers branch on `code` only. */
/** 一个结构化 IM 失败；调用方只按 `code` 分支。 */
export class ImError extends Error {
  /** Stable machine-readable reason. */
  /** 稳定的机器可读原因。 */
  readonly code: ImErrorCode
  /** Provider-native code, when the provider has one. */
  /** provider 原生码（若 provider 提供）。 */
  readonly providerCode?: string
  /** JSON-safe machine-readable fields (candidates, suggestions, and so on). */
  /** JSON 安全的机器可读字段（候选、建议等）。 */
  readonly details?: Readonly<Record<string, unknown>>

  /**
   * @param code - stable machine-readable reason.
   * @param message - human-readable account of the failure.
   * @param options - optional cause, provider-native code, and structured details.
   */
  constructor(
    code: ImErrorCode,
    message: string,
    options: { cause?: unknown; providerCode?: string; details?: Record<string, unknown> } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'ImError'
    this.code = code
    if (options.providerCode !== undefined) this.providerCode = options.providerCode
    if (options.details !== undefined) this.details = options.details
  }
}
