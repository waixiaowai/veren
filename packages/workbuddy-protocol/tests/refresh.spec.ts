/**
 * 刷新规格：惰性判定、嵌套信封解包、轮换语义、判别头。全部离线。
 * Refresh specs: laziness, nested-envelope extraction, rotation semantics,
 * discriminator headers. All offline.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { callRefresh, needsRefresh, REFRESH_MARGIN_MS, refreshHeaders, type RefreshableCredential } from '../src/index.ts'
import { startMockUpstream } from './support/mock-upstream.ts'

function credential(overrides: Partial<RefreshableCredential> = {}): RefreshableCredential {
  return {
    accessToken: 'at-old', refreshToken: 'rt-old', expiresAtMs: Date.now() + 3_600_000,
    domain: 'codebuddy.cn', uid: 'u-1', region: 'cn', ...overrides,
  }
}

describe('needsRefresh 惰性判定 / laziness', () => {
  it('距过期 > 边际不刷；≤ 边际刷', () => {
    const now = 1_000_000
    const fresh = credential({ expiresAtMs: now + REFRESH_MARGIN_MS + 1 })
    const marginal = credential({ expiresAtMs: now + REFRESH_MARGIN_MS })
    expect(needsRefresh(fresh, now)).toBe(false)
    expect(needsRefresh(marginal, now)).toBe(true)
  })

  it('无 refresh token 回答"不需要"——报"需要"会让每次调用注定失败地试一轮', () => {
    const now = 1_000_000
    expect(needsRefresh(credential({ refreshToken: '', expiresAtMs: now }), now)).toBe(false)
  })
})

describe('信封解包 / envelope extraction', () => {
  it('fixture 回放：双重嵌套 {data:{data:{...}}} 也能抽出令牌', async () => {
    const { extractRefreshTokens } = await import('../src/index.ts')
    const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'refresh-nested.json'), 'utf8'))
    const tokens = extractRefreshTokens(fixture)
    expect(tokens?.accessToken).toBe('at-rotated')
    expect(tokens?.refreshToken).toBe('rt-rotated')
    expect(tokens?.expiresInSec).toBe(86400)
  })

  it('缺 accessToken 回答 undefined（不是部分令牌）', async () => {
    const { extractRefreshTokens } = await import('../src/index.ts')
    expect(extractRefreshTokens({ data: { refreshToken: 'r' } })).toBeUndefined()
    expect(extractRefreshTokens('nope')).toBeUndefined()
  })
})

describe('线路语义 / wire semantics', () => {
  it('轮换：上游给了新 refresh token 就落新值', async () => {
    const upstream = await startMockUpstream()
    try {
      const result = await callRefresh(credential(), { fetchImpl: fetch, baseUrl: upstream.origin })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.tokens.accessToken).toBe('at-new')
        expect(result.tokens.refreshToken).toBe('rt-new')
      }
    } finally {
      await upstream.close()
    }
  })

  it('上游未给新 refresh token：旧令牌仍有效，调用方保留旧值（tokens.refreshToken 缺席）', async () => {
    const upstream = await startMockUpstream()
    try {
      upstream.refreshBody = '{"code":0,"data":{"data":{"accessToken":"at-2","expiresIn":600}}}'
      const result = await callRefresh(credential(), { fetchImpl: fetch, baseUrl: upstream.origin })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.tokens.refreshToken).toBeUndefined()
    } finally {
      await upstream.close()
    }
  })

  it('401 → session_dead（需要重新登录，不是可重试故障）', async () => {
    const upstream = await startMockUpstream()
    try {
      upstream.refreshStatus = 401
      upstream.refreshBody = '{"code":12153,"msg":"Offline user session not found"}'
      const result = await callRefresh(credential(), { fetchImpl: fetch, baseUrl: upstream.origin })
      expect(result).toMatchObject({ ok: false, kind: 'session_dead' })
    } finally {
      await upstream.close()
    }
  })

  it('X-Refresh-Token 只出现在刷新头；判别头按区域表取（cn=workbuddy / global=plugin）', () => {
    const cn = refreshHeaders(credential())
    expect(cn['X-Auth-Refresh-Source']).toBe('workbuddy')
    expect(cn['X-Refresh-Token']).toBe('rt-old')
    const global = refreshHeaders(credential({ region: 'global', domain: 'workbuddy.ai' }))
    expect(global['X-Auth-Refresh-Source']).toBe('plugin')
    expect(global['Accept-Language']).toBe('en-US')
  })
})
