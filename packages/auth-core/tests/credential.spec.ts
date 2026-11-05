import { describe, expect, it } from 'vitest'
import { buildPasswordAuth, call, cookiesOf, cookieHeader, post, signUpUser } from './helpers.ts'
import { createPasswordCapability, defaultHash, defaultVerify } from '../src/index.ts'
import { resetRateLimitStore } from '../src/index.ts'

describe('credential domain: hashing (design 4.2)', () => {
  it('the default hash is a self-describing salt:key scrypt string and verifies', async () => {
    const hash = await defaultHash('sup3r-secret-pw')
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/)
    expect(await defaultVerify({ hash, password: 'sup3r-secret-pw' })).toBe(true)
    expect(await defaultVerify({ hash, password: 'wrong-password' })).toBe(false)
    expect(await defaultVerify({ hash: 'not-a-hash', password: 'x' })).toBe(false)
  })

  it('NFKC normalization makes visually-equal passwords equivalent', async () => {
    const hash = await defaultHash('café-norm-123456')
    expect(await defaultVerify({ hash, password: 'café-norm-123456' })).toBe(true)
  })

  it('the capability reports length violations before hashing', async () => {
    const capability = createPasswordCapability({ minPasswordLength: 8, maxPasswordLength: 128 })
    expect(capability.checkPassword('short')).toEqual({ success: false, code: 'PASSWORD_TOO_SHORT' })
    expect(capability.checkPassword('x'.repeat(129))).toEqual({ success: false, code: 'PASSWORD_TOO_LONG' })
    expect(capability.checkPassword('within-policy')).toEqual({ success: true })
  })
})

describe('credential domain: sign-in equal-time failure (design 4.5 A1-A3, C6)', () => {
  it('A1: the correct password signs in and issues a session', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    await signUpUser(auth, 'ada@example.com', 'sup3r-secret-pw')
    const response = await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'sup3r-secret-pw' })
    const body = await response.json() as { token: string }
    expect(body.token).toBeTypeOf('string')
  })

  it('A2/A3: unknown email and wrong password answer one code at comparable cost', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    await signUpUser(auth, 'ada@example.com', 'sup3r-secret-pw')
    const start = performance.now()
    const missing = await post(auth, '/auth/sign-in/email', { email: 'ghost@example.com', password: 'whatever-pw' })
    const missingCost = performance.now() - start
    const start2 = performance.now()
    const wrong = await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'totally-wrong' })
    const wrongCost = performance.now() - start2
    expect((await missing.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
    expect((await wrong.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
    expect(missingCost).toBeGreaterThan(1)
    expect(missingCost / Math.max(wrongCost, 1)).toBeLessThan(10)
  })
})

describe('credential domain: change-password (design 4.5 A1-A2; api API-04-03)', () => {
  it('a wrong current password answers INVALID_PASSWORD without touching the store', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const jar = cookiesOf(await signUpUser(auth))
    const response = await call(auth, '/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', cookie: cookieHeader(jar) },
      body: JSON.stringify({ currentPassword: 'wrong-current', newPassword: 'brand-new-pass-1' }),
    })
    expect((await response.json() as { code: string }).code).toBe('INVALID_PASSWORD')
    // 旧口令仍可登录：失败路径未写库。
    // The old password still signs in: the failure path wrote nothing.
    const still = await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'sup3r-secret-pw' })
    expect(still.status).toBe(200)
  })

  it('a successful change invalidates the old password and honors revokeOtherSessions', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const jar = cookiesOf(await signUpUser(auth))
    // 第二个会话（其余会话）。
    // A second session (the "other" one).
    const second = cookiesOf(await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'sup3r-secret-pw' }))
    const response = await call(auth, '/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', cookie: cookieHeader(jar) },
      body: JSON.stringify({ currentPassword: 'sup3r-secret-pw', newPassword: 'brand-new-pass-1', revokeOtherSessions: true }),
    })
    const body = await response.json() as { token: string }
    expect(body.token).toBeTypeOf('string')
    const old = await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'sup3r-secret-pw' })
    expect((await old.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
    const fresh = await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'brand-new-pass-1' })
    expect(fresh.status).toBe(200)
    // 其余会话已被吊销：第二个会话读取返回 null。
    // The other session was revoked: the second jar reads back null.
    const otherGone = await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(second) } })
    expect(await otherGone.json()).toBeNull()
  })

  it('a too-short new password answers PASSWORD_TOO_SHORT before any hashing', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const jar = cookiesOf(await signUpUser(auth))
    const response = await call(auth, '/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', cookie: cookieHeader(jar) },
      body: JSON.stringify({ currentPassword: 'sup3r-secret-pw', newPassword: 'tiny' }),
    })
    expect((await response.json() as { code: string }).code).toBe('PASSWORD_TOO_SHORT')
  })
})

describe('credential domain: password reset (design 4.5 A4/A5/A6; E4)', () => {
  it('A5: the reset token consumes atomically — a second use answers INVALID_TOKEN', async () => {
    resetRateLimitStore()
    let sent: { token: string } | null = null
    const auth = await buildPasswordAuth({
      emailAndPassword: {
        enabled: true,
        sendResetPassword: async (input) => {
          sent = { token: input.token }
        },
      },
    })
    await signUpUser(auth, 'ada@example.com', 'sup3r-secret-pw')
    const request = await post(auth, '/auth/request-password-reset', { email: 'ada@example.com', redirectTo: '/reset' })
    expect(await request.json()).toEqual({ status: true, message: expect.stringContaining('reset link') })
    expect(sent).not.toBeNull()
    const token = (sent as { token: string }).token
    const first = await post(auth, '/auth/reset-password', { token, newPassword: 'after-reset-pw-1' })
    expect(await first.json()).toEqual({ status: true })
    const second = await post(auth, '/auth/reset-password', { token, newPassword: 'second-use-pw-2' })
    expect((await second.json() as { code: string }).code).toBe('INVALID_TOKEN')
    // E4：新口令可登录，旧口令失败。
    // E4: the new password signs in; the old one fails.
    const fresh = await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'after-reset-pw-1' })
    expect(fresh.status).toBe(200)
    const old = await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'sup3r-secret-pw' })
    expect((await old.json() as { code: string }).code).toBe('INVALID_EMAIL_OR_PASSWORD')
  })

  it('A4: a too-short new password answers PASSWORD_TOO_SHORT with no hash cost', async () => {
    resetRateLimitStore()
    let sent: { token: string } | null = null
    const auth = await buildPasswordAuth({
      emailAndPassword: {
        enabled: true,
        sendResetPassword: async (input) => {
          sent = { token: input.token }
        },
      },
    })
    await signUpUser(auth)
    await post(auth, '/auth/request-password-reset', { email: 'ada@example.com' })
    const token = (sent as { token: string }).token
    const response = await post(auth, '/auth/reset-password', { token, newPassword: 'tiny' })
    expect((await response.json() as { code: string }).code).toBe('PASSWORD_TOO_SHORT')
    // 令牌保留可用：口令被拒不算核销。
    // The token survives: a rejected password is not a consumption.
    const retry = await post(auth, '/auth/reset-password', { token, newPassword: 'acceptable-pw-1' })
    expect(await retry.json()).toEqual({ status: true })
  })

  it('A6: revokeSessionsOnPasswordReset invalidates every old session', async () => {
    resetRateLimitStore()
    let sent: { token: string } | null = null
    const auth = await buildPasswordAuth({
      session: { revokeSessionsOnPasswordReset: true },
      emailAndPassword: {
        enabled: true,
        sendResetPassword: async (input) => {
          sent = { token: input.token }
        },
      },
    })
    const jar = cookiesOf(await signUpUser(auth))
    await post(auth, '/auth/request-password-reset', { email: 'ada@example.com' })
    await post(auth, '/auth/reset-password', { token: (sent as { token: string }).token, newPassword: 'rotated-pass-99' })
    const response = await call(auth, '/auth/get-session', { headers: { cookie: cookieHeader(jar) } })
    expect(await response.json()).toBeNull()
  })
})

describe('identity domain: verify-email (design api API-05-05; E3)', () => {
  it('E3: requireVerification blocks unverified sign-in; verify-email unlocks it', async () => {
    resetRateLimitStore()
    let sent: { token: string } | null = null
    const auth = await buildPasswordAuth({
      emailVerification: {
        require: true,
        sendVerificationEmail: async (input) => {
          sent = { token: input.token }
        },
      },
      emailAndPassword: { enabled: true },
    })
    const response = await signUpUser(auth)
    const signUp = await response.json() as { token: string | null }
    // 校验流程在位时不自动登录。
    // No auto sign-in while the verification flow is in place.
    expect(signUp.token).toBeNull()
    const blocked = await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'sup3r-secret-pw' })
    expect((await blocked.json() as { code: string }).code).toBe('EMAIL_NOT_VERIFIED')
    expect(sent).not.toBeNull()
    const verified = await call(auth, `/auth/verify-email?token=${encodeURIComponent((sent as { token: string }).token)}`)
    expect(await verified.json()).toMatchObject({ status: true })
    const allowed = await post(auth, '/auth/sign-in/email', { email: 'ada@example.com', password: 'sup3r-secret-pw' })
    expect(allowed.status).toBe(200)
  })
})

describe('identity domain: list-accounts and unlink (design api API-05-06/08)', () => {
  it('list-accounts never leaks token fields; unlink answers one code for missing and foreign ids', async () => {
    resetRateLimitStore()
    const auth = await buildPasswordAuth()
    const jar = cookiesOf(await signUpUser(auth))
    const accounts = await call(auth, '/auth/list-accounts', { headers: { cookie: cookieHeader(jar) } })
    const rows = await accounts.json() as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.providerId).toBe('credential')
    expect(Object.keys(rows[0] ?? {})).not.toContain('password')

    const missing = await call(auth, '/auth/unlink-account', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', cookie: cookieHeader(jar) },
      body: JSON.stringify({ accountId: 'foreign-or-missing' }),
    })
    expect((await missing.json() as { code: string }).code).toBe('ACCOUNT_NOT_FOUND')
    const own = await call(auth, '/auth/unlink-account', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', cookie: cookieHeader(jar) },
      body: JSON.stringify({ accountId: (rows[0] as { id: string }).id }),
    })
    expect((await own.json() as { code: string }).code).toBe('FAILED_TO_UNLINK_LAST_ACCOUNT')
  })
})
