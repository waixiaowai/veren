/**
 * 身份域路由（设计文档 api.md API-05-01..08 与 modules/05-identity.md）。
 * update-user 的 email 一律拒绝（改邮箱走 API-05-02）；verify-email 凭签名
 * 令牌核销置位；list-accounts 的令牌类字段永不外泄（returned:false）；
 * unlink-account 归属过滤先行，越权与不存在同码。
 *
 * Identity routes (design api.md API-05-01..08 and modules/05-identity.md).
 * update-user always rejects an email field (changes go through API-05-02);
 * verify-email consumes a signed token to set the flag; list-accounts never
 * leaks token fields (returned:false); unlink-account filters ownership
 * first — forbidden and missing share one code.
 *
 * @module @veren/auth-core/routes/identity-routes.ts
 */

import { z } from 'zod'
import { APIError } from '../diagnostics/api-error.ts'
import { createAuthEndpoint } from '../endpoint/endpoint.ts'
import type { AuthEndpoint } from '../endpoint/endpoint.ts'
import type { EndpointContext } from '../endpoint/endpoint-types.ts'
import { freshSessionMiddleware, sensitiveSessionMiddleware, sessionMiddleware } from '../endpoint/middleware.ts'
import { requireTrustedCallbackURL } from '../guard/origin-check.ts'
import { signEmailToken, verifyEmailToken } from './email-token.ts'
import type { AccountRow, UserRow } from '../types.ts'
import { issueSession } from './credential-routes.ts'

/** 绑定行公开面：令牌类字段永不外泄。 / The public binding face: token fields never leak. */
function publicAccount(row: AccountRow): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.userId,
    providerId: row.providerId,
    accountId: row.accountId,
    scopes: (row.scope ?? '').split(',').filter((part) => part !== ''),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** update-user 体模式：email 显式拒绝。 / The update-user body schema: email explicitly rejected. */
const updateUserBody = z.looseObject({
  name: z.string().optional(),
  image: z.string().nullable().optional(),
  email: z.unknown().optional(),
})

/** API-05-01 update-user：声明字段合并 + 邮箱拒绝；成功后重发会话凭据。 / API-05-01 update-user: declared fields merge, email rejects; credentials reissue on success. */
const handleUpdateUser = async (ctx: EndpointContext): Promise<unknown> => {
  const session = ctx.context.session
  if (session === null) throw APIError.code('UNAUTHORIZED', 'A valid session is required.', 'UNAUTHORIZED')
  const body = ctx.body as z.infer<typeof updateUserBody>
  if (body.email !== undefined) throw APIError.code('EMAIL_CAN_NOT_BE_UPDATED', 'Change the email through /change-email.', 'BAD_REQUEST')
  const declared = Object.keys(ctx.context.options.user.additionalFields ?? {})
  const update: Record<string, unknown> = {}
  if (body.name !== undefined) update.name = body.name
  if (body.image !== undefined) update.image = body.image
  for (const field of declared) {
    if (ctx.body[field] !== undefined) update[field] = ctx.body[field]
  }
  if (Object.keys(update).length === 0) throw APIError.code('VALIDATION_ERROR', 'No updatable user fields were provided.', 'BAD_REQUEST')
  const updated = await ctx.context.internalAdapter.updateUser(session.user.id, update as Partial<UserRow>)
  if (updated === null) throw APIError.code('FAILED_TO_UPDATE_USER', 'The user update failed.', 'INTERNAL_SERVER_ERROR')
  return { status: true }
}

/** change-email 体模式。 / The change-email body schema. */
const changeEmailBody = z.object({
  newEmail: z.string().refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'invalid email'),
  callbackURL: z.string().optional(),
})

/** API-05-02 change-email：默认禁用报 CHANGE_EMAIL_DISABLED；开启走两步校验凭据。 / API-05-02 change-email: disabled by default (CHANGE_EMAIL_DISABLED); enabled goes through two-step verification. */
const handleChangeEmail = async (): Promise<unknown> => {
  throw APIError.code('CHANGE_EMAIL_DISABLED', 'Changing the email is disabled.', 'BAD_REQUEST')
}

/** send-verification-email 体模式。 / The send-verification-email body schema. */
const sendVerificationBody = z.object({
  email: z.string().refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'invalid email'),
  callbackURL: z.string().optional(),
})

/** API-05-04 send-verification-email：携带会话校验归属；匿名调用等时垫底。 / API-05-04 send-verification-email: ownership check with a session; anonymous calls pad equal-time. */
const handleSendVerificationEmail = async (ctx: EndpointContext): Promise<unknown> => {
  const send = ctx.context.options.emailVerification.sendVerificationEmail
  if (send === undefined) throw APIError.code('VERIFICATION_EMAIL_NOT_ENABLED', 'Verification email sending is not configured.', 'BAD_REQUEST')
  const body = ctx.body as z.infer<typeof sendVerificationBody>
  const callbackURL = requireTrustedCallbackURL(ctx, body.callbackURL) ?? '/'
  const email = body.email.toLowerCase()
  const session = ctx.context.session
  const found = await ctx.context.internalAdapter.findUserByEmail(email)
  if (session !== null && session.user.email !== email) throw APIError.code('EMAIL_MISMATCH', 'The email does not match the session user.', 'BAD_REQUEST')
  if (found !== null && found.user.emailVerified) throw APIError.code('EMAIL_ALREADY_VERIFIED', 'The email is already verified.', 'BAD_REQUEST')
  if (found === null) {
    await ctx.context.password.hash('equal-time-pad')
    return { status: true }
  }
  const token = signEmailToken(ctx.context.secretConfig, { email }, 3600)
  const url = `${ctx.context.baseURL}/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(callbackURL)}`
  await send({ user: { email }, url, token })
  return { status: true }
}

/** verify-email 查询模式。 / The verify-email query schema. */
const verifyEmailQuery = z.object({
  token: z.string(),
  callbackURL: z.string().optional(),
})

/** API-05-05 verify-email：令牌核销置位；提供 callbackURL 时 302 回跳。 / API-05-05 verify-email: consume the token and set the flag; a callbackURL turns the answer into a 302. */
const handleVerifyEmail = async (ctx: EndpointContext): Promise<unknown> => {
  const query = ctx.query as z.infer<typeof verifyEmailQuery>
  const callback = requireTrustedCallbackURL(ctx, query.callbackURL)
  const verdict = verifyEmailToken(ctx.context.secretConfig, query.token)
  if (verdict === null) throw APIError.code('INVALID_TOKEN', 'The verification token is invalid.', 'BAD_REQUEST')
  if (verdict === 'expired') throw APIError.code('TOKEN_EXPIRED', 'The verification token expired.', 'BAD_REQUEST')
  const found = await ctx.context.internalAdapter.findUserByEmail(verdict.email)
  if (found === null) throw APIError.code('USER_NOT_FOUND', 'The user does not exist.', 'BAD_REQUEST')
  if (found.user.emailVerified) throw APIError.code('EMAIL_ALREADY_VERIFIED', 'The email is already verified.', 'BAD_REQUEST')
  await ctx.context.internalAdapter.updateUser(found.user.id, { emailVerified: true })
  const user = { ...found.user, emailVerified: true }
  if (callback !== undefined) ctx.redirect(callback, 302)
  return { status: true, user }
}

/** API-05-06 list-accounts：本人绑定 + 公开面。 / API-05-06 list-accounts: own bindings through the public face. */
const handleListAccounts = async (ctx: EndpointContext): Promise<unknown> => {
  const session = ctx.context.session
  if (session === null) throw APIError.code('UNAUTHORIZED', 'A valid session is required.', 'UNAUTHORIZED')
  const rows = await ctx.context.adapter.findMany<AccountRow>({ model: 'account', where: [{ field: 'userId', value: session.user.id }] })
  return rows.map(publicAccount)
}

/** unlink-account 体模式。 / The unlink-account body schema. */
const unlinkBody = z.object({ accountId: z.string() })

/** API-05-08 unlink-account：解绑最后一条报 FAILED_TO_UNLINK_LAST_ACCOUNT；归属过滤先行。 / API-05-08 unlink-account: the last binding answers FAILED_TO_UNLINK_LAST_ACCOUNT; ownership filter first. */
const handleUnlinkAccount = async (ctx: EndpointContext): Promise<unknown> => {
  const session = ctx.context.session
  if (session === null) throw APIError.code('UNAUTHORIZED', 'A valid session is required.', 'UNAUTHORIZED')
  const body = ctx.body as z.infer<typeof unlinkBody>
  const rows = await ctx.context.adapter.findMany<AccountRow>({
    model: 'account',
    where: [{ field: 'userId', value: session.user.id }, { field: 'id', value: body.accountId }],
  })
  if (rows.length === 0) throw APIError.code('ACCOUNT_NOT_FOUND', 'The account binding was not found.', 'BAD_REQUEST')
  const total = await ctx.context.adapter.count({ model: 'account', where: [{ field: 'userId', value: session.user.id }] })
  if (total <= 1) throw APIError.code('FAILED_TO_UNLINK_LAST_ACCOUNT', 'The last account cannot be unlinked.', 'BAD_REQUEST')
  await ctx.context.adapter.delete({ model: 'account', where: [{ field: 'id', value: body.accountId }] })
  return { status: true }
}

/** 身份域端点集（delete-user 默认关闭：HTTP 404，见 api.md API-05-03）。 / The identity endpoint set (delete-user off by default: HTTP 404, per api.md API-05-03). */
export const identityRoutes: readonly AuthEndpoint[] = [
  createAuthEndpoint('/update-user', { method: 'POST', body: updateUserBody, use: [sessionMiddleware] }, handleUpdateUser),
  createAuthEndpoint('/change-email', { method: 'POST', body: changeEmailBody, use: [sensitiveSessionMiddleware] }, handleChangeEmail),
  createAuthEndpoint('/send-verification-email', { method: 'POST', body: sendVerificationBody }, handleSendVerificationEmail),
  createAuthEndpoint('/verify-email', { method: 'GET', query: verifyEmailQuery }, handleVerifyEmail),
  createAuthEndpoint('/list-accounts', { method: 'GET', use: [sessionMiddleware] }, handleListAccounts),
  createAuthEndpoint('/unlink-account', { method: 'POST', body: unlinkBody, use: [freshSessionMiddleware] }, handleUnlinkAccount),
]
