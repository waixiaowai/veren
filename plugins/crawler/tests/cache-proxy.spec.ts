import { describe, expect, it, vi } from 'vitest'
import { createCache, type AbstractCache } from '../src/cache/contract.ts'
import { MemoryCache } from '../src/cache/memory-cache.ts'
import { isExpired, toHostPort, toProxyUrl, type IpInfo } from '../src/proxy/ip-info.ts'
import { ProxyIpPool } from '../src/proxy/pool.ts'
import { refreshProxyIfExpired } from '../src/proxy/refresh.ts'

// 外围域验收（design cache.md §4 / proxy.md §4）。
// Peripheral acceptance (design cache.md §4 / proxy.md §4).
const staticIp: IpInfo = { ip: '1.2.3.4', port: 8080, protocol: 'https', user: null, password: null, expiredTimeTs: null }

describe('cache', () => {
  it('returns the value before expiry and null after it', async () => {
    const cache: AbstractCache = new MemoryCache()
    await cache.set('k', { a: 1 }, 50)
    expect(await cache.get('k')).toEqual({ a: 1 })
    vi.useFakeTimers()
    vi.setSystemTime(vi.getMockedSystemTime() !== null ? new Date(Date.now() + 100) : Date.now() + 100)
    try {
      expect(await cache.get('k')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('matches keys by * substring pattern', async () => {
    const cache = new MemoryCache()
    await cache.set('proxy:ip:1', 1, 60_000)
    await cache.set('proxy:ip:2', 2, 60_000)
    await cache.set('login:code:138', 'x', 60_000)
    expect(await cache.keys('proxy:ip:*')).toEqual(['proxy:ip:1', 'proxy:ip:2'])
  })

  it('sweeps expired entries in the background cycle', () => {
    const cache = new MemoryCache()
    cache.set('old', 1, -1)
    cache.set('fresh', 2, 60_000)
    expect(cache.sweepExpired()).toBe(1)
    expect(cache.sweepExpired()).toBe(0)
  })

  it('factory rejects unknown types without a half-initialized instance', () => {
    expect(() => createCache('redis')).toThrowError(/INVALID_CACHE_TYPE|不支持/)
    expect(() => createCache('memcached' as never)).toThrowError()
  })
})

describe('ip-info', () => {
  it('respects the expiry buffer and treats null instants as never expiring', () => {
    const dying: IpInfo = { ...staticIp, expiredTimeTs: 1000 }
    expect(isExpired(dying, 30, 975)).toBe(true)
    expect(isExpired(dying, 30, 900)).toBe(false)
    expect(isExpired(staticIp, 30, 99_999)).toBe(false)
  })

  it('converts to both consumption formats', () => {
    expect(toHostPort(staticIp)).toBe('1.2.3.4:8080')
    expect(toProxyUrl({ ...staticIp, user: 'u', password: 'p@ss' })).toBe('https://u:p%40ss@1.2.3.4:8080')
    expect(toProxyUrl(staticIp)).toBe('https://1.2.3.4:8080')
  })
})

describe('ProxyIpPool', () => {
  it('draws randomly, removes from the pool, and reloads when empty', async () => {
    const fetched: number[] = []
    const pool = new ProxyIpPool({
      provider: async (count) => {
        fetched.push(count)
        return Array.from({ length: count }, (_, index) => ({ ...staticIp, ip: `10.0.0.${index}` }))
      },
      capacity: 2,
    })
    const first = await pool.getProxy()
    const second = await pool.getProxy()
    expect(first.ip).not.toBe(second.ip)
    const third = await pool.getProxy()
    expect(fetched).toEqual([2, 2])
    expect(third.ip).toMatch(/^10\.0\.0\./)
  })

  it('getOrRefreshProxy switches when the current proxy nears expiry', async () => {
    let nowTs = 900
    const pool = new ProxyIpPool({
      provider: async (count) => Array.from({ length: count }, (_, index) => ({ ...staticIp, ip: `10.0.0.${index}`, expiredTimeTs: 1000 })),
      capacity: 2,
      nowTs: () => nowTs,
    })
    const first = await pool.getOrRefreshProxy()
    expect(pool.activeProxy()).toBe(first)
    nowTs = 980
    const second = await pool.getOrRefreshProxy()
    expect(second.ip).not.toBe(first.ip)
  })

  it('retries the provider three times then throws PROXY_FETCH_FAILED', async () => {
    let calls = 0
    const pool = new ProxyIpPool({
      provider: async () => {
        calls += 1
        throw new Error('provider down')
      },
      capacity: 2,
    })
    await expect(pool.getProxy()).rejects.toMatchObject({ code: 'PROXY_FETCH_FAILED' })
    expect(calls).toBe(3)
  })
})

describe('refreshProxyIfExpired', () => {
  const poolOf = (expired: boolean): ProxyIpPool =>
    ({
      isCurrentProxyExpired: () => expired,
      getOrRefreshProxy: async () => staticIp,
    }) as unknown as ProxyIpPool

  it('passes straight through when the switch is off', async () => {
    const rebuild = vi.fn()
    await refreshProxyIfExpired({ enabled: false, pool: poolOf(true), rebuild, warn: () => {} })
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('switches and rebuilds when expired; keeps the old proxy on failure', async () => {
    const rebuild = vi.fn()
    await refreshProxyIfExpired({ enabled: true, pool: poolOf(true), rebuild, warn: () => {} })
    expect(rebuild).toHaveBeenCalledWith(staticIp)
    const warnings: string[] = []
    const failingPool = {
      isCurrentProxyExpired: () => true,
      getOrRefreshProxy: async () => {
        throw new Error('down')
      },
    } as unknown as ProxyIpPool
    await refreshProxyIfExpired({ enabled: true, pool: failingPool, rebuild, warn: (message) => warnings.push(message) })
    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(warnings).toHaveLength(1)
  })

  it('does nothing when the current proxy is still fresh', async () => {
    const rebuild = vi.fn()
    await refreshProxyIfExpired({ enabled: true, pool: poolOf(false), rebuild, warn: () => {} })
    expect(rebuild).not.toHaveBeenCalled()
  })
})
