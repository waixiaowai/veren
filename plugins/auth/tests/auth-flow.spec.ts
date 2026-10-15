/**
 * End-to-end Better Auth flows over the domain-storage adapter: sign-up,
 * sign-in (including the non-revealing failure), session cookies, durable
 * sessions across a "restart", and brute-force rate limiting.
 * 基于 domain 存储适配器的 Better Auth 端到端流程：注册、登录（含不泄露原因
 * 的失败）、会话 Cookie、跨"重启"的持久会话，以及暴力尝试限流。
 */

import { describe, expect, it } from 'vitest'
import { buildBetterAuth } from '../src/auth.js'
import { memoryLoginGateDomain } from './memory-domain.js'
import type { LoginGateAuth } from '../src/auth.js'

const ORIGIN = 'http://127.0.0.1:3080'

/** Build one auth instance over a domain, mirroring the plugin's options. 按插件选项在 domain 上构建 auth 实例。 */
function makeAuth(domain = memoryLoginGateDomain(), options?: { rateLimit?: { window: number, max: number } | false }): LoginGateAuth {
  return buildBetterAuth({
    domain,
    secret: 'unit-test-secret-0123456789abcdef0123456789abcdef',
    origin: ORIGIN,
    secure: false,
    expiresInDays: 7,
    rateLimit: options?.rateLimit ?? false,
  })
}

/** Drive the Better Auth fetch handler. 驱动 Better Auth 的 fetch 处理器。 */
function call(auth: LoginGateAuth, path: string, init?: RequestInit): Promise<Response> {
  return auth.handler(new Request(ORIGIN + path, init))
}

const JSON_INIT = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** Collect the session cookie from a response. 从响应收集会话 Cookie。 */
function sessionCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find(entry => entry.startsWith('dsh-login.session_token='))
  expect(cookie).toBeDefined()
  return cookie!.split(';')[0]!
}

describe('Better Auth over the domain adapter | domain 适配器上的 Better Auth', () => {
  it('signs up, signs in, and serves the session | 注册、登录并提供会话', async () => {
    const auth = makeAuth()
    const signedUp = await call(auth, '/auth/sign-up/email', JSON_INIT({
      email: 'admin@example.com', password: 'correct-horse-1', name: 'Admin',
    }))
    expect(signedUp.status).toBe(200)

    const signedIn = await call(auth, '/auth/sign-in/email', JSON_INIT({
      email: 'admin@example.com', password: 'correct-horse-1',
    }))
    expect(signedIn.status).toBe(200)
    const cookie = sessionCookie(signedIn)

    const session = await call(auth, '/auth/get-session', { headers: { cookie } })
    expect(session.status).toBe(200)
    const data = await session.json() as { user?: { email?: string } }
    expect(data.user?.email).toBe('admin@example.com')
  })

  it('answers every sign-in failure with the same generic message | 所有登录失败返回同一泛化消息', async () => {
    const auth = makeAuth()
    await call(auth, '/auth/sign-up/email', JSON_INIT({
      email: 'admin@example.com', password: 'correct-horse-1', name: 'Admin',
    }))
    const wrongPassword = await call(auth, '/auth/sign-in/email', JSON_INIT({
      email: 'admin@example.com', password: 'wrong-password-1',
    }))
    const unknownUser = await call(auth, '/auth/sign-in/email', JSON_INIT({
      email: 'nobody@example.com', password: 'wrong-password-1',
    }))
    expect(wrongPassword.status).toBe(401)
    expect(unknownUser.status).toBe(401)
    expect(await wrongPassword.text()).toBe(await unknownUser.text())
  })

  it('keeps sessions valid after a restart on the same domain | 重启（同一 domain）后会话仍有效', async () => {
    const domain = memoryLoginGateDomain()
    const first = makeAuth(domain)
    await call(first, '/auth/sign-up/email', JSON_INIT({
      email: 'admin@example.com', password: 'correct-horse-1', name: 'Admin',
    }))
    const signedIn = await call(first, '/auth/sign-in/email', JSON_INIT({
      email: 'admin@example.com', password: 'correct-horse-1',
    }))
    const cookie = sessionCookie(signedIn)

    // "Restart": a brand-new auth instance over the same domain storage.
    // “重启”：在同一 domain 存储上全新构建的 auth 实例。
    const restarted = makeAuth(domain)
    const session = await call(restarted, '/auth/get-session', { headers: { cookie } })
    expect(session.status).toBe(200)
    const data = await session.json() as { user?: { email?: string } }
    expect(data.user?.email).toBe('admin@example.com')
  })

  it('signs out and invalidates the session | 登出并使会话失效', async () => {
    const auth = makeAuth()
    await call(auth, '/auth/sign-up/email', JSON_INIT({
      email: 'admin@example.com', password: 'correct-horse-1', name: 'Admin',
    }))
    const signedIn = await call(auth, '/auth/sign-in/email', JSON_INIT({
      email: 'admin@example.com', password: 'correct-horse-1',
    }))
    const cookie = sessionCookie(signedIn)
    await call(auth, '/auth/sign-out', { ...JSON_INIT({}), headers: { 'content-type': 'application/json', cookie } })
    const after = await call(auth, '/auth/get-session', { headers: { cookie } })
    // A signed-out session serializes as a bare JSON `null`.
    // 登出后的会话序列化为裸 JSON `null`。
    const data = await after.json() as { session?: unknown } | null
    expect(data?.session ?? null).toBeNull()
  })

  it('rate-limits repeated failed sign-ins | 对重复失败登录限流', async () => {
    const auth = makeAuth(memoryLoginGateDomain(), { rateLimit: { window: 60, max: 10 } })
    await call(auth, '/auth/sign-up/email', JSON_INIT({
      email: 'admin@example.com', password: 'correct-horse-1', name: 'Admin',
    }))
    let lastStatus = 0
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await call(auth, '/auth/sign-in/email', JSON_INIT({
        email: 'admin@example.com', password: `wrong-password-${attempt}`,
      }))
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
  })
})
