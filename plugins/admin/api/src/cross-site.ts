/**
 * Cross-site request protection of the API gateway: the trusted-origin
 * allow-list, the double-submit CSRF check, and the CORS response headers for
 * trusted cross-origin callers.
 *
 * API 网关的跨站请求防护：受信来源白名单、双提交 CSRF 校验，以及为受信跨源调用方
 * 返回的 CORS 响应头。
 *
 * @module @veren/admin-api-kernel/cross-site
 */

import { ADMIN_CSRF_COOKIE, ADMIN_CSRF_HEADER, AdminError } from '@veren/admin-contract'
import type { RequestFacts } from './http.ts'
import type { ResolvedConfig } from './config.ts'

/**
 * Reject a cross-origin request from an origin the deployment does not trust.
 *
 * @param config - resolved gateway config 解析后的网关配置
 * @param facts - request facts 请求事实
 */
export function assertTrustedOrigin(config: ResolvedConfig, facts: RequestFacts): void {
  const origin = facts.headers.origin
  if (origin === undefined) return
  if (origin === 'null') throw new AdminError('FORBIDDEN', 'null origin is not allowed')
  const host = new URL(origin).host
  if (host === facts.headers.host) return
  if (config.trustedOrigins.includes(origin)) return
  throw new AdminError('FORBIDDEN', `origin ${origin} is not trusted`, { origin })
}

/**
 * Enforce the double-submit CSRF check.
 *
 * @param facts - request facts 请求事实
 */
export function assertCsrf(facts: RequestFacts): void {
  const cookie = facts.cookies[ADMIN_CSRF_COOKIE]
  const header = facts.headers[ADMIN_CSRF_HEADER]
  if (cookie === undefined || header === undefined || cookie !== header) {
    throw new AdminError('CSRF_FAILED', 'CSRF token is missing or does not match the cookie')
  }
}

/**
 * CORS headers for a trusted cross-origin caller.
 *
 * @param config - resolved gateway config 解析后的网关配置
 * @param facts - request facts 请求事实
 * @returns response headers, empty for same-origin callers 响应头；同源调用为空
 */
export function corsHeaders(config: ResolvedConfig, facts: RequestFacts): Record<string, string> {
  const origin = facts.headers.origin
  if (origin === undefined || !config.trustedOrigins.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': `content-type,${ADMIN_CSRF_HEADER},idempotency-key`,
    Vary: 'Origin',
  }
}
