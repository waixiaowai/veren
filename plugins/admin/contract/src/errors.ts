/**
 * Structured platform errors with stable codes and a fixed HTTP mapping.
 *
 * Every failure crossing an API or capability boundary is an {@link AdminError}
 * so the gateway can render `{ error: { code, message, details, requestId } }`
 * without guessing. Misconfiguration and contract violations use the same type
 * so boot diagnostics and HTTP responses share one vocabulary.
 *
 * 带稳定错误码与固定 HTTP 映射的结构化平台错误。跨 API 或能力边界的失败都是
 * {@link AdminError}，网关因此能直接输出 `{ error: { code, message, details,
 * requestId } }` 而不必猜测。配置错误与契约违例复用同一类型，使启动诊断与 HTTP
 * 响应共用一套词汇。
 *
 * @module @veren/admin-contract/errors
 */

/**
 * Stable error codes. Codes are part of the public contract: clients branch on
 * them, so renaming one is a breaking change.
 *
 * 稳定错误码。错误码属于公开契约：客户端按码分支，因此改名即为破坏性变更。
 */
export type AdminErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'CSRF_FAILED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'SETUP_REQUIRED'
  | 'ALREADY_INITIALIZED'
  | 'LAST_OWNER'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CONTRACT_INCOMPATIBLE'
  | 'PROVIDER_CONFLICT'
  | 'ESSENTIAL_CAPABILITY_MISSING'
  | 'BACKEND_UNAVAILABLE'
  | 'INTERNAL'

/** Machine-readable error context; always JSON-serializable. 机器可读的错误上下文，始终可 JSON 序列化。 */
export type AdminErrorDetails = Readonly<Record<string, unknown>>

/** HTTP status per code, kept in one table so responses never drift. 每个错误码对应的 HTTP 状态，集中一处以免响应漂移。 */
const STATUS_BY_CODE: Readonly<Record<AdminErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  SETUP_REQUIRED: 428,
  ALREADY_INITIALIZED: 409,
  LAST_OWNER: 409,
  CAPABILITY_UNAVAILABLE: 503,
  CONTRACT_INCOMPATIBLE: 500,
  PROVIDER_CONFLICT: 500,
  ESSENTIAL_CAPABILITY_MISSING: 500,
  BACKEND_UNAVAILABLE: 503,
  INTERNAL: 500,
}

/** One platform failure. 单个平台失败。 */
export class AdminError extends Error {
  /** Stable machine-readable code. 稳定的机器可读错误码。 */
  readonly code: AdminErrorCode
  /** Optional structured context merged into the API error body. 可选结构化上下文，合并进 API 错误体。 */
  readonly details: AdminErrorDetails | undefined
  /** HTTP status derived from {@link AdminError.code}. 由错误码推导的 HTTP 状态。 */
  readonly status: number
  /** Request correlation id, filled in by the API gateway. 请求关联 id，由 API 网关填充。 */
  requestId: string | undefined

  /**
   * @param code - stable error code 稳定错误码
   * @param message - human-readable English message 人类可读英文消息
   * @param details - optional structured context 可选结构化上下文
   */
  constructor(code: AdminErrorCode, message: string, details?: AdminErrorDetails) {
    super(message)
    this.name = 'AdminError'
    this.code = code
    this.details = details
    this.status = STATUS_BY_CODE[code]
  }
}

/**
 * Narrow an unknown thrown value to {@link AdminError}.
 *
 * @param error - any thrown value 任意抛出值
 * @returns true when the value is a platform error 是平台错误时为 true
 */
export function isAdminError(error: unknown): error is AdminError {
  return error instanceof AdminError
}

/**
 * Wrap an unknown failure as a platform error, keeping an existing one intact.
 *
 * @param error - any thrown value 任意抛出值
 * @returns the same platform error, or an `INTERNAL` wrapper 原平台错误或 `INTERNAL` 包装
 */
export function toAdminError(error: unknown): AdminError {
  if (isAdminError(error)) return error
  const message = error instanceof Error ? error.message : String(error)
  return new AdminError('INTERNAL', message)
}
