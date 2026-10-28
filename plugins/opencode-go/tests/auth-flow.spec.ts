/**
 * 登录授权流红绿：在线校验通过才提交凭据；校验失败不落任何凭据；
 * 本机导入按条目类型严格校验。
 * Sign-in flow red/green: the credential commits only after online validation
 * passes; a validation failure stores nothing; the local import enforces the
 * entry shape strictly.
 *
 * @module @veren/opencode-go/tests
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerOpencodeGoFlow, readLocalCliKey } from '../src/auth-flow.js'
import { GoCatalog } from '../src/catalog.js'
import { resolveConfig } from '../src/config.js'
import { OPENCODE_GO_RECORD } from '../src/credential.js'
import { ListingClient } from '../src/listing.js'
import { startMockGateway, type MockGateway } from './support/mock-gateway.js'

const config = resolveConfig({})

afterEach(async () => { /* 各用例自关网关 */ })

/** 假 ctx：捕获 registerFlow 的流与 credentials 写入。The fake ctx: captures the registered flow and credential writes. */
function fakeCtx() {
  const flows: { key: unknown; run: (session: unknown) => Promise<void> }[] = []
  const committed: unknown[] = []
  const ctx = {
    authorization: { registerFlow: (flow: never) => void flows.push(flow) },
    credentials: {
      modifyRecord: async (_key: unknown, mutate: () => Promise<unknown>) => {
        const next = await mutate()
        committed.push(next)
        return next
      },
    },
  }
  return { ctx, flows, committed }
}

/** 起流会话：通知入桶、提示逐条回答。Builds a session: notices bucket, prompts answered in order. */
function fakeSession(notices: unknown[], answers: unknown[]) {
  return {
    notify: (notice: unknown) => void notices.push(notice),
    prompt: async () => answers.length > 0 ? answers.shift() : '',
    method: 'console-key',
    signal: new AbortController().signal,
  }
}

describe('registerOpencodeGoFlow', () => {
  it('在线校验通过才提交 api-key 记录，且把 /auth 入口写进通知', async () => {
    const gateway = await startMockGateway()
    try {
      const { ctx, flows, committed } = fakeCtx()
      const resolved = resolveConfig({ listingBaseURL: gateway.url })
      registerOpencodeGoFlow(ctx as never, resolved, new GoCatalog(resolved, new ListingClient(resolved)))
      const flow = flows[0]
      expect(flow.key).toBe(OPENCODE_GO_RECORD)

      const notices: unknown[] = []
      await flow.run(fakeSession(notices, ['  sk-new-key  ']) as never)
      expect(committed).toEqual([{ kind: 'api-key', key: 'sk-new-key' }])
      expect(JSON.stringify(notices)).toContain('https://opencode.ai/auth')
    } finally {
      await gateway.close()
    }
  })

  it('校验失败（401）是响亮终局，凭据记录不落任何值', async () => {
    const gateway = await startMockGateway()
    gateway.modelsStatus = 401
    gateway.modelsBody = '{"error":{"message":"invalid"}}'
    try {
      const { ctx, flows, committed } = fakeCtx()
      const resolved = resolveConfig({ listingBaseURL: gateway.url })
      registerOpencodeGoFlow(ctx as never, resolved, new GoCatalog(resolved, new ListingClient(resolved)))
      await expect(flows[0].run(fakeSession([], ['sk-bad']) as never)).rejects.toThrowError(/HTTP 401/)
      expect(committed).toHaveLength(0)
    } finally {
      await gateway.close()
    }
  })
})

describe('readLocalCliKey', () => {
  it('按条目形状严格校验（type=api + 非空 key）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-go-'))
    const path = join(dir, 'auth.json')
    writeFileSync(path, JSON.stringify({ 'opencode-go': { type: 'api', key: 'sk-local' } }))
    expect(readLocalCliKey(path)).toBe('sk-local')

    writeFileSync(path, JSON.stringify({ 'opencode-go': { type: 'oauth', key: 'sk-x' } }))
    expect(() => readLocalCliKey(path)).toThrowError(/no opencode-go key/)

    writeFileSync(path, '{broken')
    expect(() => readLocalCliKey(path)).toThrowError(/cannot read/)
    expect(readFileSync(path, 'utf8')).toBe('{broken') // 只读：坏文件原样保留 / read-only: the broken file stays untouched
  })
})
