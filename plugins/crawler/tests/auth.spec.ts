import { describe, expect, it, vi } from 'vitest'
import { transitionLogin } from '../src/auth/state.ts'
import { runLoginFlow, userDataDirOf } from '../src/auth/flow.ts'
import type { AbstractLogin, LoginFlowDeps, LoginProbe } from '../src/auth/contract.ts'
import { CrawlerError } from '../src/errors.ts'

// 登录验收（design/modules/auth.md §6）：缓存命中免登录；Cookie 注入必复验；
// 超时报登录超时；档案按平台隔离。
// Login acceptance (design auth.md §6): cache hits skip login; cookie
// injection is re-verified; timeouts fail loudly; profiles are isolated.
const probeHit: LoginProbe = { loggedIn: true, probeMethod: 'api' }
const probeMiss: LoginProbe = { loggedIn: false, probeMethod: 'api' }

function makeDeps(overrides: Partial<LoginFlowDeps>): LoginFlowDeps {
  const login: AbstractLogin = {
    platform: 'xhs',
    begin: async () => {},
    loginByQrcode: async () => true,
    loginByMobile: async () => true,
    loginByCookies: async () => {},
  }
  return {
    loginType: 'qrcode',
    cookies: null,
    login,
    probe: async () => probeMiss,
    persist: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('login session state machine', () => {
  it('walks unknown→logging_in→waiting_scan→logged_in', () => {
    expect(transitionLogin('unknown', 'logging_in')).toBe('logging_in')
    expect(transitionLogin('logging_in', 'waiting_scan')).toBe('waiting_scan')
    expect(transitionLogin('waiting_scan', 'logged_in')).toBe('logged_in')
  })

  it('allows expired→logging_in and failed→logging_in retries', () => {
    expect(transitionLogin('expired', 'logging_in')).toBe('logging_in')
    expect(transitionLogin('failed', 'logging_in')).toBe('logging_in')
  })

  it('rejects unknown→logged_in without a verified cookie', () => {
    // CREDENTIAL_INVALID 语义：注入后探测不通过，不得直登。
    // CREDENTIAL_INVALID semantics: an unverified cookie cannot log in.
    expect(() => transitionLogin('unknown', 'expired')).toThrowError(CrawlerError)
    expect(() => transitionLogin('logged_in', 'logging_in')).toThrowError()
  })
})

describe('runLoginFlow', () => {
  it('cache hit returns logged_in with no login interaction and no persist', async () => {
    const persist = vi.fn(async () => {})
    const result = await runLoginFlow(makeDeps({ probe: async () => probeHit, persist }))
    expect(result.state).toBe('logged_in')
    expect(result.probeHit).toEqual(probeHit)
    expect(persist).not.toHaveBeenCalled()
  })

  it('qrcode flow logs in, persists the platform-isolated profile', async () => {
    const persist = vi.fn(async () => {})
    const result = await runLoginFlow(makeDeps({ persist }))
    expect(result.state).toBe('logged_in')
    expect(result.probeHit).toBeNull()
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ platform: 'xhs', persistedDir: userDataDirOf('xhs') }))
  })

  it('cookie flow without credential throws CREDENTIAL_MISSING before any injection', async () => {
    try {
      await runLoginFlow(makeDeps({ loginType: 'cookie', cookies: null }))
      expect.unreachable()
    } catch (error) {
      expect((error as CrawlerError).code).toBe('CREDENTIAL_MISSING')
    }
  })

  it('cookie flow with invalid credential throws CREDENTIAL_INVALID and does not persist', async () => {
    const persist = vi.fn(async () => {})
    try {
      await runLoginFlow(
        makeDeps({ loginType: 'cookie', cookies: 'bad=1', probe: async () => probeMiss, persist }),
      )
      expect.unreachable()
    } catch (error) {
      expect((error as CrawlerError).code).toBe('CREDENTIAL_INVALID')
      expect(persist).not.toHaveBeenCalled()
    }
  })

  it('cookie flow with a valid credential logs in without interactive login', async () => {
    const loginByCookies = vi.fn(async () => {})
    const loginByQrcode = vi.fn(async () => true)
    const result = await runLoginFlow(
      makeDeps({
        loginType: 'cookie',
        cookies: 'web_session=1',
        login: {
          platform: 'zhihu',
          begin: async () => {},
          loginByQrcode,
          loginByMobile: async () => true,
          loginByCookies,
        },
        probe: vi
          .fn()
          .mockResolvedValueOnce(probeMiss)
          .mockResolvedValueOnce(probeHit),
      }),
    )
    expect(result.state).toBe('logged_in')
    expect(loginByCookies).toHaveBeenCalledTimes(1)
    expect(loginByQrcode).not.toHaveBeenCalled()
  })

  it('qrcode timeout throws LOGIN_TIMEOUT and does not persist', async () => {
    const persist = vi.fn(async () => {})
    try {
      await runLoginFlow(makeDeps({ login: {
        platform: 'ks',
        begin: async () => {},
        loginByQrcode: async () => false,
        loginByMobile: async () => false,
        loginByCookies: async () => {},
      }, persist }))
      expect.unreachable()
    } catch (error) {
      expect((error as CrawlerError).code).toBe('LOGIN_TIMEOUT')
      expect(persist).not.toHaveBeenCalled()
    }
  })
})
