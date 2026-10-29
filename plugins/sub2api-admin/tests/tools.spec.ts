/**
 * 单元测试：凭据解析、信封解析、JWT 重登、store 切片刷新与 6 个应用工具的
 * 动作→端点映射，全部走 mock `fetch`，不触网，用例并发安全。
 * Unit tests: credential resolution, envelope parsing, JWT re-login, store-slice
 * refreshes, and the 6 app tools' action→endpoint mapping over a mocked fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Sub2AdminClient, resolveSettings } from '../src/client.ts'
import { Sub2ApiStore } from '../src/store.ts'
import { createAppTools } from '../src/tools.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Install a mocked fetch capturing calls and answering from a handler. */
function mockFetch(handler: (url: string, init: RequestInit) => { status?: number, body?: unknown }) {
  const calls: { url: string, init: RequestInit }[] = []
  const fetchMock = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const record = { url: String(url), init }
    calls.push(record)
    const answer = handler(record.url, record.init)
    return new Response(JSON.stringify({ code: 0, message: 'success', data: answer.body ?? null }), {
      status: answer.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

/** Call a built tool without a real execution context. */
function runTool(tool: ToolDefinition, args: Record<string, unknown>, exec?: unknown): Promise<{ result: unknown }> {
  return (tool.execute as (a: Record<string, unknown>, e: unknown) => Promise<{ result: unknown }>)(args, exec)
}

/** 带本回合人类消息的假 exec（L2 门放行形态）/ a fake exec carrying a human message this turn (the L2 gate's allow shape) */
function consentedExec(): unknown {
  return { agent: { session: { deriveMessages: () => [
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '把订单 7 退款' }] },
  ] } } }
}

/** Build the catalog and pick one local tool. */
function toolOf(name: string, client: Sub2AdminClient, store = new Sub2ApiStore()): ToolDefinition {
  const tool = createAppTools(client, store).find(entry => entry.name === name)
  if (tool === undefined) throw new Error(`tool not found: ${name}`)
  return tool
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.SUB2API_BASE_URL
  delete process.env.SUB2API_ADMIN_API_KEY
  delete process.env.SUB2API_JWT
  delete process.env.SUB2API_EMAIL
  delete process.env.SUB2API_PASSWORD
})

describe('resolveSettings', () => {
  it('prefers config over environment and applies the timeout default', () => {
    process.env.SUB2API_BASE_URL = 'https://env.example.com/'
    const settings = resolveSettings({ baseUrl: 'https://config.example.com', timeoutMs: 1234 })
    expect(settings.baseUrl).toBe('https://config.example.com')
    expect(settings.timeoutMs).toBe(1234)
  })

  it('reads the environment when the config omits a field and normalizes the URL', () => {
    process.env.SUB2API_BASE_URL = 'https://env.example.com///'
    expect(resolveSettings({}).baseUrl).toBe('https://env.example.com')
  })

  it('fails loud without any base URL', () => {
    expect(() => resolveSettings({})).toThrow(/baseUrl is missing/)
  })
})

describe('Sub2AdminClient', () => {
  it('logs in with email+password and sends the bearer token afterwards', async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith('/api/v1/auth/login')) return { body: { access_token: 'jwt-1' } }
      return { body: { ok: true } }
    })
    const client = new Sub2AdminClient({ baseUrl: 'https://x.example.com', email: 'a@b.c', password: 'p' })
    await client.request('GET', '/admin/dashboard/stats')
    await client.request('GET', '/admin/groups/all')
    expect(calls).toHaveLength(3)
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[1]?.init.headers).toMatchObject({ Authorization: 'Bearer jwt-1' })
  })

  it('re-logs in once on 401 and retries the original request', async () => {
    let statsCalls = 0
    const calls = mockFetch((url) => {
      if (url.endsWith('/auth/login')) return { body: { access_token: `jwt-${calls.length}` } }
      if (url.includes('/admin/accounts/7')) {
        statsCalls += 1
        return statsCalls === 1 ? { status: 401, body: null } : { body: { id: 7 } }
      }
      return { body: null }
    })
    const client = new Sub2AdminClient({ baseUrl: 'https://x.example.com', email: 'a@b.c', password: 'p' })
    expect(await client.request('GET', '/admin/accounts/7')).toEqual({ id: 7 })
    expect(statsCalls).toBe(2)
    expect(calls.filter(call => call.url.endsWith('/auth/login'))).toHaveLength(2)
  })

  it('uses the admin API key header without any login', async () => {
    const calls = mockFetch(() => ({ body: {} }))
    const client = new Sub2AdminClient({ baseUrl: 'https://x.example.com', adminApiKey: 'key-1' })
    await client.request('GET', '/admin/users')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.init.headers).toMatchObject({ 'x-api-key': 'key-1' })
  })
})

describe('Sub2ApiStore', () => {
  it('refreshHome merges stats, payment, and availability', async () => {
    mockFetch((url) => {
      if (url.includes('/payment/dashboard')) return { body: { today_count: 1 } }
      if (url.includes('/account-availability')) return { body: { enabled: true } }
      return { body: { rpm: 5, today_requests: 12 } }
    })
    const store = new Sub2ApiStore()
    let notified = 0
    const unsubscribe = store.subscribe(() => { notified += 1 })
    await store.refreshHome(new Sub2AdminClient({ baseUrl: 'https://x.example.com', adminApiKey: 'k' }))
    unsubscribe()
    expect(store.getSnapshot().home?.stats).toMatchObject({ rpm: 5 })
    expect(store.getSnapshot().home?.payment).toEqual({ today_count: 1 })
    expect(notified).toBe(1)
  })

  it('refreshChannels / refreshCodes fill their slices', async () => {
    mockFetch((url) => {
      if (url.includes('/channels')) return { body: { items: [{ id: 3, name: 'ch' }], total: 1 } }
      if (url.includes('/redeem-codes/stats')) return { body: { total_codes: 4 } }
      if (url.includes('/redeem-codes')) return { body: { items: [{ id: 1 }] } }
      return { body: { items: [{ id: 2 }] } }
    })
    const store = new Sub2ApiStore()
    const client = new Sub2AdminClient({ baseUrl: 'https://x.example.com', adminApiKey: 'k' })
    await store.refreshChannels(client)
    await store.refreshCodes(client)
    expect(store.getSnapshot().channels).toEqual([{ id: 3, name: 'ch' }])
    expect(store.getSnapshot().codes?.redeem).toEqual([{ id: 1 }])
    expect(store.getSnapshot().codes?.promo).toEqual([{ id: 2 }])
  })

  it('refreshUsage fills range, trend, and models slices', async () => {
    mockFetch((url) => {
      if (url.includes('/dashboard/trend')) return { body: { trend: [{ date: '2026-10-20' }] } }
      if (url.includes('/dashboard/models')) return { body: { models: [{ model: 'gpt' }] } }
      return { body: { total_requests: 3 } }
    })
    const store = new Sub2ApiStore()
    await store.refreshUsage(new Sub2AdminClient({ baseUrl: 'https://x.example.com', adminApiKey: 'k' }))
    expect(store.getSnapshot().usage?.trend).toEqual([{ date: '2026-10-20' }])
    expect(store.getSnapshot().usage?.models).toEqual([{ model: 'gpt' }])
    expect(store.getSnapshot().usage?.range).toEqual({ total_requests: 3 })
  })

  it('refreshAll records one failing slice without dropping the others', async () => {
    mockFetch((url) => {
      if (url.includes('/admin/dashboard/stats')) return { status: 500, body: null }
      if (url.includes('/admin/accounts')) return { body: { items: [{ id: 1 }] } }
      return { body: {} }
    })
    const store = new Sub2ApiStore()
    await store.refreshAll(new Sub2AdminClient({ baseUrl: 'https://x.example.com', adminApiKey: 'k' }))
    expect(store.getSnapshot().accounts).toEqual([{ id: 1 }])
    expect(store.getSnapshot().error).toMatch(/failed \(500\)/)
  })
})

describe('app tools', () => {
  const client = new Sub2AdminClient({ baseUrl: 'https://x.example.com', adminApiKey: 'k' })

  it.each([
    ['accounts', { action: 'list', page: 2, page_size: 10, status: 'active' }, '/admin/accounts?page=2&page_size=10&status=active'],
    ['accounts', { action: 'bulk_update', ids: [1, 2], patch: { concurrency: 5 } }, '/admin/accounts/bulk-update'],
    ['channels', { action: 'create', payload: { name: 'ch', platform: 'openai' } }, '/admin/channels'],
    ['groups', { action: 'set_rates', id: 1, payload: { 'gpt-4': 1.5 } }, '/admin/groups/1/rate-multipliers'],
    ['users', { action: 'balance', id: 3, balance: 10, operation: 'add' }, '/admin/users/3/balance'],
    ['subscriptions', { action: 'assign', payload: { user_id: 3, group_id: 1 } }, '/admin/subscriptions/assign'],
    ['payment', { action: 'order_refund', id: 7, payload: { amount: 1 } }, '/admin/payment/orders/7/refund'],
    ['payment', { action: 'plan_create', payload: { name: 'p' } }, '/admin/payment/plans'],
    ['promo_codes', { action: 'create', payload: { code: 'X' } }, '/admin/promo-codes'],
    ['redeem_codes', { action: 'stats' }, '/admin/redeem-codes/stats'],
    ['request', { method: 'GET', path: '/admin/proxies/all' }, '/admin/proxies/all'],
  ])('maps %s %o to %s', async (name, args, expectedPath) => {
    const calls = mockFetch(() => ({ body: {} }))
    // L2 行（refund）带本回合人类消息的 exec 才放行；其余行 exec 缺席照常直通
    // / the L2 row (refund) rides a consented exec; the rest pass without one
    const exec = name === 'payment' && (args as { action: string }).action === 'order_refund' ? consentedExec() : undefined
    const { result } = await runTool(toolOf(name, client), args, exec)
    expect(calls[0]?.url).toBe(`https://x.example.com/api/v1${expectedPath}`)
    expect(result).toEqual({})
  })

  it('unattended gate: L2 without a human message this turn is refused with the stable code', async () => {
    mockFetch(() => ({ body: {} }))
    // 无人形态：exec 缺席（无会话投影）→ fail-closed 拒绝
    // / the unattended shape: no exec (no session projection) → fail-closed refusal
    await expect(runTool(toolOf('payment', client), { action: 'order_refund', id: 7, payload: { amount: 1 } }))
      .rejects.toThrow(/unattended\/l2-refused/)
    await expect(runTool(toolOf('redeem_codes', client), { action: 'batch_delete', ids: [1] }))
      .rejects.toThrow(/unattended\/l2-refused/)
    await expect(runTool(toolOf('request', client), { method: 'DELETE', path: '/admin/promo-codes/1' }))
      .rejects.toThrow(/unattended\/l2-refused/)
    // 有人在场形态：本回合有 kind:'user' 消息 → 放行
    // / the human-present shape: a kind:'user' message this turn → allowed
    const calls = mockFetch(() => ({ body: {} }))
    await runTool(toolOf('payment', client), { action: 'order_refund', id: 7, payload: { amount: 1 } }, consentedExec())
    expect(calls[0]?.url).toContain('/admin/payment/orders/7/refund')
  })

  it('unattended gate: L1 writes run autonomously with no session face at all', async () => {
    const calls = mockFetch(() => ({ body: {} }))
    await runTool(toolOf('channels', client), { action: 'delete', id: 4 })
    expect(calls[0]?.url).toContain('/admin/channels/4')
  })

  it('overview joins stats, payment, and availability', async () => {
    const calls = mockFetch(() => ({ body: { rpm: 1 } }))
    const { result } = await runTool(toolOf('overview', client), {})
    expect(result).toEqual({ stats: { rpm: 1 }, payment: { rpm: 1 }, availability: { rpm: 1 } })
    // 3 tool fetches + the home-slice refresh after success (3 more)
    await vi.waitFor(() => expect(calls).toHaveLength(6))
  })

  it('redeem generate sends the idempotency header', async () => {
    const calls = mockFetch(() => ({ body: {} }))
    await runTool(toolOf('redeem_codes', client), { action: 'generate', count: 2, type: 'balance', value: 10, idempotency_key: 'order-1' })
    expect(calls[0]?.init.headers).toMatchObject({ 'Idempotency-Key': 'order-1' })
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ count: 2, type: 'balance', value: 10 })
  })

  it('accounts list refreshes the accounts store slice after success', async () => {
    mockFetch(() => ({ body: { items: [{ id: 9, name: 'acc' }], total: 1 } }))
    const store = new Sub2ApiStore()
    await runTool(toolOf('accounts', client, store), { action: 'list' })
    await vi.waitFor(() => expect(store.getSnapshot().accounts).toEqual([{ id: 9, name: 'acc' }]))
  })

  it('unknown actions fail loud', async () => {
    mockFetch(() => ({ body: {} }))
    // defineTool's argument validation rejects off-enum actions before dispatch
    await expect(runTool(toolOf('accounts', client), { action: 'explode' })).rejects.toThrow(/action/)
  })
})
