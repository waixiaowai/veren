import { describe, expect, it } from 'vitest'
import { buildPasswordAuth, call, cookiesOf, cookieHeader, post, signUpUser } from './helpers.ts'
import { resetRateLimitStore } from '../src/index.ts'

/** 登录并返回会话行。 / Sign in and answer the session row. */
async function sessionOf(auth: Awaited<ReturnType<typeof buildPasswordAuth>>): Promise<{ jar: Record<string, string>, body: { session: { token: string, expiresAt: string }, user: { id: string } } }> {
  const jar = cookiesOf(await signUpUser(auth))
  const response = await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(jar) } })
  return { jar, body: await response.json() as never }
}

describe('session domain: issuance and resolution (design 3.5 A1)', () => {
  it('A1: the session persists into the authority and reads back', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const { body } = await sessionOf(auth)
    expect(body.session.token).toBeTypeOf('string')
    expect(body.session.token.length).toBeGreaterThan(30)
    expect(body.user.email).toBe('ada@example.com')
  })

  it('a token without a record answers null', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const response = await call(auth, '/auth/get-session', { headers: { cookie: `auth.session_token=forged-token-value` } })
    expect(await response.json()).toBeNull()
  })
})

describe('session domain: revocation (design 3.5 A2)', () => {
  it('A2: after revoke-session the cached cookie cannot resurrect the session', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const { jar, body } = await sessionOf(auth)
    const response = await call(auth, '/auth/revoke-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', cookie: cookieHeader(jar) },
      body: JSON.stringify({ token: body.session.token }),
    })
    expect(await response.json()).toEqual({ status: true })
    const after = await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(jar) } })
    expect(await after.json()).toBeNull()
  })
})

describe('session domain: refresh throttling (design 3.5 A3/A4)', () => {
  it('A3: a fresh session does not rewrite the expiry', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const { jar, body } = await sessionOf(auth)
    const before = new Date(body.session.expiresAt).getTime()
    await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(jar) } })
    const again = await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(jar) } })
    const after = (await again.json() as { session: { expiresAt: string } }).session.expiresAt
    expect(new Date(after).getTime()).toBe(before)
  })

  it('A4: a session past the refresh threshold extends and reissues the credential', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth({ session: { updateAge: 0 } })
    const { jar } = await sessionOf(auth)
    const first = await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(jar) } })
    const firstExpiry = (await first.json() as { session: { expiresAt: string } }).session.expiresAt
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(jar) } })
    const secondExpiry = (await second.json() as { session: { expiresAt: string } }).session.expiresAt
    expect(new Date(secondExpiry).getTime()).toBeGreaterThan(new Date(firstExpiry).getTime())
    const refreshed = cookiesOf(second)
    expect(Object.keys(refreshed).some((name) => name.endsWith('session_token'))).toBe(true)
  })
})

describe('session domain: freshness (design 3.5 A5)', () => {
  it('A5: list-sessions requires a fresh session', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const { jar } = await sessionOf(auth)
    const response = await call(auth, '/auth/list-sessions', { headers: { cookie: cookieHeader(jar) } })
    expect(response.status).toBe(200)
    expect(await response.json()).toHaveLength(1)
  })
})

describe('session domain: expiry (design 3.5 A8; R3)', () => {
  it('A8: an expired record deletes itself, clears the credential and answers null', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth({ session: { expiresIn: 1 } })
    const { jar, body } = await sessionOf(auth)
    // 直接把权威行改到过去，模拟时间流逝。
    // Rewind the authoritative row directly to simulate time passing.
    await auth.context.adapter.update({
      model: 'session',
      where: [{ field: 'token', value: body.session.token }],
      update: { expiresAt: new Date(Date.now() - 1000) },
    })
    const response = await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(jar) } })
    expect(await response.json()).toBeNull()
    expect(await auth.context.adapter.count({ model: 'session' })).toBe(0)
  })
})

describe('session domain: revoke-sessions family', () => {
  it('revoke-sessions clears every session including the current one', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const { jar } = await sessionOf(auth)
    const response = await call(auth, '/auth/revoke-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', cookie: cookieHeader(jar) },
      body: '{}',
    })
    expect(await response.json()).toEqual({ status: true })
    expect(await auth.context.adapter.count({ model: 'session' })).toBe(0)
  })

  it('revoke-other-sessions keeps the current session', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const { jar, body } = await sessionOf(auth)
    await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'sup3r-secret-pw' })
    const response = await call(auth, '/auth/revoke-other-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', cookie: cookieHeader(jar) },
      body: '{}',
    })
    expect(await response.json()).toEqual({ status: true })
    const after = await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(jar) } })
    const kept = await after.json() as { session: { token: string } } | null
    expect(kept?.session.token).toBe(body.session.token)
  })

  it('R4-adjacent: update-session with no declared writable fields answers the no-fields error', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const { jar } = await sessionOf(auth)
    const response = await call(auth, '/auth/update-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', cookie: cookieHeader(jar) },
      body: JSON.stringify({ anything: 'x' }),
    })
    expect((await response.json() as { code: string }).code).toBe('VALIDATION_ERROR')
  })
})
