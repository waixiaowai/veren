/** wire 与客户端内核验收：重试、错误归一、令牌交换与过期刷新重放。 */
/** wire and client-core acceptance: retries, error normalization, token exchange, and the expiry refresh replay. */
import { describe, expect, it } from 'vitest'
import { BaiduPanClient } from '../src/client.js'
import type { ResolvedConfig } from '../src/config.js'
import { resolveConfig } from '../src/config.js'
import { BaiduPanError } from '../src/errors.js'
import { exchangeCodeForTokens, refreshTokens, wireRequest } from '../src/wire.js'
import { farFutureTokens, scriptedFetch, tokenResponse, type FetchRoute } from './support/fakes.js'

const CONFIG: ResolvedConfig = resolveConfig({ appKey: 'k', secretKey: 's' })

/** 记录令牌读写的内存接线。The in-memory token read/write wiring. */
function memoryTokens() {
  let tokens = farFutureTokens()
  return {
    readTokens: async () => tokens,
    commitTokens: async (next: typeof tokens) => {
      tokens = next
    },
    current: () => tokens,
  }
}

describe('wireRequest', () => {
  it('returns the parsed JSON on success', async () => {
    const fetchLike = scriptedFetch([{ match: () => true, reply: () => Response.json({ ok: 1 }) }])
    const response = await wireRequest('https://x.test/a', { method: 'GET', query: { p: '1' } }, { timeoutMs: 1000, maxAttempts: 1, fetch: fetchLike })
    expect(response.json).toEqual({ ok: 1 })
    expect(fetchLike.calls[0]).toContain('p=1')
  })

  it('retries retryable HTTP 5xx and folds exhaustion into BDPAN_UPSTREAM', async () => {
    const fetchLike = scriptedFetch([{ match: () => true, reply: () => new Response('nope', { status: 500 }) }])
    const promise = wireRequest('https://x.test/a', { method: 'GET', query: {} }, { timeoutMs: 1000, maxAttempts: 2, fetch: fetchLike })
    await expect(promise).rejects.toMatchObject({ code: 'BDPAN_UPSTREAM', retryable: true })
    expect(fetchLike.calls).toHaveLength(2)
  })

  it('never retries non-retryable HTTP 4xx', async () => {
    const fetchLike = scriptedFetch([{ match: () => true, reply: () => new Response('', { status: 404 }) }])
    await expect(wireRequest('https://x.test/a', { method: 'GET', query: {} }, { timeoutMs: 1000, maxAttempts: 3, fetch: fetchLike }))
      .rejects.toMatchObject({ code: 'BDPAN_UPSTREAM', retryable: false })
    expect(fetchLike.calls).toHaveLength(1)
  })

  it('keeps the dlink URL query and merges request params over it', async () => {
    const fetchLike = scriptedFetch([{ match: () => true, reply: () => Response.json({}) }])
    await wireRequest('https://d.test/file?fid=7&dstime=1', { method: 'GET', query: { access_token: 't' } }, { timeoutMs: 1000, maxAttempts: 1, fetch: fetchLike })
    expect(fetchLike.calls[0]).toContain('fid=7')
    expect(fetchLike.calls[0]).toContain('access_token=t')
  })
})

describe('token endpoints', () => {
  it('exchanges a code for tokens', async () => {
    const fetchLike = scriptedFetch([{ match: url => url.includes('/oauth/2.0/token'), reply: () => tokenResponse() }])
    const tokens = await exchangeCodeForTokens(CONFIG, 'the-code', fetchLike)
    expect(tokens.accessToken).toBe('fresh-access')
    expect(tokens.refreshToken).toBe('fresh-refresh')
    expect(tokens.scope).toContain('netdisk')
    expect(fetchLike.calls[0]).toContain('/oauth/2.0/token')
  })

  it('folds OAuth error payloads into BDPAN_TOKEN_INVALID', async () => {
    const fetchLike = scriptedFetch([{ match: () => true, reply: () => Response.json({ error: 'invalid_grant', error_description: 'bad code' }) }])
    await expect(exchangeCodeForTokens(CONFIG, 'bad', fetchLike)).rejects.toMatchObject({ code: 'BDPAN_TOKEN_INVALID' })
  })

  it('refreshes tokens', async () => {
    const fetchLike = scriptedFetch([{ match: () => true, reply: () => tokenResponse() }])
    const tokens = await refreshTokens(CONFIG, 'old-refresh', fetchLike)
    expect(tokens.accessToken).toBe('fresh-access')
  })
})

describe('BaiduPanClient', () => {
  it('refuses loudly without tokens', async () => {
    const client = new BaiduPanClient({ config: CONFIG, readTokens: async () => undefined, commitTokens: async () => {}, fetch: scriptedFetch([]) })
    await expect(client.quota()).rejects.toMatchObject({ code: 'BDPAN_AUTH_REQUIRED' })
  })

  it('parses the quota payload', async () => {
    const fetchLike = scriptedFetch([{ match: url => url.includes('method=quota'), reply: () => Response.json({ errno: 0, total: 1000, used: 400 }) }])
    const memory = memoryTokens()
    const client = new BaiduPanClient({ config: CONFIG, ...memory, fetch: fetchLike })
    const quota = await client.quota()
    expect(quota).toEqual({ totalBytes: 1000, usedBytes: 400, freeBytes: 600, expireWithin7Days: false })
  })

  it('refreshes once and replays on a stale-token errno', async () => {
    const routes: FetchRoute[] = [
      {
        match: url => url.includes('method=uinfo'),
        reply: url => (url.includes('access_token=test-access') ? Response.json({ errno: 20016 }) : Response.json({ errno: 0, uk: 7, netdisk_name: 'n', vip_type: 1 })),
      },
      { match: url => url.includes('/oauth/2.0/token'), reply: () => tokenResponse() },
    ]
    const memory = memoryTokens()
    const client = new BaiduPanClient({ config: CONFIG, ...memory, fetch: scriptedFetch(routes) })
    const profile = await client.profile()
    expect(profile.uid).toBe('7')
    // 刷新后的新令牌已落库。
    // The fresh pair landed in the store.
    expect(memory.current().accessToken).toBe('fresh-access')
  })

  it('maps unknown errnos through the unified table', async () => {
    const fetchLike = scriptedFetch([{ match: () => true, reply: () => Response.json({ errno: -8 }) }])
    const memory = memoryTokens()
    const client = new BaiduPanClient({ config: CONFIG, ...memory, fetch: fetchLike })
    await expect(client.profile()).rejects.toBeInstanceOf(BaiduPanError)
    await expect(client.profile()).rejects.toMatchObject({ code: 'BDPAN_ALREADY_EXISTS' })
  })
})
