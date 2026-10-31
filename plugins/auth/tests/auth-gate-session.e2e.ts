/**
 * Real-environment e2e, signed-in half: boots the actual `dsh web` host with
 * this plugin patched into its composition, then drives the gate over HTTP —
 * the seeded admin signs in and receives the session cookie, the cookie
 * unlocks the SPA entry through the redirect chain, Better Auth's session
 * endpoint reflects the signed-in user, and the same request without the
 * cookie stays anonymous. The anonymous scenarios live in auth-gate.e2e.ts.
 * 真实环境 e2e 的「登录」半边：把本插件 patch 进真实的 `dsh web` 宿主组合，随后通过
 * HTTP 驱动门禁——播种的管理员登录并拿到会话 Cookie、Cookie 经重定向链解锁 SPA 入口、
 * Better Auth 会话端点反映已登录用户、同一请求不带 Cookie 保持匿名。匿名场景在
 * auth-gate.e2e.ts。
 *
 * @module tests/auth-gate-session.e2e
 */
import { describe, expect, it } from 'vitest'
import { ADMIN_EMAIL, ADMIN_PASSWORD, followEntryRedirects, http, sessionCookie, withRunningGate } from './auth-gate.helpers.ts'

describe('login gate on the real dsh web host', () => {
  it('authenticates the seeded admin over HTTP, unlocks the SPA entry, and serves the session', { timeout: 240_000 }, async () => {
    await withRunningGate(async ({ port }) => {
      // 4. The seeded admin signs in and receives the session cookie.
      const good = await http('POST', '/auth/sign-in/email', {
        port,
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      })
      if (good.status !== 200) throw new Error(`admin sign-in failed (${String(good.status)}): ${good.body}`)
      const cookie = sessionCookie(good.setCookie)
      expect(cookie).toContain('dsh-login.session_token=')

      // 5. The session cookie unlocks the SPA entry through the redirect chain:
      // '/' → 303 to the tokenized URL → Connection mints its cookie and 303s
      // to the clean path → 200 index.html. Cookies accumulate along the chain.
      // 会话 Cookie 经重定向链解锁 SPA 入口：'/' → 303 到带 token URL →
      // Connection 铸 Cookie 并 303 到干净路径 → 200 index.html。Cookie 沿链累积。
      const entry = await followEntryRedirects(port, cookie)
      expect(entry.status).toBe(200)
      expect(entry.body).toContain('<html')

      // 6. Better Auth's session endpoint reflects the signed-in admin.
      const session = await http('GET', '/auth/get-session', { port, cookie })
      expect(session.status).toBe(200)
      expect(JSON.parse(session.body)).toMatchObject({ user: { email: ADMIN_EMAIL } })

      // 7. The same request without the cookie stays anonymous.
      const anonymous = await http('GET', '/auth/get-session', { port })
      expect(anonymous.status).toBe(200)
      expect(anonymous.body.trim()).toBe('null')
    })
  })
})
