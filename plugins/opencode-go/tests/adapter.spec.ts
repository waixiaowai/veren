/**
 * 组合红绿：真实 mock 网关上的适配器全链路（凭据 → 头 → 翻译 → SSE 聚合）
 * 与登录门面（未登录空目录 / SIGN_IN_REQUIRED / 401 不清登录）。
 * Composition red/green: the adapter's full chain against a real mock gateway
 * (credential → headers → translation → SSE aggregation) and the sign-in
 * facade (empty catalog signed out / SIGN_IN_REQUIRED / 401 keeps the login).
 *
 * @module @veren/opencode-go/tests
 */
import { afterEach, describe, expect, it } from 'vitest'
import { OpencodeGoAdapter } from '../src/adapter.js'
import { GoCatalog } from '../src/catalog.js'
import { resolveConfig } from '../src/config.js'
import { OPENCODE_GO_RECORD } from '../src/credential.js'
import { ListingClient } from '../src/listing.js'
import { startMockGateway, type MockGateway } from './support/mock-gateway.js'

const config = resolveConfig({})
let gateway: MockGateway | undefined

afterEach(async () => {
  await gateway?.close()
  gateway = undefined
})

/** 假 ctx：只实现适配器读到的 credentials 面（读 + 写记录器）。The fake ctx: implements only the credentials face the adapter reads (reader plus recorder). */
function fakeCtx(key: string | undefined) {
  const writes: unknown[] = []
  return {
    writes,
    credentials: {
      readRecord: async (recordKey: unknown) => {
        expect(String(recordKey)).toBe(String(OPENCODE_GO_RECORD))
        return key === undefined ? undefined : { kind: 'api-key', key }
      },
      modifyRecord: async (_key: unknown, mutate: () => Promise<unknown>) => {
        writes.push(await mutate())
        return undefined
      },
    },
  }
}

function adapterWith(key: string | undefined, gw: MockGateway): { adapter: OpencodeGoAdapter; ctx: ReturnType<typeof fakeCtx> } {
  const ctx = fakeCtx(key)
  const resolved = resolveConfig({ baseURL: `${gw.url}/openai/v1`, listingBaseURL: gw.url })
  const catalog = new GoCatalog(resolved, new ListingClient(resolved))
  return { adapter: new OpencodeGoAdapter({ ctx: ctx as never, config: resolved, catalog }), ctx }
}

const userMessage = { id: 'm1', role: 'user', source: { kind: 'test' }, content: [{ type: 'text', text: 'Reply with exactly: OK' }] } as never

describe('OpencodeGoAdapter against the mock gateway', () => {
  it('全链路：鉴权头 + 会话头 + 翻译 + SSE 聚合 + finish 终局', async () => {
    gateway = await startMockGateway()
    const { adapter } = adapterWith('sk-live', gateway)
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      messages: [userMessage],
      sessionId: 'sess_7' as never,
      signal: new AbortController().signal,
    } as never)) chunks.push(chunk)

    const request = gateway.requests.find((entry) => entry.path.endsWith('/chat/completions'))
    expect(request).toBeDefined()
    expect(request?.headers.authorization).toBe('Bearer sk-live')
    expect(request?.headers['x-opencode-session']).toBe('sess_7')
    expect(JSON.parse(request?.body ?? '{}').model).toBe('deepseek-v4.1-flash')

    expect(chunks[0]).toEqual({ type: 'block-start', index: 0, blockType: 'reasoning' })
    expect(chunks.some((chunk) => chunk.type === 'text-delta' && chunk.text === 'OK')).toBe(true)
    expect(chunks.at(-1)?.type).toBe('finish')
    expect(chunks.some((chunk) => chunk.type === 'usage')).toBe(true)
  })

  it('未登录：请求路径响亮 SIGN_IN_REQUIRED，GUI 目录为空', async () => {
    gateway = await startMockGateway()
    const { adapter } = adapterWith(undefined, gateway)
    await expect(async () => {
      for await (const _chunk of adapter.stream({
        provider: 'opencode-go', model: 'deepseek-v4.1-flash', messages: [userMessage],
      } as never)) void _chunk
    }).rejects.toThrowError(/no API key is signed in/)
    expect(await adapter.listModels('opencode-go')).toEqual([])
    expect(gateway.requests).toHaveLength(0)
  })

  it('401 不清登录：抛 KEY_INVALID，凭据记录原样保留', async () => {
    gateway = await startMockGateway()
    gateway.chatStatus = 401
    gateway.chatBody = '{"error":{"message":"bad key"}}'
    const { adapter, ctx } = adapterWith('sk-expired', gateway)
    await expect(async () => {
      for await (const _chunk of adapter.stream({
        provider: 'opencode-go', model: 'deepseek-v4.1-flash', messages: [userMessage],
      } as never)) void _chunk
    }).rejects.toThrowError(/KEY_INVALID|HTTP 401/)
    // 适配器路径从不写凭据记录；清除只能是用户的显式动作。
    // The adapter path never writes the credential record; removal stays an explicit user action.
    expect(ctx.writes).toHaveLength(0)
  })
})
