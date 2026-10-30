/**
 * 计费规格：个人/企业选路、余额取值优先级、-1 无上限独立 flag、字段缺失硬
 * 错误（不是 0）。
 * Billing specs: personal/enterprise routing, remaining-credit precedence, the
 * `-1` uncapped flag, missing fields as hard errors (never 0).
 */
import { describe, expect, it } from 'vitest'
import { fetchCredits, type RefreshableCredential } from '../src/index.ts'
import { startMockUpstream } from './support/mock-upstream.ts'

function credential(region: 'cn' | 'global', enterpriseId?: string): RefreshableCredential {
  return {
    accessToken: 'at-1', refreshToken: 'rt-1', expiresAtMs: Date.now() + 3_600_000,
    domain: region === 'global' ? 'workbuddy.ai' : 'codebuddy.cn',
    uid: 'u-1', ...(enterpriseId === undefined ? {} : { enterpriseId }), region,
  }
}

describe('个人端点 / personal endpoint', () => {
  it('取值优先级：CycleCapacityRemain 优先，负值钳 0', async () => {
    const upstream = await startMockUpstream()
    try {
      upstream.billingBody = JSON.stringify({
        code: 0, data: { Response: { Data: { Accounts: [
          { PackageName: '基础包', CycleCapacitySize: 100, CycleCapacityRemain: 37, CapacityRemain: 5 },
          { PackageName: '加量包', CapacitySize: 50, CapacityRemain: -3 },
        ] } } },
      })
      const credits = await fetchCredits(credential('global'), { fetchImpl: fetch, baseUrl: upstream.origin })
      expect(credits.total).toBe(37)
      expect(credits.accounts).toHaveLength(2)
      expect(credits.accounts[1]).toMatchObject({ remain: 0, size: 50 })
    } finally {
      await upstream.close()
    }
  })

  it('cn + enterpriseId 走企业端点；国际凭据带 enterpriseId 留在个人路径（区域闸承重）', async () => {
    const upstream = await startMockUpstream()
    try {
      upstream.billingBody = '{"code":0,"data":{"limitNum":10,"credit":1}}'
      await fetchCredits(credential('global', 'ent-1'), { fetchImpl: fetch, baseUrl: upstream.origin })
      expect(upstream.requests.at(-1)?.path).toBe('/v2/billing/meter/get-user-resource')
      await fetchCredits(credential('cn', 'ent-1'), { fetchImpl: fetch, baseUrl: upstream.origin })
      expect(upstream.requests.at(-1)?.path).toBe('/v2/billing/meter/get-enterprise-user-usage')
    } finally {
      await upstream.close()
    }
  })
})

describe('CN 企业端点 / CN enterprise endpoint', () => {
  it('limitNum-credit 形状；周期重置时间透传', async () => {
    const upstream = await startMockUpstream()
    try {
      upstream.billingBody = '{"code":0,"data":{"limitNum":1000,"credit":240,"cycleResetTime":"2026-11-01"}}'
      const credits = await fetchCredits(credential('cn', 'ent-1'), { fetchImpl: fetch, baseUrl: upstream.origin })
      expect(credits).toMatchObject({ total: 760, cycleResetTime: '2026-11-01' })
      expect(credits.accounts[0]).toMatchObject({ packageName: 'enterprise', remain: 760, size: 1000 })
    } finally {
      await upstream.close()
    }
  })

  it('limit_num/used_num 拼写同样收下', async () => {
    const upstream = await startMockUpstream()
    try {
      upstream.billingBody = '{"code":0,"data":{"limit_num":100,"used_num":10}}'
      const credits = await fetchCredits(credential('cn', 'ent-1'), { fetchImpl: fetch, baseUrl: upstream.origin })
      expect(credits.total).toBe(90)
    } finally {
      await upstream.close()
    }
  })

  it('-1 = 无上限：独立 flag，绝不渲染成 0', async () => {
    const upstream = await startMockUpstream()
    try {
      upstream.billingBody = '{"code":0,"data":{"limitNum":-1,"credit":5}}'
      const credits = await fetchCredits(credential('cn', 'ent-1'), { fetchImpl: fetch, baseUrl: upstream.origin })
      expect(credits.unlimited).toBe(true)
      expect(credits.accounts[0]?.unlimited).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  it('配额在而用量字段缺失：硬错误（默认 0 会渲染出自信的"配额全满"）', async () => {
    const upstream = await startMockUpstream()
    try {
      upstream.billingBody = '{"code":0,"data":{"limitNum":100}}'
      await expect(fetchCredits(credential('cn', 'ent-1'), { fetchImpl: fetch, baseUrl: upstream.origin })).rejects.toThrow('no recognised usage field')
    } finally {
      await upstream.close()
    }
  })

  it('无任何可识别配额字段：硬错误', async () => {
    const upstream = await startMockUpstream()
    try {
      upstream.billingBody = '{"code":0,"data":{"unexpected":true}}'
      await expect(fetchCredits(credential('cn', 'ent-1'), { fetchImpl: fetch, baseUrl: upstream.origin })).rejects.toThrow('no recognised quota field')
    } finally {
      await upstream.close()
    }
  })
})
