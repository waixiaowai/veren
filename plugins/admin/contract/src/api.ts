/**
 * The unified API surface: routes, requests, responses and wire envelopes.
 *
 * Every provider and module registers through this vocabulary, so authentication,
 * permissions, validation, auditing, pagination and OpenAPI generation stay in
 * one gateway instead of being re-implemented per endpoint.
 *
 * 统一 API 面：路由、请求、响应与线上信封。每个 provider 与模块都通过这套词汇注册，
 * 因此认证、权限、校验、审计、分页与 OpenAPI 生成集中在一个网关里，而不是逐端点重写。
 *
 * @module @veren/admin-contract/api
 */

import type { AuthenticatedPrincipal } from './capabilities.ts'

/**
 * Browser session cookie name. Shared by the gateway, the auth provider and the
 * SPA, so one constant prevents three copies drifting apart.
 *
 * 浏览器会话 Cookie 名。网关、认证 provider 与 SPA 共用一处常量，避免三份漂移。
 */
export const ADMIN_SESSION_COOKIE = 'admin_session'

/** Double-submit CSRF cookie name. 双提交 CSRF Cookie 名。 */
export const ADMIN_CSRF_COOKIE = 'admin_csrf'

/** CSRF request header name. CSRF 请求头名。 */
export const ADMIN_CSRF_HEADER = 'x-csrf-token'

/** Who may call a route; each audience has its own path prefix and authentication. 谁可以调用该路由；每个受众有独立路径前缀与认证方式。 */
export type ApiAudience = 'admin' | 'terminal' | 'public'

/** Supported HTTP methods. 支持的 HTTP 方法。 */
export type AdminHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Structural validation contract. Zod schemas satisfy it, so the contract
 * package stays dependency-free while callers keep full Zod ergonomics.
 *
 * 结构化校验契约。Zod schema 天然满足该结构，因此契约包保持零依赖，调用方仍获得完整
 * 的 Zod 体验。
 */
export interface AdminSchema<T = unknown> {
  /**
   * Parse and validate one untrusted value.
   * @param input - untrusted value 不可信输入
   * @returns the validated value 校验后的值
   */
  parse(input: unknown): T
}

/** Cookie attributes the gateway understands. 网关支持的 Cookie 属性。 */
export interface CookieOptions {
  /** Hide the cookie from `document.cookie`. 对 `document.cookie` 隐藏。 */
  readonly httpOnly?: boolean
  /** Send only over TLS. 仅通过 TLS 发送。 */
  readonly secure?: boolean
  /** Cross-site policy. 跨站策略。 */
  readonly sameSite?: 'Lax' | 'Strict' | 'None'
  /** Cookie path scope. Cookie 路径范围。 */
  readonly path?: string
  /** Lifetime in seconds. 生命周期（秒）。 */
  readonly maxAgeSeconds?: number
}

/** The authenticated principal attached to a request, if any. 请求携带的已认证主体（如有）。 */
export interface AdminRouteContext {
  /** Normalized request facts. 归一化的请求事实。 */
  readonly request: AdminRequest
  /** Response controls the handler may use before returning its payload. handler 返回载荷前可用的响应控制。 */
  readonly response: AdminResponse
}

/** One request as the pipeline presents it to a handler. 管道向 handler 呈现的单个请求。 */
export interface AdminRequest {
  /** Correlation id echoed in every error and audit row. 每个错误与审计行都会回显的关联 id。 */
  readonly requestId: string
  /** Request method. 请求方法。 */
  readonly method: AdminHttpMethod
  /** Route-relative path with the audience prefix removed. 去掉受众前缀的路由相对路径。 */
  readonly path: string
  /** Path parameters captured by the route pattern. 路由模式捕获的路径参数。 */
  readonly params: Readonly<Record<string, string>>
  /** Raw query string parameters. 原始查询参数。 */
  readonly query: URLSearchParams
  /** Lower-cased request headers. 小写化的请求头。 */
  readonly headers: Readonly<Record<string, string>>
  /** Validated JSON body, or `undefined` for bodyless methods. 已校验的 JSON 请求体；无体方法为 `undefined`。 */
  readonly body: unknown
  /** Resolved principal, when the route is authenticated. 已解析主体（路由需认证时）。 */
  readonly principal: AuthenticatedPrincipal | undefined
  /** Audience of the matched route. 匹配路由的受众。 */
  readonly audience: ApiAudience
  /** Peer address used for rate limiting and audit. 用于限流与审计的对端地址。 */
  readonly ip: string

  /**
   * Read one request cookie.
   * @param name - cookie name Cookie 名
   * @returns the decoded value, or `undefined` 解码值或 `undefined`
   */
  cookie(name: string): string | undefined

  /**
   * Read one lower-cased request header.
   * @param name - header name 请求头名
   * @returns the value, or `undefined` 值或 `undefined`
   */
  header(name: string): string | undefined
}

/** Response controls available to a handler. handler 可用的响应控制。 */
export interface AdminResponse {
  /**
   * Attach one `Set-Cookie` header.
   * @param name - cookie name Cookie 名
   * @param value - cookie value Cookie 值
   * @param options - cookie attributes Cookie 属性
   */
  setCookie(name: string, value: string, options?: CookieOptions): void

  /**
   * Expire one cookie.
   * @param name - cookie name Cookie 名
   */
  clearCookie(name: string): void

  /**
   * Attach one response header.
   * @param name - header name 响应头名
   * @param value - header value 响应头值
   */
  setHeader(name: string, value: string): void
}

/** One registered route. 一条注册路由。 */
export interface AdminRoute {
  /** HTTP method. HTTP 方法。 */
  readonly method: AdminHttpMethod
  /** Route path relative to the audience prefix, with `:param` segments. 相对受众前缀的路由路径，支持 `:param` 段。 */
  readonly path: string
  /** Caller audience. 调用方受众。 */
  readonly audience: ApiAudience
  /** Required permission, enforced server-side. 必填权限，在服务端强制执行。 */
  readonly permission?: string
  /** Required token scopes for the `terminal` audience. `terminal` 受众要求的 token scope。 */
  readonly scopes?: readonly string[]
  /** One-line summary used by OpenAPI. OpenAPI 使用的一行摘要。 */
  readonly summary: string
  /** Audit action name such as `auth.login`; defaults to a path-derived name. 审计动作名，如 `auth.login`；默认由路径推导。 */
  readonly action?: string
  /** OpenAPI tags. OpenAPI 标签。 */
  readonly tags?: readonly string[]
  /** JSON body schema. JSON 请求体 schema。 */
  readonly input?: AdminSchema
  /** Query string schema. 查询字符串 schema。 */
  readonly query?: AdminSchema
  /** Record intent and outcome in the audit log. 是否在审计日志记录意图与结果。 */
  readonly audit?: boolean
  /**
   * Produce the response payload. Returning a value serializes it as JSON;
   * throwing an `AdminError` produces the standard error envelope.
   *
   * @param ctx - request and response controls 请求与响应控制
   * @returns the JSON payload 要序列化为 JSON 的载荷
   */
  handler(ctx: AdminRouteContext): unknown | Promise<unknown>
}

/** Standard list envelope. 标准列表信封。 */
export interface ApiListBody<T> {
  /** Page items. 本页条目。 */
  readonly items: readonly T[]
  /** Opaque cursor for the next page, absent on the last page. 下一页的不透明游标，末页缺失。 */
  readonly nextCursor?: string
}

/** Standard error envelope. 标准错误信封。 */
export interface ApiErrorBody {
  /** Structured failure. 结构化失败。 */
  readonly error: {
    /** Stable code. 稳定错误码。 */
    readonly code: string
    /** Human-readable message. 人类可读消息。 */
    readonly message: string
    /** Optional structured context. 可选结构化上下文。 */
    readonly details?: Readonly<Record<string, unknown>>
    /** Correlation id. 关联 id。 */
    readonly requestId: string
  }
}
