import { describe, expect, it, vi } from 'vitest'
import {
  createWbLogin,
  probeWbLoggedIn,
  waitForWbLogin,
  WB_COOKIE_DOMAINS,
} from '../src/platform/wb/auth.ts'
import { createPlatformAuth } from '../src/platform/login.ts'
import type { CrawlerRunRequest } from '../src/control/runner.ts'
import type { CookieLike } from '../src/browser/contract.ts'
import { fakeSession } from './helpers/session.ts'

// 微博登录（design/modules/auth.md §3–§4）：探测读微博自己的 login 判定；
// 扫码/短信轮询到命中为止；Cookie 串注入双站域；未接入平台 fail loud。
// The weibo login (auth.md §3–§4): the probe reads weibo's own verdict; the
// qr/sms wait polls until a hit; cookie strings go to both site domains;
// unwired platforms fail loud.
const request: CrawlerRunRequest = {
  platform: 'wb', loginType: 'qrcode', crawlerType: 'search', keywords: [],
  specifiedIds: [], creatorIds: [], enableComments: false, enableSubComments: false,
  enableMedia: false, saveOption: 'jsonl', cookies: null, headless: false,
  maxNotesCount: 20, maxCommentsCount: 10, startPage: 1,
}

describe('probeWbLoggedIn', () => {
  it('reads the login flag from the api config payload', async () => {
    const session = fakeSession({ requestJson: async () => ({ data: { login: true } }) })
    await expect(probeWbLoggedIn(session)).resolves.toEqual({ loggedIn: true, probeMethod: 'api' })
  })

  it('treats a missing or false flag as logged out', async () => {
    const session = fakeSession({ requestJson: async () => ({ data: {} }) })
    await expect(probeWbLoggedIn(session)).resolves.toEqual({ loggedIn: false, probeMethod: 'api' })
  })
})

describe('waitForWbLogin', () => {
  it('polls until the probe hits', async () => {
    let calls = 0
    const session = fakeSession({
      requestJson: async () => {
        calls += 1
        return { data: { login: calls >= 2 } }
      },
    })
    await expect(waitForWbLogin(session, { timeoutMs: 1_000, pollMs: 1 })).resolves.toBe(true)
    expect(calls).toBe(2)
  })

  it('returns false when the scan window closes, tolerating probe errors', async () => {
    const session = fakeSession({
      requestJson: async () => {
        throw new Error('network down')
      },
    })
    await expect(waitForWbLogin(session, { timeoutMs: 10, pollMs: 2 })).resolves.toBe(false)
  })
})

describe('createWbLogin', () => {
  it('opens the mobile passport page before waiting, then leaves it for the index', async () => {
    const goto = vi.fn(async () => undefined)
    const page = { goto, content: async () => '' }
    const session = fakeSession({
      pages: async () => [page],
      newPage: async () => page,
      requestJson: async () => ({ data: { login: true } }),
    })
    await expect(createWbLogin(session, request).loginByQrcode()).resolves.toBe(true)
    expect(goto).toHaveBeenNthCalledWith(1, expect.stringContaining('passport.weibo.cn'))
    // 成功后离开登录页，杜绝残留页改写 Cookie / leaves the login page on success so it stops rewriting cookies
    expect(goto).toHaveBeenLastCalledWith('https://m.weibo.cn/')
  })

  it('injects the cookie string into both weibo domains', async () => {
    const added: CookieLike[] = []
    const session = fakeSession({ addCookies: async (cookies) => void added.push(...cookies) })
    const login = createWbLogin(session, { ...request, loginType: 'cookie', cookies: 'SUB=abc; SUBP=xyz' })
    await login.loginByCookies()
    // 双站各注入一遍：域名集合等于双站常量 / both sites get one pass: the domain set equals the dual-site constant
    expect([...new Set(added.map((cookie) => cookie.domain))]).toEqual([...WB_COOKIE_DOMAINS])
    expect(added.map((cookie) => cookie.name)).toEqual(['SUB', 'SUBP', 'SUB', 'SUBP'])
  })

  it('throws CREDENTIAL_MISSING without a credential string', async () => {
    const session = fakeSession()
    await expect(createWbLogin(session, { ...request, loginType: 'cookie' }).loginByCookies()).rejects.toMatchObject({
      code: 'CREDENTIAL_MISSING',
    })
  })
})

describe('createPlatformAuth', () => {
  it('throws INVALID_PLATFORM for a platform without a login implementation', () => {
    expect(() => createPlatformAuth('xhs', fakeSession(), request)).toThrowError(/xhs/)
  })
})
