/**
 * Real-environment e2e, anonymous half: boots the actual `dsh web` host with
 * this plugin patched into its composition, then drives the gate over HTTP —
 * unauthenticated entry is redirected to the login page, the login page is
 * served, and a wrong password is refused by Better Auth. The signed-in
 * scenarios live in auth-gate-session.e2e.ts.
 * 真实环境 e2e 的「匿名」半边：把本插件 patch 进真实的 `dsh web` 宿主组合，随后通过
 * HTTP 驱动门禁——未认证访问被重定向到登录页、登录页可送达、错误密码被 Better Auth
 * 拒绝。登录后的场景在 auth-gate-session.e2e.ts。
 *
 * @module tests/auth-gate.e2e
 */
import { describe, expect, it } from 'vitest'
import { ADMIN_EMAIL, http, withRunningGate } from './auth-gate.helpers.ts'

describe('login gate on the real dsh web host', () => {
  it('redirects the unauthenticated entry to the login page and refuses a wrong password', { timeout: 240_000 }, async () => {
    await withRunningGate(async ({ port }) => {
      // 1. Unauthenticated SPA entry is redirected to the login page (the
      // handler emits a 3xx redirect; the exact code is not contractual).
      // 未认证的 SPA 入口被重定向到登录页（处理器的 3xx；具体码不属于契约）。
      const gated = await http('GET', '/', { port })
      expect(gated.status).toBeGreaterThanOrEqual(300)
      expect(gated.status).toBeLessThan(400)
      expect(gated.location).toBe('/login')
      expect(gated.setCookie ?? '').not.toContain('dsh-login.session_token')

      // 2. The login page itself is served.
      const login = await http('GET', '/login', { port })
      expect(login.status).toBe(200)
      expect(login.body).toContain('<html')

      // 3. Wrong password is refused by Better Auth.
      const bad = await http('POST', '/auth/sign-in/email', {
        port,
        body: JSON.stringify({ email: ADMIN_EMAIL, password: 'wrong-password-1' }),
      })
      expect(bad.status).toBe(401)
    })
  })
})
