/**
 * 守卫域：来源校验与跳转目标校验（设计文档 modules/07-guard.md）。
 * 铁律：先判来源后判频率；失败即拒——来源头缺失或为 null 一律拒绝；
 * 幂等方法不校验来源；回调地址与来源共用同一张受信表。
 * Fetch Metadata：跨站导航登录拦截（无元数据头的非浏览器客户端放行）。
 *
 * The guard domain: origin and redirect validation (design
 * modules/07-guard.md). Iron rules: origin before rate; fail closed — a
 * missing or null origin header always rejects; idempotent methods skip the
 * origin check; redirect targets share the origin trust root. Fetch
 * Metadata: cross-site navigation login blocking (non-browser clients
 * without the headers pass).
 *
 * @module @veren/auth-core/guard/origin-check
 */

import { APIError } from '../diagnostics/api-error.ts'
import type { EndpointContext, Middleware } from '../endpoint/endpoint-types.ts'

/** 幂等方法集合。 / The idempotent method set. */
const IDEMPOTENT = new Set(['GET', 'OPTIONS', 'HEAD'])

/** 跳转目标键 → 错误码。 / Redirect-target keys → their error codes. */
const REDIRECT_KINDS: Record<string, string> = {
  callbackURL: 'INVALID_CALLBACK_URL',
  redirectTo: 'INVALID_REDIRECT_URL',
  errorCallbackURL: 'INVALID_ERROR_CALLBACK_URL',
  newUserCallbackURL: 'INVALID_NEW_USER_CALLBACK_URL',
}

/** 来源头：origin 优先，回落 referer。 / The origin header: origin first, referer fallback. */
function originHeader(ctx: EndpointContext): string | null | undefined {
  const origin = ctx.headers.get('origin')
  if (origin !== null && origin !== '' && origin !== 'undefined') return origin
  return ctx.headers.get('referer')
}

/** skipOriginCheck 是否豁免当前路径（布尔或路径数组）。 / Whether skipOriginCheck exempts this path (boolean or path list). */
function originSkipped(ctx: EndpointContext): boolean {
  const skip = ctx.context.skipOriginCheck
  if (skip === true) return true
  if (Array.isArray(skip)) return skip.some((path) => ctx.path === path || ctx.path.startsWith(`${path}/`))
  return false
}

/** 来源校验：失败即拒（MISSING_OR_NULL_ORIGIN / INVALID_ORIGIN）。 / Origin validation: fail closed (MISSING_OR_NULL_ORIGIN / INVALID_ORIGIN). */
function validateOrigin(ctx: EndpointContext): void {
  const header = originHeader(ctx)
  if (header === null || header === undefined || header === 'null') {
    // Origin: null 且 same-origin 导航：按基址推断（受信部署的回环场景）。
    // Origin: null with same-origin navigation: infer from the base URL.
    if (ctx.headers.get('origin') === 'null' && ctx.headers.get('sec-fetch-site') === 'same-origin') {
      if (ctx.context.isTrustedOrigin(ctx.context.baseURL)) return
    }
    throw APIError.code('MISSING_OR_NULL_ORIGIN', 'Missing or null origin header.', 'FORBIDDEN')
  }
  if (!ctx.context.isTrustedOrigin(header)) {
    throw APIError.code('INVALID_ORIGIN', 'The request origin is not trusted.', 'FORBIDDEN')
  }
}

/** 收集体/查询中的跳转目标（键与值）。 / Collect redirect targets (key and value) from body and query. */
function collectRedirectTargets(ctx: EndpointContext): Array<[string, unknown]> {
  const targets: Array<[string, unknown]> = []
  for (const key of Object.keys(REDIRECT_KINDS)) {
    const fromBody = ctx.body?.[key]
    if (fromBody !== undefined) targets.push([key, fromBody])
    const fromQuery = ctx.query?.[key]
    if (fromQuery !== undefined) targets.push([key, fromQuery])
  }
  return targets
}

/** 跳转目标校验：非字符串报 BAD_REQUEST，不命中受信表报对应 INVALID_* 码。 / Redirect validation: non-strings answer BAD_REQUEST; misses answer the kind's INVALID_* code. */
export function validateRedirectValue(ctx: EndpointContext, kind: string, value: unknown): void {
  if (typeof value !== 'string') throw APIError.code('VALIDATION_ERROR', `${kind} must be a string.`, 'BAD_REQUEST')
  if (value === '') return
  const trusted = ctx.context.isTrustedOrigin(value, { allowRelativePaths: true })
  if (!trusted) throw APIError.code(REDIRECT_KINDS[kind] ?? 'INVALID_REDIRECT_URL', `The ${kind} is not trusted.`, 'BAD_REQUEST')
}

/** 路由级守卫：来源 → 跳转目标 →（限流由调用方最后执行）。 / The route guard: origin → redirect targets → (rate limit runs last, by the caller). */
export const originCheckMiddleware: Middleware = async (ctx) => {
  if (IDEMPOTENT.has(ctx.request.method)) return
  if (!originSkipped(ctx)) validateOrigin(ctx)
  for (const [kind, value] of collectRedirectTargets(ctx)) {
    validateRedirectValue(ctx, kind, value)
  }
  return undefined
}

/** 登录类端点的跨站导航拦截（formCsrf；无元数据头的客户端放行）。 / The login-endpoint cross-site navigation block (formCsrf; clients without metadata pass). */
export const crossSiteNavigationMiddleware: Middleware = async (ctx) => {
  if (ctx.context.skipCSRFCheck) return
  const site = ctx.headers.get('sec-fetch-site')
  const mode = ctx.headers.get('sec-fetch-mode')
  if (site === null && mode === null) return
  if (site === 'cross-site' && mode === 'navigate') {
    throw APIError.code('CROSS_SITE_NAVIGATION_LOGIN_BLOCKED', 'Cross-site navigation login is blocked.', 'FORBIDDEN')
  }
  return undefined
}

/** 处理器内便捷校验：单个回调地址。 / Handler-side convenience: validate one callback URL. */
export function requireTrustedCallbackURL(ctx: EndpointContext, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  validateRedirectValue(ctx, 'callbackURL', value)
  return value as string
}
