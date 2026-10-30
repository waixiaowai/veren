/**
 * OAuth 设备码流规格：三步形状、pending 形态、风控三规则（轮询下限/TTL/
 * 区域锁定）。全部离线打 mock 上游。
 * OAuth device-code specs: the three-step shapes, pending forms, and the three
 * risk-control rules (poll floor / TTL / region lock). All offline against the
 * mock upstream.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LoginClient, LoginExpiredError, LoginPendingError, MIN_POLL_INTERVAL_MS, LOGIN_TTL_MS } from '../src/index.ts'
import { startMockUpstream, type MockUpstream } from './support/mock-upstream.ts'

/** 起一个带登录答案的 mock。Starts a mock with the login answers wired. */
async function start(): Promise<MockUpstream> {
  const upstream = await startMockUpstream()
  return upstream
}

describe('LoginClient 流程 / flow', () => {
  it('begin 要 state 与 authUrl，并补 loginSessionId、不发 version', async () => {
    const upstream = await start()
    try {
      const client = new LoginClient({ fetchImpl: fetch, loginBaseOverride: upstream.origin })
      const request = await client.begin('cn')
      expect(request.state).toBe('st-1')
      expect(request.url).toContain('loginSessionId=')
      expect(request.url).not.toContain('version=')
      const recorded = upstream.requests.find(request => request.path.startsWith('/v2/plugin/auth/state'))
      expect(recorded?.path).toContain('platform=workbuddy')
      expect(recorded?.headers['origin']).toBe('https://www.codebuddy.cn')
      expect(recorded?.headers['user-agent']).toBe('CLI/2.63.2 CodeBuddy/2.63.2')
    } finally {
      await upstream.close()
    }
  })

  it('轮询 pending（11217）→ LoginPending；token 到位后 complete 退役 state', async () => {
    const upstream = await start()
    try {
      upstream.tokenBodies = [
        '{"code":11217,"msg":"11217:login ing"}',
        '{"code":0,"data":{"accessToken":"at-1","refreshToken":"rt-1","expiresIn":3600,"domain":"codebuddy.cn"}}',
      ]
      const client = new LoginClient({ fetchImpl: fetch, loginBaseOverride: upstream.origin, minPollIntervalMs: 0 })
      await client.begin('cn')
      await expect(client.poll('st-1')).rejects.toBeInstanceOf(LoginPendingError)
      const token = await client.poll('st-1')
      expect(token.accessToken).toBe('at-1')
      const result = await client.complete('st-1')
      expect(result.account.uid).toBe('u-1')
      expect(result.region).toBe('cn')
      // state 已退役：同一授权不得二次铸币。
      await expect(client.poll('st-1')).rejects.toBeInstanceOf(LoginExpiredError)
    } finally {
      await upstream.close()
    }
  })

  it('fixture 回放：11217 形态映射为 LoginPending', async () => {
    const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'login-pending.json'), 'utf8')) as { code: number; msg: string }
    expect(fixture.code).toBe(11217)
    const upstream = await start()
    try {
      upstream.tokenBody = JSON.stringify(fixture)
      const client = new LoginClient({ fetchImpl: fetch, loginBaseOverride: upstream.origin, minPollIntervalMs: 0 })
      await client.begin('cn')
      await expect(client.poll('st-1')).rejects.toBeInstanceOf(LoginPendingError)
    } finally {
      await upstream.close()
    }
  })

  it('未知 state → LoginExpired', async () => {
    const upstream = await start()
    try {
      const client = new LoginClient({ fetchImpl: fetch, loginBaseOverride: upstream.origin })
      await expect(client.poll('nope')).rejects.toBeInstanceOf(LoginExpiredError)
    } finally {
      await upstream.close()
    }
  })

  it('TTL：过期 attempt 报 LoginExpired', async () => {
    const upstream = await start()
    try {
      let now = 1_000_000
      const client = new LoginClient({ fetchImpl: fetch, loginBaseOverride: upstream.origin, now: () => now })
      await client.begin('cn')
      now += LOGIN_TTL_MS + 1
      await expect(client.poll('st-1')).rejects.toBeInstanceOf(LoginExpiredError)
    } finally {
      await upstream.close()
    }
  })
})

describe('风控不变式 / risk-control invariants', () => {
  it('轮询下限在发请求前执行：急躁重试到不了上游', async () => {
    const upstream = await start()
    try {
      let now = 0
      const client = new LoginClient({ fetchImpl: fetch, loginBaseOverride: upstream.origin, minPollIntervalMs: MIN_POLL_INTERVAL_MS, now: () => now })
      await client.begin('cn')
      await client.poll('st-1').catch(() => {})
      const before = upstream.requests.length
      now += 100
      await expect(client.poll('st-1')).rejects.toBeInstanceOf(LoginPendingError)
      // 请求计数未变 = 急躁重试根本没出门。
      expect(upstream.requests.length).toBe(before)
      now += MIN_POLL_INTERVAL_MS
      await client.poll('st-1').catch(() => {})
      expect(upstream.requests.length).toBe(before + 1)
    } finally {
      await upstream.close()
    }
  })

  it('state 区域锁定：区域从记录的尝试取，不由调用方传', async () => {
    const upstream = await start()
    try {
      upstream.tokenBodies = ['{"code":0,"data":{"accessToken":"a","refreshToken":"","expiresIn":60,"domain":"codebuddy.cn"}}']
      const client = new LoginClient({ fetchImpl: fetch, loginBaseOverride: upstream.origin, minPollIntervalMs: 0 })
      await client.begin('cn')
      await client.poll('st-1')
      const poll = upstream.requests.filter(request => request.path.startsWith('/v2/plugin/auth/token'))[0]
      // 该 state 只能兑在签发它的 host（此处经 override 统一到 mock，但头仍是 cn 区域的）。
      expect(poll?.headers['origin']).toBe('https://www.codebuddy.cn')
    } finally {
      await upstream.close()
    }
  })
})
