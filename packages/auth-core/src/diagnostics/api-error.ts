/**
 * APIError：诊断域的统一错误形态。
 * 错误以 `APIError.from(status, { code, message })` 抛出，HTTP 响应体携带
 * `code` / `message` / `status` 三键；内嵌调用抛出同型实例，`isAPIError`
 * 判定。状态名映射见设计文档 plugins/auth/design/errors.md §5.3。
 *
 * APIError: the unified error shape of the diagnostics domain. Errors are
 * thrown as `APIError.from(status, { code, message })`; the HTTP body carries
 * `code` / `message` / `status`. Embedded calls throw the same class and
 * `isAPIError` detects it. Status mapping: design errors.md §5.3.
 *
 * @module @veren/auth-core/diagnostics/api-error
 */

import { randomUUID } from 'node:crypto'

/** APIError 状态名。 / APIError status names. */
export type APIStatus =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_SERVER_ERROR'

/** 状态名 → HTTP 数字。 / Status name to HTTP number. */
const STATUS_NUMBERS: Record<APIStatus, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
}

/** 反查：HTTP 数字 → 状态名。 / Reverse lookup: HTTP number to status name. */
export function statusNameOf(status: number): APIStatus {
  for (const [name, value] of Object.entries(STATUS_NUMBERS)) {
    if (value === status) return name as APIStatus
  }
  return 'INTERNAL_SERVER_ERROR'
}

/** 错误响应体键集。 / The error response body keys. */
export interface APIErrorBody {
  /** 机器可读错误码。 / The machine-readable code. */
  code: string
  /** 用户可见文案。 / The user-facing message. */
  message: string
  /** HTTP 状态数字。 / The HTTP status number. */
  status: number
}

/** 端点错误的唯一载体。 / The single carrier of endpoint failures. */
export class APIError extends Error {
  readonly status: APIStatus
  readonly statusValue: number
  readonly code: string
  /** 关联请求 id：日志与响应体可对账。 / Correlation id for log/body matching. */
  readonly requestId: string
  /** 错误路径上需要保留的响应头（如已 Set-Cookie）。 / Headers preserved on the error path. */
  readonly headers: Headers

  constructor(status: APIStatus, body: { code: string, message: string }, headers?: Headers) {
    super(body.message)
    this.name = 'APIError'
    this.status = status
    this.statusValue = STATUS_NUMBERS[status]
    this.code = body.code
    this.requestId = randomUUID()
    this.headers = headers ?? new Headers()
  }

  /** 统一构造入口。 / The single construction entry. */
  static from(status: APIStatus, body: { code: string, message: string }, headers?: Headers): APIError {
    return new APIError(status, body, headers)
  }

  /** 便捷构造：按基础码抛出。 / Convenience: throw by base code. */
  static code(code: string, message?: string, status: APIStatus = 'BAD_REQUEST'): APIError {
    return new APIError(status, { code, message: message ?? code })
  }

  /** 响应体形态。 / The response body shape. */
  toBody(): APIErrorBody {
    return { code: this.code, message: this.message, status: this.statusValue }
  }

  /** 渲染为 JSON Response，附错误路径头。 / Render as a JSON Response with error-path headers. */
  toResponse(): Response {
    const headers = new Headers(this.headers)
    headers.set('content-type', 'application/json')
    headers.set('x-request-id', this.requestId)
    return new Response(JSON.stringify(this.toBody()), { status: this.statusValue, headers })
  }
}

/** 判定任意抛出物是否为 APIError。 / Whether a thrown value is an APIError. */
export function isAPIError(value: unknown): value is APIError {
  return value instanceof APIError
}

/** 抛出带请求头的 APIError。 / Throw an APIError carrying headers. */
export function throwWithHeaders(error: APIError, headers: Headers): never {
  throw APIError.from(error.status, { code: error.code, message: error.message }, headers)
}
