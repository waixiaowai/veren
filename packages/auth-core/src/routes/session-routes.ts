/**
 * 会话域路由（设计文档 api.md API-03-01..07 与 modules/03-session.md）。
 * get-session 无强制鉴权（无会话返回 null）；吊销类端点走敏感中间件强制
 * 权威源；list-sessions 要求新鲜会话；非本人令牌静默返回成功不泄露存在性。
 *
 * Session routes (design api.md API-03-01..07 and modules/03-session.md).
 * get-session demands no auth (null without a session); revoke endpoints go
 * through the sensitive middleware forcing the authority; list-sessions
 * requires freshness; a foreign token silently succeeds without leaking
 * existence.
 *
 * @module @veren/auth-core/routes/session-routes.ts
 */

import { z } from 'zod'
import { APIError } from '../diagnostics/api-error.ts'
import { createAuthEndpoint } from '../endpoint/endpoint.ts'
import type { AuthEndpoint } from '../endpoint/endpoint.ts'
import type { EndpointContext } from '../endpoint/endpoint-types.ts'
import { freshSessionMiddleware, resolveSession, sensitiveSessionMiddleware, sessionMiddleware } from '../endpoint/middleware.ts'
import { parseCookieHeader, serializeCookie } from '../context/cookies.ts'
import type { SessionRow } from '../types.ts'

/** 当前请求的会话令牌。 / The current request's session token. */
function currentToken(ctx: EndpointContext): string | null {
  return parseCookieHeader(ctx.headers.get('cookie'))[ctx.context.authCookies.sessionToken] ?? null
}

/** 清除会话凭据（含不记住我标记）。 / Clear the session credentials (marker included). */
function clearSessionCookies(ctx: EndpointContext): void {
  for (const name of [ctx.context.authCookies.sessionToken, ctx.context.authCookies.dontRemember]) {
    ctx.setHeader('set-cookie', serializeCookie('', ctx.context.authCookies.attributes(name), 'delete'))
  }
}

/** get-session 查询模式。 / The get-session query schema. */
const getSessionQuery = z.object({
  disableCookieCache: z.boolean().optional(),
  disableRefresh: z.boolean().optional(),
})

/** API-03-01 get-session：GET/POST 同一处理；无会话返回 null。 / API-03-01 get-session: GET/POST share one handler; null without a session. */
const handleGetSession = async (ctx: EndpointContext): Promise<unknown> => {
  const query = ctx.query as z.infer<typeof getSessionQuery>
  const session = await resolveSession(ctx, { disableRefresh: query.disableRefresh === true })
  ctx.context.session = session
  return session === null ? null : { session: publicSession(session.session), user: session.user }
}

/** API-03-02 sign-out：尽力吊销并清除凭据，无凭据也清 Cookie。 / API-03-02 sign-out: best-effort revoke plus credential clearing; cookies clear even without one. */
const handleSignOut = async (ctx: EndpointContext): Promise<unknown> => {
  const token = currentToken(ctx)
  if (token !== null) await ctx.context.sessionAuthority.revoke(token)
  clearSessionCookies(ctx)
  return { success: true }
}

/** 会话行公开面：id/token/userId/expiresAt/ipAddress/userAgent/createdAt。 / The public session face. */
function publicSession(row: SessionRow): Record<string, unknown> {
  return {
    id: row.id,
    token: row.token,
    userId: row.userId,
    expiresAt: row.expiresAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** API-03-03 list-sessions：新鲜会话要求；过期行不出现。 / API-03-03 list-sessions: freshness required; expired rows vanish. */
const handleListSessions = async (ctx: EndpointContext): Promise<unknown> => {
  const session = ctx.context.session
  if (session === null) throw APIError.code('UNAUTHORIZED', 'A valid session is required.', 'UNAUTHORIZED')
  const rows = await ctx.context.adapter.findMany<SessionRow>({ model: 'session', where: [{ field: 'userId', value: session.user.id }] })
  const now = Date.now()
  return rows.filter((row) => row.expiresAt.getTime() >= now).map(publicSession)
}

/** revoke-session 体模式。 / The revoke-session body schema. */
const revokeBody = z.object({ token: z.string() })

/** API-03-04 revoke-session：归属过滤先行，非本人令牌静默成功。 / API-03-04 revoke-session: ownership filter first; foreign tokens succeed silently. */
const handleRevokeSession = async (ctx: EndpointContext): Promise<unknown> => {
  const session = ctx.context.session
  if (session === null) throw APIError.code('UNAUTHORIZED', 'A valid session is required.', 'UNAUTHORIZED')
  const body = ctx.body as z.infer<typeof revokeBody>
  await ctx.context.adapter.deleteMany({
    model: 'session',
    where: [{ field: 'token', value: body.token }, { field: 'userId', value: session.user.id }],
  })
  return { status: true }
}

/** API-03-05 revoke-sessions：吊销本人全部会话（含当前），清凭据。 / API-03-05 revoke-sessions: revoke all own sessions (current included), clear credentials. */
const handleRevokeSessions = async (ctx: EndpointContext): Promise<unknown> => {
  const session = ctx.context.session
  if (session === null) throw APIError.code('UNAUTHORIZED', 'A valid session is required.', 'UNAUTHORIZED')
  await ctx.context.sessionAuthority.revokeAllForUser(session.user.id)
  clearSessionCookies(ctx)
  return { status: true }
}

/** API-03-06 revoke-other-sessions：保留当前，吊销其余。 / API-03-06 revoke-other-sessions: keep the current one, revoke the rest. */
const handleRevokeOtherSessions = async (ctx: EndpointContext): Promise<unknown> => {
  const session = ctx.context.session
  if (session === null) throw APIError.code('UNAUTHORIZED', 'A valid session is required.', 'UNAUTHORIZED')
  await ctx.context.sessionAuthority.revokeAllForUser(session.user.id, session.session.token)
  return { status: true }
}

/** API-03-07 update-session：核心无可写字段，任何更新请求报无可更新字段。 / API-03-07 update-session: the core owns no writable fields; any update answers "no updatable fields". */
const handleUpdateSession = async (ctx: EndpointContext): Promise<unknown> => {
  const writable = Object.keys(ctx.context.tables.session?.fields ?? {}).filter((field) => ctx.context.tables.session?.fields[field]?.input !== false && field !== 'id' && field !== 'token' && field !== 'userId')
  const requested = Object.keys(ctx.body).filter((key) => writable.includes(key))
  if (requested.length === 0) {
    throw APIError.code('VALIDATION_ERROR', 'No updatable session fields were declared.', 'BAD_REQUEST')
  }
  const session = ctx.context.session
  if (session === null) throw APIError.code('UNAUTHORIZED', 'A valid session is required.', 'UNAUTHORIZED')
  const updated = await ctx.context.adapter.update<SessionRow>({
    model: 'session',
    where: [{ field: 'token', value: session.session.token }],
    update: Object.fromEntries(requested.map((key) => [key, ctx.body[key]])),
  })
  if (updated === null) throw APIError.code('FAILED_TO_GET_SESSION', 'The session row vanished; sign in again.', 'INTERNAL_SERVER_ERROR')
  return { session: publicSession(updated) }
}

/** 会话域端点集。 / The session endpoint set. */
export const sessionRoutes: readonly AuthEndpoint[] = [
  createAuthEndpoint('/get-session', { method: 'GET', query: getSessionQuery }, handleGetSession),
  createAuthEndpoint('/get-session', { method: 'POST', query: getSessionQuery }, handleGetSession),
  createAuthEndpoint('/sign-out', { method: 'POST' }, handleSignOut),
  createAuthEndpoint('/list-sessions', { method: 'GET', use: [freshSessionMiddleware] }, handleListSessions),
  createAuthEndpoint('/revoke-session', { method: 'POST', body: revokeBody, use: [sensitiveSessionMiddleware] }, handleRevokeSession),
  createAuthEndpoint('/revoke-sessions', { method: 'POST', use: [sensitiveSessionMiddleware] }, handleRevokeSessions),
  createAuthEndpoint('/revoke-other-sessions', { method: 'POST', use: [sensitiveSessionMiddleware] }, handleRevokeOtherSessions),
  createAuthEndpoint('/update-session', { method: 'POST', use: [sessionMiddleware] }, handleUpdateSession),
]
