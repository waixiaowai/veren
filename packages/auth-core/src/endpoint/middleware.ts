/**
 * 会话中间件族（设计文档 modules/03-session.md §3.2）。
 * `sessionMiddleware` 要求有效会话；`sensitiveSessionMiddleware` 强制权威源
 * （本框架无缓存副本，权威源是唯一读取面，敏感语义等价）；`freshSessionMiddleware`
 * 要求会话创建时间在 freshAge 内；`requestOnlySessionMiddleware` 仅浏览器请求
 * 要求会话。续期节流在中间件统一执行。
 *
 * The session middleware family (design modules/03-session.md §3.2).
 * `sessionMiddleware` requires a valid session; `sensitiveSessionMiddleware`
 * forces the authority (this framework keeps no cache copy, so the authority
 * is the only read face and the sensitive semantics coincide);
 * `freshSessionMiddleware` requires a session created within freshAge;
 * `requestOnlySessionMiddleware` demands a session only for browser
 * requests. Refresh throttling runs uniformly here.
 *
 * @module @veren/auth-core/endpoint/middleware
 */

import { APIError } from '../diagnostics/api-error.ts'
import { isRefreshDue } from '../session/authority.ts'
import { parseCookieHeader, serializeCookie } from '../context/cookies.ts'
import type { EndpointContext, Middleware } from './endpoint-types.ts'

/** 从请求头解析会话凭据令牌。 / Extract the session token from request headers. */
function tokenOf(ctx: EndpointContext): string | null {
  const jar = parseCookieHeader(ctx.headers.get('cookie'))
  const token = jar[ctx.context.authCookies.sessionToken]
  return token === undefined || token === '' ? null : token
}

/** 解析请求会话：过期由权威删除；到期按节流续期并重发凭据。 / Resolve the request session: expiry deletes via the authority; due sessions refresh with throttling and reissue credentials. */
export async function resolveSession(ctx: EndpointContext, options?: { disableRefresh?: boolean }): Promise<EndpointContext['context']['session']> {
  const token = tokenOf(ctx)
  if (token === null) return null
  const found = await ctx.context.sessionAuthority.find(token)
  if (found === null) {
    ctx.setHeader('set-cookie', serializeCookie('', ctx.context.authCookies.attributes(ctx.context.authCookies.sessionToken), 'delete'))
    return null
  }
  const config = ctx.context.options.session
  if (options?.disableRefresh !== true && isRefreshDue(found.session, { expiresIn: config.expiresIn, updateAge: config.updateAge, freshAge: config.freshAge }, found.dontRemember)) {
    const refreshed = await ctx.context.sessionAuthority.refresh(found)
    if (refreshed === null) {
      ctx.setHeader('set-cookie', serializeCookie('', ctx.context.authCookies.attributes(ctx.context.authCookies.sessionToken), 'delete'))
      throw APIError.code('FAILED_TO_GET_SESSION', 'The session could not be refreshed.', 'INTERNAL_SERVER_ERROR')
    }
    ctx.setHeader('set-cookie', serializeCookie(refreshed.session.token, ctx.context.authCookies.attributes(ctx.context.authCookies.sessionToken, { maxAge: config.expiresIn }), 'set'))
    return refreshed
  }
  return found
}

/** 会话缺失的统一拒绝。 / The unified rejection for a missing session. */
function unauthorized(): APIError {
  return APIError.code('UNAUTHORIZED', 'A valid session is required.', 'UNAUTHORIZED')
}

/** 要求有效会话。 / Require a valid session. */
export const sessionMiddleware: Middleware = async (ctx) => {
  const session = await resolveSession(ctx)
  ctx.context.session = session
  if (session === null) throw unauthorized()
  return undefined
}

/** 敏感端点：读权威源并抑制续期（吊销/改密的强一致面）。 / Sensitive endpoints: authority read with refresh suppressed (the strong-consistency face of revoke/change). */
export const sensitiveSessionMiddleware: Middleware = async (ctx) => {
  const session = await resolveSession(ctx, { disableRefresh: true })
  ctx.context.session = session
  if (session === null) throw unauthorized()
  return undefined
}

/** 要求新鲜会话（freshAge 内创建）。 / Require a fresh session (created within freshAge). */
export const freshSessionMiddleware: Middleware = async (ctx) => {
  const session = await resolveSession(ctx)
  ctx.context.session = session
  if (session === null) throw unauthorized()
  const fresh = isFreshChecked(session.session.createdAt, ctx.context.options.session.freshAge)
  if (!fresh) throw APIError.code('SESSION_NOT_FRESH', 'The session is no longer fresh; re-authenticate.', 'UNAUTHORIZED')
  return undefined
}

/** 新鲜度判定（authority 的 isFresh 复用点）。 / The freshness check (reuses the authority's isFresh). */
function isFreshChecked(createdAt: Date, freshAge: number): boolean {
  if (freshAge === 0) return true
  return Date.now() - createdAt.getTime() <= freshAge * 1000
}

/** 仅浏览器请求要求会话：无 Sec-Fetch-Site 头的非浏览器客户端放行。 / Browser-only sessions: non-browser clients without Sec-Fetch-Site pass. */
export const requestOnlySessionMiddleware: Middleware = async (ctx) => {
  if (ctx.headers.get('sec-fetch-site') === null) return
  const session = await resolveSession(ctx)
  ctx.context.session = session
  if (session === null) throw unauthorized()
  return undefined
}
