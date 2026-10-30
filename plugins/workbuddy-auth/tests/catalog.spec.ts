/**
 * 目录规格：可见性门（无账号整区隐藏）、失败保旧、401 不清登录、staleness
 * 后台刷新。
 * Catalog specs: the visibility gate (a region without accounts hides), old
 * catalog survives failures, 401 never clears sign-in, stale background
 * refresh.
 */
import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WorkbuddyCatalog } from '../src/catalog.ts'
import { resolveConfig } from '../src/config.ts'
import { WorkbuddyAccounts } from '../src/state-store.ts'
import { createFakeHost, RECORD, type FakeCredentials } from './support/fake-host.ts'
import { emptyStateDocument, withAccountEntry, type WorkbuddyAccountEntry } from '@veren/workbuddy-protocol'

const CATALOG_OK = '{"code":0,"data":{"models":[{"id":"glm-5.3","name":"GLM-5.3","maxInputTokens":1000,"maxOutputTokens":100,"supportsImages":false}],"agents":[{"name":"cli","models":["glm-5.3"]}]}}'

function entry(uid: string, domain: string): WorkbuddyAccountEntry {
  return { accessToken: `at-${uid}`, refreshToken: `rt-${uid}`, expiresAtMs: Date.now() + 3_600_000, domain, uid }
}

async function seed(credentials: FakeCredentials, ...accounts: WorkbuddyAccountEntry[]): Promise<void> {
  let document = emptyStateDocument()
  for (const account of accounts) document = withAccountEntry(document, account)
  credentials.records.set(RECORD, { kind: 'grant', payload: document })
}

async function startServer(): Promise<{ origin: string; setCatalog: (status: number, body: string) => void; close: () => Promise<void> }> {
  let status = 200
  let body = CATALOG_OK
  const server: Server = createServer((req, res) => {
    void req
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body)
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    setCatalog: (next, nextBody) => { status = next; body = nextBody },
    close: () => new Promise(resolve => { server.close(() => resolve()) }),
  }
}

describe('可见性门 / visibility gate', () => {
  it('某区域没有账号就整区隐藏；两区域都有则并存（区域标签在显示名里）', async () => {
    const { ctx, credentials } = createFakeHost()
    await seed(credentials, entry('u-cn', 'codebuddy.cn'))
    const catalog = new WorkbuddyCatalog(resolveConfig({}), { read: () => (ctx.credentials).readRecord(RECORD).then(record => (record?.kind === 'grant' ? (record.payload as never) : emptyStateDocument())) })
    const models = await catalog.listModels()
    expect(models).toHaveLength(16)
    expect(models.every(model => model.id.startsWith('cn:'))).toBe(true)
    await seed(credentials, entry('u-cn', 'codebuddy.cn'), entry('u-gl', 'workbuddy.ai'))
    const both = await new WorkbuddyCatalog(resolveConfig({}), {
      read: async () => {
        const record = await ctx.credentials.readRecord(RECORD)
        return record?.kind === 'grant' ? record.payload as never : emptyStateDocument()
      },
    }).listModels()
    expect(both.some(model => model.id.startsWith('global:'))).toBe(true)
    expect(both.some(model => model.name.includes('国际'))).toBe(true)
  })
})

describe('在线刷新 / live refresh', () => {
  it('成功后目录替换为在线清单；失败保旧目录（401 也不清登录）', async () => {
    const server = await startServer()
    try {
      const { ctx, credentials } = createFakeHost()
      await seed(credentials, entry('u-cn', 'codebuddy.cn'))
      const accounts = new WorkbuddyAccounts(ctx)
      const catalog = new WorkbuddyCatalog(resolveConfig({ catalogMaxAgeMs: 60_000 }), accounts, Date.now, server.origin)
      await catalog.refresh('cn')
      const live = await catalog.listModels()
      expect(live.map(model => model.id)).toEqual(['cn:glm-5.3'])
      // 上游翻脸（401）：目录保旧、凭据记录不动。
      server.setCatalog(401, '{"code":12153,"msg":"session dead"}')
      await expect(catalog.refresh('cn')).rejects.toThrow()
      expect(await catalog.listModels()).toEqual(live)
      expect(credentials.records.has(RECORD)).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('staleness：过期后 listModels 触发后台刷新（不阻塞本次答案）', async () => {
    const server = await startServer()
    try {
      const { ctx, credentials } = createFakeHost()
      await seed(credentials, entry('u-cn', 'codebuddy.cn'))
      const accounts = new WorkbuddyAccounts(ctx)
      let clock = 1_000_000
      const catalog = new WorkbuddyCatalog(resolveConfig({ catalogMaxAgeMs: 1_000 }), accounts, () => clock, server.origin)
      // 从未取过：isStale 为真，listModels 走兜底并触发后台刷新。
      const models = await catalog.listModels()
      expect(models.length).toBe(16)
      for (let waited = 0; waited < 100; waited++) {
        if (catalog.current('cn').some(model => model.id === 'glm-5.3')) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(catalog.current('cn').some(model => model.id === 'glm-5.3')).toBe(true)
      clock += 60_000
    } finally {
      await server.close()
    }
  })
})
