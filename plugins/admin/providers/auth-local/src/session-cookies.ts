/**
 * Session and CSRF cookie policy of a successful sign-in.
 *
 * The session cookie is http-only, so scripts never see the token; the CSRF
 * cookie is readable on purpose — it is the double-submit token the SPA echoes
 * in a header on unsafe requests.
 *
 * 登录成功后的会话与 CSRF Cookie 策略。会话 Cookie 为 http-only，脚本读不到令牌；
 * CSRF Cookie 刻意可读——它就是 SPA 在非安全请求头里回传的双提交令牌。
 *
 * @module @veren/admin-auth-local/session-cookies
 */

import { ADMIN_CSRF_COOKIE, ADMIN_SESSION_COOKIE, type AdminLoginResult, type AdminResponse } from '@veren/admin-contract'
import type { ResolvedAuthConfig } from './config.ts'

/**
 * Attach the session and CSRF cookies of a successful sign-in.
 *
 * @param response - response controls 响应控制
 * @param result - sign-in material 登录材料
 * @param config - resolved auth config 解析后的认证配置
 */
export function applySessionCookies(response: AdminResponse, result: AdminLoginResult, config: ResolvedAuthConfig): void {
  const maxAgeSeconds = config.sessionDays * 86_400
  response.setCookie(ADMIN_SESSION_COOKIE, result.sessionToken, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
    maxAgeSeconds,
  })
  response.setCookie(ADMIN_CSRF_COOKIE, result.csrfToken, {
    httpOnly: false,
    sameSite: 'Lax',
    secure: config.secureCookies,
    maxAgeSeconds,
  })
}
