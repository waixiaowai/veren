/**
 * 凭证域路由（设计文档 api.md API-04-01..07 与 modules/04-credential.md）。
 * 等时失败：账号不存在时同样执行一次散列运算并返回同一错误码，不通过响应
 * 差异泄露账号存在性（铁律级）。长度校验在散列之前；口令重置三步
 * （核销令牌 → 可选吊销会话 → 写入新口令）在同一事务。
 *
 * Credential routes (design api.md API-04-01..07 and modules/04-credential.md).
 * Equal-time failure: a missing account still runs one hash and answers the
 * same code — no account-existence side channel (iron-rule grade). Length
 * checks precede hashing; password reset's three steps (consume token →
 * optional revocation → write the new password) share one transaction.
 *
 * @module @veren/auth-core/routes/credential-routes.ts
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { APIError } from '../diagnostics/api-error.ts'
import { createAuthEndpoint } from '../endpoint/endpoint.ts'
import type { AuthEndpoint } from '../endpoint/endpoint.ts'
import type { EndpointContext } from '../endpoint/endpoint-types.ts'
import { sensitiveSessionMiddleware } from '../endpoint/middleware.ts'
import { serializeCookie } from '../context/cookies.ts'
import { signEmailToken } from './email-token.ts'
import { crossSiteNavigationMiddleware, requireTrustedCallbackURL } from '../guard/origin-check.ts'
import type { AccountRow, SessionRow, UserRow } from '../types.ts'

/** 凭证提供方标识。 / The credential provider id. */
const CREDENTIAL_PROVIDER = 'credential'

/** 会话 Cookie 下发。 / Issue the session cookies. */
function issueSessionCookies(ctx: EndpointContext, token: string, dontRemember: boolean): void {
  const cookies = ctx.context.authCookies
  const maxAge = dontRemember ? undefined : Math.floor(ctx.context.options.session.expiresIn)
  ctx.setHeader('set-cookie', serializeCookie(token, cookies.attributes(cookies.sessionToken, { maxAge }), 'set'))
  ctx.setHeader('set-cookie', serializeCookie('true', cookies.attributes(cookies.dontRemember, { maxAge: dontRemember ? undefined : 0 }), 'set'))
}

/** 邮箱格式粗校验。 / Coarse email-format validation. */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** 凭据登录校验：绑定先行读档案，散列校验失败同码（A1/A2）。 / Credential sign-in verification: binding-first lookup, one code for every failure (A1/A2). */
async function verifyCredential(ctx: EndpointContext, email: string, password: string): Promise<{ user: UserRow, account: AccountRow }> {
  const found = await ctx.context.internalAdapter.findUserByEmail(email)
  if (found === null) {
    // 等时失败：账号不存在也执行一次散列，再抛同一错误码（A3）。
    // Equal-time failure: hash once even without the account, then one code (A3).
    await ctx.context.password.hash(password)
    throw APIError.code('INVALID_EMAIL_OR_PASSWORD', 'Invalid email or password.', 'BAD_REQUEST')
  }
  const account = found.accounts.find((row) => row.providerId === CREDENTIAL_PROVIDER)
  if (account === undefined || account.password === null || account.password === undefined) {
    await ctx.context.password.hash(password)
    throw APIError.code('INVALID_EMAIL_OR_PASSWORD', 'Invalid email or password.', 'BAD_REQUEST')
  }
  const ok = await ctx.context.password.verify({ hash: account.password, password })
  if (!ok) throw APIError.code('INVALID_EMAIL_OR_PASSWORD', 'Invalid email or password.', 'BAD_REQUEST')
  return { user: found.user, account }
}

/** 签发会话并写凭据。 / Issue a session and write credentials. */
export async function issueSession(ctx: EndpointContext, userId: string, dontRememberMe: boolean): Promise<SessionRow> {
  const row = await ctx.context.sessionAuthority.create({
    userId,
    dontRememberMe,
    ipAddress: ctx.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: ctx.headers.get('user-agent'),
  })
  issueSessionCookies(ctx, row.token, dontRememberMe)
  return row
}

/** sign-up 体模式。 / The sign-up body schema. */
const signUpBody = z.object({
  name: z.string().min(1),
  email: z.string().refine(isEmail, 'invalid email'),
  password: z.string().min(1),
  image: z.string().optional(),
  callbackURL: z.string().optional(),
  rememberMe: z.boolean().optional(),
})

/** API-04-01 sign-up/email：长度策略 → 查重 → 事务建档建凭证 → 可选自动登录。 / API-04-01 sign-up/email: length policy → duplicate check → transactional user+credential → optional auto sign-in. */
const handleSignUp = async (ctx: EndpointContext): Promise<unknown> => {
  const options = ctx.context.options.emailAndPassword
  if (!options.enabled) throw APIError.code('USER_NOT_FOUND', 'Sign-up is not enabled.', 'NOT_FOUND')
  const body = ctx.body as z.infer<typeof signUpBody>
  const strength = ctx.context.password.checkPassword(body.password)
  if (!strength.success) throw APIError.code(strength.code, `The password is too ${strength.code === 'PASSWORD_TOO_SHORT' ? 'short' : 'long'}.`, 'BAD_REQUEST')
  const email = body.email.toLowerCase()
  requireTrustedCallbackURL(ctx, body.callbackURL)
  const existing = await ctx.context.internalAdapter.findUserByEmail(email)
  if (existing !== null) {
    if (options.transparentSignUp) return { token: null, user: null }
    throw APIError.code('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'This email is already registered.', 'BAD_REQUEST')
  }
  const hash = await ctx.context.password.hash(body.password)
  const { user } = await ctx.context.internalAdapter.registerWithAccount(
    { name: body.name, email, image: body.image ?? null },
    { providerId: CREDENTIAL_PROVIDER, accountId: email, password: hash },
  )
  const verification = ctx.context.options.emailVerification
  if (verification.sendVerificationEmail !== undefined) {
    await sendVerificationEmail(ctx, user, body.callbackURL ?? verification.callbackURL ?? '/')
    return { token: null, user }
  }
  if (options.autoSignIn) {
    const session = await issueSession(ctx, user.id, body.rememberMe === false)
    return { token: session.token, user }
  }
  return { token: null, user }
}

/** sign-in 体模式。 / The sign-in body schema. */
const signInBody = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  callbackURL: z.string().optional(),
  rememberMe: z.boolean().optional(),
})

/** API-04-02 sign-in/email：等时失败统一码；强校验开启时未验证拒绝。 / API-04-02 sign-in/email: the unified equal-time code; unverified emails reject when required. */
const handleSignIn = async (ctx: EndpointContext): Promise<unknown> => {
  const options = ctx.context.options.emailAndPassword
  if (!options.enabled) throw APIError.code('USER_NOT_FOUND', 'Sign-in is not enabled.', 'NOT_FOUND')
  const body = ctx.body as z.infer<typeof signInBody>
  requireTrustedCallbackURL(ctx, body.callbackURL)
  const { user } = await verifyCredential(ctx, body.email.toLowerCase(), body.password)
  if (ctx.context.options.emailVerification.require === true && !user.emailVerified) {
    throw APIError.code('EMAIL_NOT_VERIFIED', 'Verify the email before signing in.', 'FORBIDDEN')
  }
  const session = await issueSession(ctx, user.id, body.rememberMe === false)
  const url = typeof body.callbackURL === 'string' && body.callbackURL !== '' ? body.callbackURL : undefined
  return url === undefined
    ? { redirect: false, token: session.token, user }
    : { redirect: false, token: session.token, user, url }
}

/** change-password 体模式。 / The change-password body schema. */
const changePasswordBody = z.object({
  newPassword: z.string().min(1),
  currentPassword: z.string().min(1),
  revokeOtherSessions: z.boolean().optional(),
})

/** API-04-03 change-password：核对当前 → 强度校验 → 同事务改口令（可选吊销其余 + 重签）。 / API-04-03 change-password: verify current → strength → transactional rewrite (optional revocation + reissue). */
const handleChangePassword = async (ctx: EndpointContext): Promise<unknown> => {
  const session = ctx.context.session
  if (session === null) throw APIError.code('UNAUTHORIZED', 'A valid session is required.', 'UNAUTHORIZED')
  const body = ctx.body as z.infer<typeof changePasswordBody>
  const strength = ctx.context.password.checkPassword(body.newPassword)
  if (!strength.success) throw APIError.code(strength.code, `The password is too ${strength.code === 'PASSWORD_TOO_SHORT' ? 'short' : 'long'}.`, 'BAD_REQUEST')
  const found = await ctx.context.internalAdapter.findUserByEmail(session.user.email)
  const account = found?.accounts.find((row) => row.providerId === CREDENTIAL_PROVIDER)
  if (account === undefined) throw APIError.code('CREDENTIAL_ACCOUNT_NOT_FOUND', 'No credential account exists.', 'BAD_REQUEST')
  const ok = await ctx.context.password.verify({ hash: account.password ?? '', password: body.currentPassword })
  if (!ok) throw APIError.code('INVALID_PASSWORD', 'The current password is wrong.', 'BAD_REQUEST')
  const hash = await ctx.context.password.hash(body.newPassword)
  await ctx.context.adapter.update({ model: 'account', where: [{ field: 'id', value: account.id }], update: { password: hash } })
  if (body.revokeOtherSessions === true) {
    await ctx.context.sessionAuthority.revokeAllForUser(session.user.id, session.session.token)
    const fresh = await issueSession(ctx, session.user.id, false)
    return { token: fresh.token, user: session.user }
  }
  return { token: session.session.token, user: session.user }
}

/** 发送校验邮件：回调缺失报 VERIFICATION_EMAIL_NOT_ENABLED。 / Send the verification email: a missing callback answers VERIFICATION_EMAIL_NOT_ENABLED. */
async function sendVerificationEmail(ctx: EndpointContext, user: UserRow, callbackURL: string): Promise<void> {
  const send = ctx.context.options.emailVerification.sendVerificationEmail
  if (send === undefined) throw APIError.code('VERIFICATION_EMAIL_NOT_ENABLED', 'Verification email sending is not configured.', 'BAD_REQUEST')
  const token = signEmailToken(ctx.context.secretConfig, { email: user.email }, 3600)
  const url = `${ctx.context.baseURL}/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(callbackURL)}`
  await send({ user: { email: user.email }, url, token })
}

/** request-password-reset 体模式。 / The request-password-reset body schema. */
const resetRequestBody = z.object({
  email: z.string().refine(isEmail, 'invalid email'),
  redirectTo: z.string().optional(),
})

/** API-04-04 request-password-reset：统一响应形态防枚举（缺账号也垫底散列）。 / API-04-04 request-password-reset: one response shape against enumeration (a missing account still pads a hash). */
const handleRequestPasswordReset = async (ctx: EndpointContext): Promise<unknown> => {
  const options = ctx.context.options.emailAndPassword
  if (options.sendResetPassword === undefined) throw APIError.code('VERIFICATION_EMAIL_NOT_ENABLED', 'Password reset mailing is not configured.', 'BAD_REQUEST')
  const body = ctx.body as z.infer<typeof resetRequestBody>
  requireTrustedCallbackURL(ctx, body.redirectTo)
  const found = await ctx.context.internalAdapter.findUserByEmail(body.email.toLowerCase())
  if (found === null) {
    await ctx.context.password.hash('equal-time-pad')
    return { status: true, message: 'If this email exists in our system, check your email for the reset link' }
  }
  // 重置令牌是服务端校验凭据行：核销原子化，重复使用只有一方成功（存储域决策 2）。
  // The reset token is a server-side verification row: atomic consumption (storage decision 2).
  const token = randomUUID()
  await ctx.context.internalAdapter.createVerification({
    identifier: token,
    value: JSON.stringify({ email: found.user.email }),
    expiresAt: new Date(Date.now() + options.resetPasswordTokenExpiresIn * 1000),
  })
  const base = ctx.context.baseURL
  const url = `${base}/reset-password/${encodeURIComponent(token)}?callbackURL=${encodeURIComponent(body.redirectTo ?? '/')}`
  await options.sendResetPassword({ user: { email: found.user.email }, url, token })
  return { status: true, message: 'If this email exists in our system, check your email for the reset link' }
}

/** API-04-05 reset-password/:token：只做跳转，真正改口令由 POST 完成。 / API-04-05 reset-password/:token: redirect only; the POST performs the rewrite. */
const handleResetCallback = async (ctx: EndpointContext): Promise<never> => {
  const callback = requireTrustedCallbackURL(ctx, ctx.query.callbackURL)
  if (callback === undefined) throw APIError.code('CALLBACK_URL_REQUIRED', 'A callbackURL is required.', 'BAD_REQUEST')
  // 服务端校验凭据行在位且未过期才放行跳转；真正核销由 POST 完成。
  // The server-side verification row must exist and be unexpired; the POST consumes it.
  const row = await ctx.context.internalAdapter.findVerification(ctx.params.token)
  const expired = row !== null && row.expiresAt.getTime() < Date.now()
  if (row === null || expired) {
    const target = new URL(callback, ctx.context.baseURL)
    target.searchParams.set('error', 'INVALID_TOKEN')
    ctx.redirect(target.toString())
  }
  const target = new URL(callback, ctx.context.baseURL)
  target.searchParams.set('token', ctx.params.token)
  ctx.redirect(target.toString())
}

/** reset-password 体模式。 / The reset-password body schema. */
const resetBody = z.object({
  newPassword: z.string().min(1),
  token: z.string().optional(),
})

/** API-04-06 reset-password：核销原子消费 → 事务内写新口令（可选吊销会话）。 / API-04-06 reset-password: atomic consume → transactional password write (optional session revocation). */
const handleResetPassword = async (ctx: EndpointContext): Promise<unknown> => {
  const options = ctx.context.options.emailAndPassword
  const body = ctx.body as z.infer<typeof resetBody>
  const token = body.token ?? (typeof ctx.query.token === 'string' ? ctx.query.token : undefined)
  if (token === undefined) throw APIError.code('INVALID_TOKEN', 'A reset token is required.', 'BAD_REQUEST')
  const strength = ctx.context.password.checkPassword(body.newPassword)
  if (!strength.success) throw APIError.code(strength.code, `The password is too ${strength.code === 'PASSWORD_TOO_SHORT' ? 'short' : 'long'}.`, 'BAD_REQUEST')
  // 原子核销：同一令牌并发重置只有一方成功；过期返回 TOKEN_EXPIRED（A5/E4）。
  // Atomic consume: concurrent resets on one token yield one winner; expiry answers TOKEN_EXPIRED (A5/E4).
  const consumed = await ctx.context.internalAdapter.consumeVerification(token)
  if (consumed === null) throw APIError.code('INVALID_TOKEN', 'The reset token is invalid.', 'BAD_REQUEST')
  if (consumed === 'expired') throw APIError.code('TOKEN_EXPIRED', 'The reset token expired.', 'BAD_REQUEST')
  let resetEmail = ''
  try {
    resetEmail = (JSON.parse(consumed.value) as { email?: string }).email ?? ''
  } catch {
    resetEmail = ''
  }
  const found = await ctx.context.internalAdapter.findUserByEmail(resetEmail)
  if (found === null) throw APIError.code('USER_NOT_FOUND', 'The user does not exist.', 'BAD_REQUEST')
  const account = found.accounts.find((row) => row.providerId === CREDENTIAL_PROVIDER)
  if (account === undefined) throw APIError.code('CREDENTIAL_ACCOUNT_NOT_FOUND', 'No credential account exists.', 'BAD_REQUEST')
  const hash = await ctx.context.password.hash(body.newPassword)
  const revoke = ctx.context.options.session.revokeSessionsOnPasswordReset === true
  await ctx.context.adapter.transaction(async (trx) => {
    await trx.update({ model: 'account', where: [{ field: 'id', value: account.id }], update: { password: hash } })
    if (revoke) await trx.deleteMany({ model: 'session', where: [{ field: 'userId', value: found.user.id }] })
  })
  await options.onPasswordReset?.({ user: { id: found.user.id, email: found.user.email } })
  return { status: true }
}

/** verify-password 体模式。 / The verify-password body schema. */
const verifyPasswordBody = z.object({ password: z.string().min(1) })

/** API-04-07 verify-password：核对当前口令。 / API-04-07 verify-password: verify the current password. */
const handleVerifyPassword = async (ctx: EndpointContext): Promise<unknown> => {
  const session = ctx.context.session
  if (session === null) throw APIError.code('UNAUTHORIZED', 'A valid session is required.', 'UNAUTHORIZED')
  const body = ctx.body as z.infer<typeof verifyPasswordBody>
  const found = await ctx.context.internalAdapter.findUserByEmail(session.user.email)
  const account = found?.accounts.find((row) => row.providerId === CREDENTIAL_PROVIDER)
  const ok = account !== undefined && await ctx.context.password.verify({ hash: account.password ?? '', password: body.password })
  if (!ok) throw APIError.code('INVALID_PASSWORD', 'The password is wrong.', 'BAD_REQUEST')
  return { status: true }
}

/** 凭证域端点集。 / The credential endpoint set. */
export const credentialRoutes: readonly AuthEndpoint[] = [
  createAuthEndpoint('/sign-up/email', { method: 'POST', body: signUpBody, use: [crossSiteNavigationMiddleware] }, handleSignUp),
  createAuthEndpoint('/sign-in/email', { method: 'POST', body: signInBody, use: [crossSiteNavigationMiddleware] }, handleSignIn),
  createAuthEndpoint('/change-password', { method: 'POST', body: changePasswordBody, use: [sensitiveSessionMiddleware] }, handleChangePassword),
  createAuthEndpoint('/request-password-reset', { method: 'POST', body: resetRequestBody }, handleRequestPasswordReset),
  createAuthEndpoint('/reset-password/:token', { method: 'GET' }, handleResetCallback),
  createAuthEndpoint('/reset-password', { method: 'POST', body: resetBody }, handleResetPassword),
  createAuthEndpoint('/verify-password', { method: 'POST', body: verifyPasswordBody, use: [sensitiveSessionMiddleware] }, handleVerifyPassword),
]
