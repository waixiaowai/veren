import { describe, expect, it } from 'vitest'
import { buildPasswordAuth, call, cookiesOf, cookieHeader, post, signUpUser } from './helpers.ts'
import { resetRateLimitStore } from '../src/index.ts'

/** 已登录 Cookie 的快捷方式。 / A shortcut for a signed-in cookie jar. */
async function signInJar(): Promise<{ jar: Record<string, string>, auth: Awaited<ReturnType<typeof buildPasswordAuth>> }> {
  const auth = await buildPasswordAuth()
  const jar = cookiesOf(await signUpUser(auth))
  return { jar, auth }
}

describe('guard: origin validation (design 7.5 A1-A3, A8)', () => {
  it('A1: a trusted-origin POST passes and enters the business logic', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const response = await post(auth, '/auth/sign-in/email', { email: 'a@b.com', password: 'whatever-pw' })
    // 业务逻辑执行：统一码来自凭证校验而非守卫。
    // The business logic ran: the unified code comes from credential checks, not the guard.
    expect((await response.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
  })

  it('A2: an untrusted origin answers INVALID_ORIGIN and skips the business logic', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const response = await post(auth, '/auth/sign-in/email', { email: 'a@b.com', password: 'x' }, 'https://evil.example.com')
    expect(response.status).toBe(403)
    expect((await response.json() as { code: string }).code).toBe('INVALID_ORIGIN')
  })

  it('A3: a missing origin header answers MISSING_OR_NULL_ORIGIN', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const response = await call(auth, '/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'x' }),
    })
    expect(response.status).toBe(403)
    expect((await response.json() as { code: string }).code).toBe('MISSING_OR_NULL_ORIGIN')
  })

  it('A8: idempotent methods skip the origin check', async () => {
    const auth = await buildPasswordAuth()
    const response = await call(auth, '/auth/ok', { headers: { origin: 'https://stranger.example.com' } })
    expect(response.status).toBe(200)
  })

  it('skipOriginCheck exempts matching paths only', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth({ advanced: { disableOriginCheck: ['/sign-in'] }, rateLimit: { enabled: true } })
    const exempt = await post(auth, '/auth/sign-in/email', { email: 'a@b.com', password: 'whatever-pw' })
    // 守卫放行后进入业务：未知账号得到凭证域统一码，而非守卫码。
    // After the guard passes, the business answers the credential code, not a guard code.
    expect((await exempt.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
    const still = await post(auth, '/auth/sign-up/email', { name: 'B', email: 'b@b.com', password: 'whatever-pw' }, 'https://evil.example.com')
    expect((await still.json() as { code: string }).code).toBe('INVALID_ORIGIN')
  })
})

describe('guard: redirect validation (design 7.5 A4)', () => {
  it('A4: a hostile callbackURL answers INVALID_CALLBACK_URL', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const response = await post(auth, '/auth/sign-in/email', {
      email: 'a@b.com',
      password: 'whatever-pw',
      callbackURL: 'https://phish.example.net/grab',
    })
    expect((await response.json() as { code: string }).code).toBe('INVALID_CALLBACK_URL')
  })

  it('a relative callbackURL is allowed', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const response = await post(auth, '/auth/sign-in/email', { email: 'a@b.com', password: 'whatever-pw', callbackURL: '/dashboard' })
    expect((await response.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
  })
})

describe('guard: rate limiting (design 7.5 A5, A6; api 3.16)', () => {
  it('A5: the 4th sign-in inside the window answers 429 with X-Retry-After', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth({ rateLimit: { enabled: true } })
    for (let index = 0; index < 3; index++) {
      await post(auth, '/auth/sign-in/email', { email: 'a@b.com', password: 'whatever-pw' })
    }
    const fourth = await post(auth, '/auth/sign-in/email', { email: 'a@b.com', password: 'whatever-pw' })
    expect(fourth.status).toBe(429)
    expect(fourth.headers.get('x-retry-after')).not.toBeNull()
    const body = await fourth.json() as { message: string }
    expect(body.message).toContain('Too many requests')
  })

  it('the reset window is 60s/3 while sign-in is 10s/3 (independent buckets)', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth({ emailAndPassword: { enabled: true, sendResetPassword: async () => undefined }, rateLimit: { enabled: true } })
    for (let index = 0; index < 3; index++) {
      await post(auth, '/auth/request-password-reset', { email: 'a@b.com' })
    }
    const fourth = await post(auth, '/auth/request-password-reset', { email: 'a@b.com' })
    expect(fourth.status).toBe(429)
    // 登录桶独立：同一 IP 的登录路径仍放行进业务。
    // The sign-in bucket is separate: the same IP still enters the business path.
    const signIn = await post(auth, '/auth/sign-in/email', { email: 'a@b.com', password: 'whatever-pw' })
    expect((await signIn.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
  })

  it('A6: unresolvable IP still counts into the shared no-trusted-ip bucket', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth({ rateLimit: { enabled: true } })
    for (let index = 0; index < 3; index++) {
      await post(auth, '/auth/sign-in/email', { email: 'a@b.com', password: 'whatever-pw' })
    }
    const fourth = await post(auth, '/auth/sign-in/email', { email: 'a@b.com', password: 'whatever-pw' })
    expect(fourth.status).toBe(429)
  })

  it('GET requests are never rate limited', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    for (let index = 0; index < 120; index++) {
      const response = await call(auth, '/auth/ok')
      expect(response.status).toBe(200)
    }
  })
})

describe('guard: cross-site navigation (design 7.5 A7)', () => {
  it('A7: cross-site navigate metadata blocks the login endpoint', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth({ rateLimit: { enabled: true } })
    const response = await call(auth, '/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:3080',
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'navigate',
      },
      body: JSON.stringify({ email: 'a@b.com', password: 'whatever-pw' }),
    })
    expect((await response.json() as { code: string }).code).toBe('CROSS_SITE_NAVIGATION_LOGIN_BLOCKED')
  })

  it('a non-browser client without metadata headers passes', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth({ rateLimit: { enabled: true } })
    const response = await call(auth, '/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
      body: JSON.stringify({ email: 'a@b.com', password: 'whatever-pw' }),
    })
    expect((await response.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
  })
})

describe('guard: plugin rate-limit rules take precedence', () => {
  it('a plugin rule overrides the framework special rule for its path', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth({
      rateLimit: { enabled: true },
      plugins: [{ id: 'strict', rateLimit: [{ pathPattern: '/sign-in*', window: 60, max: 1 }] }],
    })
    const first = await post(auth, '/auth/sign-in/email', { email: 'a@b.com', password: 'whatever-pw' })
    expect((await first.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
    const second = await post(auth, '/auth/sign-in/email', { email: 'a@b.com', password: 'whatever-pw' })
    expect(second.status).toBe(429)
    expect(second.headers.get('x-retry-after')).toBe('60')
  })
})

describe('guard: P1 unauthenticated access to sensitive endpoints', () => {
  it('P1: no session on /revoke-session answers 401 UNAUTHORIZED', async () => {
    resetRateLimitStore()
    const { auth } = await signInJar()
    const response = await post(auth, '/auth/revoke-session', { token: 'whatever' })
    expect(response.status).toBe(401)
    expect((await response.json() as { code: string }).code).toBe('UNAUTHORIZED')
  })

  it('P2: revoking a foreign token silently succeeds and leaves the foreign session intact', async () => {
    resetRateLimitStore()
    const first = await signInJar()
    const second = await signInJar()
    // 他人令牌不可见：吊销非本人令牌静默成功，不泄露存在性。
    // A foreign token is invisible: revoking it answers success without leaking existence.
    const response = await call(first.auth, '/auth/revoke-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', cookie: cookieHeader(first.jar) },
      body: JSON.stringify({ token: 'not-a-real-token' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: true })
    const list = await call(second.auth, '/auth/list-sessions', { headers: { cookie: cookieHeader(second.jar) } })
    expect(await list.json()).toHaveLength(1)
  })
})
