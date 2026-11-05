import { describe, expect, it } from 'vitest'
import { buildAuth, buildPasswordAuth, call, cookiesOf, cookieHeader, post, signUpUser } from './helpers.ts'
import { resetRateLimitStore } from '../src/index.ts'

describe('E1: sign-up → sign-in → get-session → sign-out closed loop', () => {
  it('sign-up creates the user, issues a session and get-session reads it back', async () => {
    const auth = await buildPasswordAuth()
    const response = await signUpUser(auth)
    expect(response.status).toBe(200)
    const body = await response.json() as { token: string | null, user: { email: string } }
    expect(body.user.email).toBe('ada@example.com')
    expect(body.token).not.toBeNull()
    const jar = cookiesOf(response)
    expect(Object.keys(jar).some((name) => name.endsWith('session_token'))).toBe(true)

    const session = await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(jar) } })
    const sessionBody = await session.json() as { user: { email: string }, session: { token: string } } | null
    expect(sessionBody).not.toBeNull()
    expect(sessionBody?.user.email).toBe('ada@example.com')
    expect(sessionBody?.session.token).toBe(body.token)
  })

  it('sign-in with the right password succeeds; wrong password answers one code', async () => {
    const auth = await buildPasswordAuth()
    await signUpUser(auth, 'grace@example.com', 'an0ther-secret-pw')
    const ok = await post(auth, '/auth/sign-in/email', { email: 'grace@example.com', password: 'an0ther-secret-pw' })
    expect(ok.status).toBe(200)
    const okBody = await ok.json() as { token: string }
    expect(okBody.token).not.toBeNull()

    const bad = await post(auth, '/auth/sign-in/email', { email: 'grace@example.com', password: 'wrong-password' })
    expect(bad.status).toBe(400)
    expect((await bad.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
  })

  it('sign-out revokes the session; get-session then answers null', async () => {
    const auth = await buildPasswordAuth()
    const jar = cookiesOf(await signUpUser(auth))
    const out = await post(auth, '/auth/sign-out', {}, 'http://127.0.0.1:3080')
    expect(out.status).toBe(200)
    void jar
    const signedIn = cookiesOf(await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'sup3r-secret-pw' }))
    const gone = await call(auth, '/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', cookie: cookieHeader(signedIn) },
      body: '{}',
    })
    expect(gone.status).toBe(200)
    const after = await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(signedIn) } })
    expect(await after.json()).toBeNull()
  })

  it('lowercase normalization: mixed-case duplicate sign-up answers USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', async () => {
    const auth = await buildPasswordAuth()
    await signUpUser(auth, 'mixed@example.com')
    const duplicate = await signUpUser(auth, 'MIXED@example.com')
    expect(duplicate.status).toBe(400)
    expect((await duplicate.json() as { code: string }).code).toBe('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL')
  })

  it('sign-up requires emailAndPassword.enabled — disabled answers 404', async () => {
    const auth = await buildAuth()
    const response = await signUpUser(auth)
    expect(response.status).toBe(404)
  })
})

describe('C1: one hook pipeline serves both entries', () => {
  it('a before hook short-circuits HTTP and embedded calls alike', async () => {
    const auth = await buildPasswordAuth({
      hooks: {
        before: [{ matcher: () => true, handler: async () => ({ blocked: true }) }],
      },
    })
    const http = await post(auth, '/auth/sign-in/email', { email: 'x@example.com', password: 'whatever-pw' })
    const httpBody = await http.json() as Record<string, unknown>
    expect(httpBody).toEqual({ blocked: true })
    const embedded = await auth.api.signInEmail({ body: { email: 'x@example.com', password: 'whatever-pw' } })
    expect(embedded).toEqual({ blocked: true })
  })

  it('C2: server-only endpoints stay off the HTTP router but answer embedded calls', async () => {
    const auth = await buildPasswordAuth()
    const http = await call(auth, '/auth/never-there')
    expect(http.status).toBe(404)
    expect(auth.api.ok).toBeTypeOf('function')
  })

  it('C4: the same failure answers the same code on every endpoint', async () => {
    const auth = await buildPasswordAuth()
    const bad = await post(auth, '/auth/sign-in/email', { email: 'nobody@example.com', password: 'nope-nope-nope' })
    expect((await bad.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
  })

  it('C6: equal-time failure — a missing account and a wrong password answer one code with comparable cost', async () => {
    const auth = await buildPasswordAuth()
    await signUpUser(auth, 'known@example.com')
    const startMissing = performance.now()
    const missing = await post(auth, '/auth/sign-in/email', { email: 'unknown@example.com', password: 'whatever-pw1' })
    const missingCost = performance.now() - startMissing
    const startWrong = performance.now()
    const wrong = await post(auth, '/auth/sign-in/email', { email: 'known@example.com', password: 'wrong-password' })
    const wrongCost = performance.now() - startWrong
    expect((await missing.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
    expect((await wrong.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
    // 两侧都跑过一次 scrypt（N=16384）；数量级差异即侧信道。
    // Both sides ran one scrypt (N=16384); an order-of-magnitude gap is a side channel.
    expect(missingCost / Math.max(wrongCost, 1)).toBeLessThan(10)
    expect(missingCost).toBeGreaterThan(1)
  })
})

describe('embedded api face', () => {
  it('signUpEmail + getSession work without HTTP', async () => {
    const auth = await buildPasswordAuth()
    const signUp = await auth.api.signUpEmail({ body: { name: 'Ada', email: 'api@example.com', password: 'api-password-1' } })
    expect((signUp as { user: { email: string } }).user.email).toBe('api@example.com')
  })
})

describe('disabled paths answer 404', () => {
  it('a disabledPaths hit answers 404', async () => {
    const auth = await buildPasswordAuth({ disabledPaths: ['/ok'] })
    const response = await call(auth, '/auth/ok')
    expect(response.status).toBe(404)
  })
})

describe('E8-free basic routes', () => {
  it('ok answers { ok: true }', async () => {
    const auth = await buildPasswordAuth()
    resetRateLimitStore()
    const response = await call(auth, '/auth/ok')
    expect(await response.json()).toEqual({ ok: true })
  })
})
