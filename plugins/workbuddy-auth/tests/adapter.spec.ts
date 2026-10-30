/**
 * 适配器规格：路由注册面、重试策略、错误→llm-retry 映射（冷却联动）、SSE
 * 聚合、未登录响亮门。
 * Adapter specs: the registration face, the retry policy, the error → llm-retry
 * mapping (with cooldown coupling), SSE aggregation, the loud sign-in gate.
 */
import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WorkbuddyAdapter } from '../src/adapter.ts'
import { WorkbuddyCatalog } from '../src/catalog.ts'
import { resolveConfig } from '../src/config.ts'
import { WorkbuddyAccounts } from '../src/state-store.ts'
import { createFakeHost, RECORD, type FakeCredentials } from './support/fake-host.ts'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { emptyStateDocument, withAccountEntry, type WorkbuddyAccountEntry } from '@veren/workbuddy-protocol'

const SSE = 'data: {"choices":[{"index":0,"delta":{"reasoning_content":"想"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\ndata: [DONE]\n\n'

function entry(uid: string, overrides: Partial<WorkbuddyAccountEntry> = {}): WorkbuddyAccountEntry {
  return {
    accessToken: `at-${uid}`, refreshToken: `rt-${uid}`, expiresAtMs: Date.now() + 3_600_000,
    domain: 'codebuddy.cn', uid, ...overrides,
  }
}

async function seed(credentials: FakeCredentials, ...accounts: WorkbuddyAccountEntry[]): Promise<void> {
  let document = emptyStateDocument()
  for (const account of accounts) document = withAccountEntry(document, account)
  credentials.records.set(RECORD, { kind: 'grant', payload: document })
}

/** 指向 mock 的适配器整套。A whole adapter wired against a mock base URL. */
function makeAdapter(baseUrl: string, credentials: FakeCredentials, ctx: ReturnType<typeof createFakeHost>['ctx']) {
  const config = resolveConfig({})
  const accounts = new WorkbuddyAccounts(ctx)
  const catalog = new WorkbuddyCatalog(config, accounts, Date.now, baseUrl)
  return { adapter: new WorkbuddyAdapter({ config, accounts, catalog, baseUrl }), accounts, catalog, config }
}

/** 起 chat mock（可编程状态/体）。Starts a chat mock (programmable status/body). */
async function startChatMock(): Promise<{ origin: string; setStatus: (status: number, body: string) => void; requests: { path: string; headers: Record<string, string | string[] | undefined>; body: string }[]; close: () => Promise<void> }> {
  const requests: { path: string; headers: Record<string, string | string[] | undefined>; body: string }[] = []
  let status = 200
  let body = SSE
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      requests.push({ path: req.url ?? '', headers: { ...req.headers }, body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(status, { 'content-type': 'text/event-stream' })
      res.end(body)
    })
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    setStatus: (next, nextBody) => { status = next; body = nextBody },
    requests,
    close: () => new Promise(resolve => { server.close(() => resolve()) }),
  }
}

/** 收割聚合后的块序列。Collects the aggregated chunk sequence. */
async function collect(chunks: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of chunks) out.push(chunk)
  return out
}

describe('注册面 / registration face', () => {
  it('providerInfo 保持 id 与非空名；他路由不声明重试策略', () => {
    const { ctx, credentials } = createFakeHost()
    const { adapter } = makeAdapter('http://127.0.0.1:1', credentials, ctx)
    expect(adapter.providerInfo('workbuddy')).toEqual({ id: 'workbuddy', name: 'WorkBuddy' })
    expect(adapter.providerRetryPolicy('other')).toBeUndefined()
  })

  it('重试策略：可重试集含 RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT/EMPTY_RESPONSE，刻意排除 ACCOUNT_QUOTA/AUTH', () => {
    const { ctx, credentials } = createFakeHost()
    const { adapter } = makeAdapter('http://127.0.0.1:1', credentials, ctx)
    const policy = adapter.providerRetryPolicy('workbuddy')
    expect(policy).toMatchObject({ mode: 'normal', maxRetries: 5, maxDelayMs: 30_000 })
    const codes = policy !== undefined && policy.mode === 'normal' ? [...policy.retryableCodes] : []
    expect(codes).toContain('RATE_LIMIT')
    expect(codes).toContain('SERVER')
    expect(codes).not.toContain('ACCOUNT_QUOTA')
    expect(codes).not.toContain('AUTH')
    expect(codes).not.toContain('INVALID_REQUEST')
  })
})

describe('流面 / stream face', () => {
  it('未登录响亮报 SIGN_IN_REQUIRED（不静默不回退）', async () => {
    const mock = await startChatMock()
    try {
      const { ctx, credentials } = createFakeHost()
      const { adapter } = makeAdapter(mock.origin, credentials, ctx)
      await expect(collect(adapter.stream({
        provider: 'workbuddy', model: 'cn:glm-5.3', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as never))).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' })
      expect(mock.requests).toHaveLength(0)
    } finally {
      await mock.close()
    }
  })

  it('SSE 聚合：reasoning→text→usage→finish，区域头族与裸上游 id 上线', async () => {
    const mock = await startChatMock()
    try {
      const { ctx, credentials } = createFakeHost()
      await seed(credentials, entry('u-1'))
      const { adapter, config } = makeAdapter(mock.origin, credentials, ctx)
      const chunks = await collect(adapter.stream({
        provider: 'workbuddy', model: 'cn:glm-5.3',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as never))
      const kinds = chunks.map(chunk => chunk.type)
      expect(kinds).toEqual(['block-start', 'reasoning-delta', 'block-start', 'text-delta', 'block-end', 'block-end', 'usage', 'finish'])
      const request = mock.requests[0]
      expect(request?.path).toBe('/v2/chat/completions')
      expect(JSON.parse(request?.body ?? '{}').model).toBe('glm-5.3')
      expect(request?.headers['x-agent-intent']).toBe('craft')
      // 2026-10-30 实测：CN 也发 X-Agent-Type: main（风控与国际版收敛）。
      // Measured 2026-10-30: CN sends X-Agent-Type: main too (risk control converged).
      expect(request?.headers['x-agent-type']).toBe('main')
      expect(request?.headers['origin']).toBe('https://www.codebuddy.cn')
      expect(config).toBeDefined()
    } finally {
      await mock.close()
    }
  })

  it('429+14018 → ACCOUNT_QUOTA（不可重试），且该账号被冷却 1h：下次请求落健康账号', async () => {
    const mock = await startChatMock()
    try {
      const { ctx, credentials } = createFakeHost()
      await seed(credentials, entry('u-1'), entry('u-2'))
      const { adapter, accounts } = makeAdapter(mock.origin, credentials, ctx)
      mock.setStatus(429, '{"error":{"data":{"code":14018,"msg":"额度已用尽"}}}')
      const first = adapter.stream({
        provider: 'workbuddy', model: 'cn:glm-5.3', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as never)
      await expect(collect(first)).rejects.toMatchObject({ code: 'ACCOUNT_QUOTA' })
      const document = await accounts.read()
      expect(document.cooldowns['u-1']).toBeGreaterThan(Date.now() + 3_000_000)
      // 第二次请求自动落健康账号（u-1 已冷却），成功返回。
      mock.setStatus(200, SSE)
      const chunks = await collect(adapter.stream({
        provider: 'workbuddy', model: 'cn:glm-5.3', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as never))
      expect(chunks.at(-1)?.type).toBe('finish')
    } finally {
      await mock.close()
    }
  })

  it('401 → AUTH；429 无额度标记 → RATE_LIMIT（可重试）', async () => {
    const mock = await startChatMock()
    try {
      const { ctx, credentials } = createFakeHost()
      await seed(credentials, entry('u-1', { expiresAtMs: Date.now() + 3_600_000 }))
      const { adapter } = makeAdapter(mock.origin, credentials, ctx)
      mock.setStatus(401, '{"code":12153,"msg":"Offline user session not found"}')
      await expect(collect(adapter.stream({
        provider: 'workbuddy', model: 'cn:glm-5.3', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as never))).rejects.toMatchObject({ code: 'AUTH' })
      mock.setStatus(429, 'too many')
      await expect(collect(adapter.stream({
        provider: 'workbuddy', model: 'cn:glm-5.3', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      } as never))).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    } finally {
      await mock.close()
    }
  })

  it('原始会话 id 只进粘性/派生，绝不外发上游', async () => {
    const mock = await startChatMock()
    try {
      const { ctx, credentials } = createFakeHost()
      await seed(credentials, entry('u-1'))
      const { adapter } = makeAdapter(mock.origin, credentials, ctx)
      await collect(adapter.stream({
        provider: 'workbuddy', model: 'cn:glm-5.3',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        sessionId: 'sess-raw-should-not-travel' } as never))
      expect(JSON.stringify(mock.requests[0]?.headers)).not.toContain('sess-raw-should-not-travel')
    } finally {
      await mock.close()
    }
  })
})
