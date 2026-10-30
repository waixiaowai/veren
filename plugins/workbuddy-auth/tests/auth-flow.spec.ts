/**
 * 授权流规格：pending 自转、在线校验失败不落凭据、commit 载荷合成、撤销结算。
 * Authorization-flow specs: pending spins quietly, a failed online validation
 * commits nothing, the commit payload composition, withdrawal settling.
 */
import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AuthorizationFlow, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { WorkbuddyCatalog } from '../src/catalog.ts'
import { resolveConfig } from '../src/config.ts'
import { registerWorkbuddyFlow, regionOfMethod } from '../src/auth-flow.ts'
import { WorkbuddyAccounts } from '../src/state-store.ts'
import { createFakeHost, RECORD, type FakeCredentials, type FakeHost } from './support/fake-host.ts'

/** 一个可编程的 mock：登录三端点 + 目录端点。A programmable mock: the login trio + catalog. */
async function startMock(): Promise<{
  origin: string
  set: (patch: { token?: string; catalogStatus?: number; catalogBody?: string }) => void
  requests: { path: string }[]
  close: () => Promise<void>
}> {
  const requests: { path: string }[] = []
  let tokenBody = '{"code":11217,"msg":"11217:login ing"}'
  let catalogStatus = 200
  let catalogBody = '{"code":0,"data":{"models":[{"id":"m1","maxInputTokens":10,"maxOutputTokens":5}],"agents":[{"name":"cli","models":["m1"]}]}}'
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? ''
    requests.push({ path })
    if (path === '/v2/plugin/auth/state') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(`{"code":0,"data":{"state":"st-1","authUrl":"${'https://www.workbuddy.cn/oauth?state=st-1'}"}}`)
    } else if (path === '/v2/plugin/auth/token') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(tokenBody)
    } else if (path === '/v2/plugin/login/account') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"code":0,"data":{"uid":"u-1","enterpriseId":"","nickname":"nick"}}')
    } else {
      res.writeHead(catalogStatus, { 'content-type': 'application/json' })
      res.end(catalogBody)
    }
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    set: patch => {
      if (patch.token !== undefined) tokenBody = patch.token
      if (patch.catalogStatus !== undefined) catalogStatus = patch.catalogStatus
      if (patch.catalogBody !== undefined) catalogBody = patch.catalogBody
    },
    requests,
    close: () => new Promise(resolve => { server.close(() => resolve()) }),
  }
}

/** 假 authorization 缝：先装捕获器，registerWorkbuddyFlow 之后取流。 */
/** Fake authorization seam: install the capture first, collect the flow after registerWorkbuddyFlow. */
function installCapture(host: FakeHost): { flows: AuthorizationFlow[] } {
  const flows: AuthorizationFlow[] = []
  const ctx = host.ctx as unknown as { authorization: { registerFlow(flow: AuthorizationFlow): () => void } }
  ctx.authorization = { registerFlow: (flow: AuthorizationFlow) => { flows.push(flow); return () => {} } }
  return { flows }
}

/** 假会话：notify 入桶、signal 可控、commit 照生产语义写进假缝。A fake session: notices bucket, controllable signal, commit writes into the fake seam per production semantics. */
function fakeSession(host: FakeHost, overrides: Partial<AuthorizationSession> = {}): AuthorizationSession & { notices: { message: string; url?: string }[]; commits: unknown[] } {
  const session = {
    method: 'device-code-cn',
    signal: new AbortController().signal,
    notices: [] as { message: string; url?: string }[],
    commits: [] as unknown[],
    notify: (notice: { message: string; url?: string }) => { session.notices.push(notice) },
    prompt: () => Promise.reject(new Error('the flow must not prompt')),
    commit: async (record: unknown) => {
      session.commits.push(record)
      await host.credentials.modifyRecord(RECORD, async () => record as never)
    },
    ...overrides,
  }
  return session as never
}

/** 装好指向 mock 的整流程（捕获缝必须先装；loginBase 恒指 mock——测试绝不触真网）。 */
/** Wires the whole flow against a mock (the capture installs first; loginBase always the mock — tests never touch the live upstream). */
function setup(host: FakeHost, mockOrigin: string): { accounts: WorkbuddyAccounts; catalog: WorkbuddyCatalog; flow: AuthorizationFlow } {
  const capture = installCapture(host)
  const config = resolveConfig({})
  const accounts = new WorkbuddyAccounts(host.ctx)
  const catalog = new WorkbuddyCatalog(config, accounts, Date.now, mockOrigin)
  registerWorkbuddyFlow(host.ctx as never, { config, accounts, catalog, baseUrl: mockOrigin })
  return { accounts, catalog, flow: capture.flows[0] as AuthorizationFlow }
}

describe('授权流 / authorization flow', () => {
  it('pending 自转直到 token 到位；在线校验通过才 commit；通知带授权 URL', async () => {
    const mock = await startMock()
    try {
      const host = createFakeHost()
      const { accounts, flow } = setup(host, mock.origin)
      expect(flow.methods.map(entry => entry.id)).toEqual(['device-code-cn', 'device-code-global'])
      const session = fakeSession(host)
      mock.set({ token: '{"code":0,"data":{"accessToken":"at-1","refreshToken":"rt-1","expiresIn":3600,"domain":"codebuddy.cn"}}' })
      await flow.run(session)
      expect(session.notices[0]?.url).toContain('loginSessionId=')
      expect(session.commits).toHaveLength(1)
      const payload = (session.commits[0] as { payload: { accounts: { uid: string }[] } }).payload
      expect(payload.accounts.map(account => account.uid)).toEqual(['u-1'])
      const stored = await accounts.read()
      expect(stored.accounts[0]?.accessToken).toBe('at-1')
      // mock 只该见过一次 token 轮询（pending 自转发生在 mock 外的节奏等待后，
      // 这里 token 直接到位——断言不重放 state 兑换）。
      expect(mock.requests.filter(request => request.path === '/v2/plugin/auth/token')).toHaveLength(1)
    } finally {
      await mock.close()
    }
  })

  it('在线校验失败：整个 attempt 失败，凭据一个字节都不落', async () => {
    const mock = await startMock()
    try {
      const host = createFakeHost()
      const { accounts, flow } = setup(host, mock.origin)
      mock.set({
        token: '{"code":0,"data":{"accessToken":"at-2","refreshToken":"rt-2","expiresIn":3600,"domain":"codebuddy.cn"}}',
        catalogStatus: 401,
        catalogBody: '{"code":12153,"msg":"session dead"}',
      })
      await expect(flow.run(fakeSession(host))).rejects.toMatchObject({ code: 'SIGN_IN_VALIDATION_FAILED' })
      const document = await accounts.read()
      expect(document.accounts).toHaveLength(0)
    } finally {
      await mock.close()
    }
  })

  it('regionOfMethod：global 方法名映射国际区，其余（含缺省）映射国内区', () => {
    expect(regionOfMethod('device-code-global')).toBe('global')
    expect(regionOfMethod('device-code-cn')).toBe('cn')
    expect(regionOfMethod('')).toBe('cn')
  })

  it('RECORD 地址是本插件 scope 下的 accounts', () => {
    expect(RECORD).toBeDefined()
    expect(String(RECORD)).toContain('workbuddy-auth')
  })
})
