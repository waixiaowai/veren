import { describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ControlApi } from '../src/control/http-server.ts'
import { CrawlerManager } from '../src/control/manager.ts'
import type { CrawlerRunRequest, RunnerHandle } from '../src/control/runner.ts'
import type { Context } from '@deepseek-ai/cordis'

// api.md 端点集成：ControlApi 挂宿主 webServer（测试用极小 webServer 替身
// + 真 http 服务器承载），覆盖启停、状态、日志、配置、健康与数据端点。
// api.md endpoint integration: ControlApi mounts on the host webServer
// (a minimal webServer double + a real http server carrying it), covering
// start/stop/status/logs/config/health/data endpoints.
const req: CrawlerRunRequest = {
  platform: 'xhs', loginType: 'qrcode', crawlerType: 'search', keywords: ['美食'],
  specifiedIds: [], creatorIds: [], enableComments: true, enableSubComments: false,
  enableMedia: false, cookies: null, headless: false,
  maxNotesCount: 20, maxCommentsCount: 10, startPage: 1,
}

/** 常驻假进程：kill 时兑现退出码 / an ever-running fake process; kill fulfils the exit code */
function hangingHandle(): RunnerHandle {
  let resolveExit: ((code: number) => void) | null = null
  return {
    exit: new Promise<number>((resolve) => {
      resolveExit = resolve
    }),
    terminate: () => {},
    kill: () => resolveExit?.(9),
  }
}

/** 极小 webServer 替身：capture register/registerUpgrade 调用并转发到真 http 服务器 / a minimal webServer double: captures register/registerUpgrade and forwards to a real http server */
interface RegisteredRoute {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => void
}

interface RegisteredUpgrade {
  path: string
  handler: (req: unknown, socket: unknown, head: Buffer) => void
}

async function mountApi(manager: CrawlerManager, dataRoot: string, extraDeps: Partial<{ domain: () => unknown }> = {}): Promise<{ base: string; dispose: () => void; routes: RegisteredRoute[]; upgrades: RegisteredUpgrade[]; close: () => Promise<void> }> {
  const routes: RegisteredRoute[] = []
  const upgrades: RegisteredUpgrade[] = []
  const fakeCtx = {
    webServer: {
      register: (route: RegisteredRoute) => {
        routes.push(route)
        return () => {
          routes.splice(routes.indexOf(route), 1)
        }
      },
      registerUpgrade: (route: RegisteredUpgrade) => {
        upgrades.push(route)
        return () => {
          upgrades.splice(upgrades.indexOf(route), 1)
        }
      },
    },
  } as unknown as Context
  const server: Server = createServer((req, res) => {
    // 最长前缀优先（与宿主 webServer 的匹配语义一致）/ longest prefix wins (matching the host webServer semantics)
    const match = routes
      .filter((route) => (req.url ?? '').startsWith(route.path))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (match !== undefined) match.handler(req, res)
    else {
      res.writeHead(404)
      res.end()
    }
  })
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  })
  const api = new ControlApi({ manager, dataRoot, ...extraDeps } as never)
  const dispose = api.register(fakeCtx)
  return {
    base: `http://127.0.0.1:${port}`,
    dispose,
    routes,
    upgrades,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}

async function makeApi(): Promise<{ base: string; dispose: () => void; close: () => Promise<void>; root: string; routes: RegisteredRoute[]; upgrades: RegisteredUpgrade[] }> {
  const root = await mkdtemp(join(tmpdir(), 'crawler-http-'))
  await writeFile(join(root, 'xhs.jsonl'), '{"id":"n1"}\n')
  const manager = new CrawlerManager(() => hangingHandle(), { stopTimeoutMs: 200 })
  const mounted = await mountApi(manager, root)
  return { ...mounted, root }
}

describe('ControlApi on host webServer', () => {
  it('registers exactly the four claimed route prefixes plus the two ws channels', async () => {
    const ctx = await makeApi()
    try {
      expect(ctx.routes.map((route) => route.path).sort()).toEqual(['/api/config', '/api/crawler', '/api/data', '/api/health'])
      expect(ctx.upgrades.map((route) => route.path).sort()).toEqual(['/api/ws/logs', '/api/ws/status'])
    } finally {
      ctx.dispose()
      await ctx.close()
      await rm(ctx.root, { recursive: true, force: true })
    }
  })

  it('serves health, config-platforms and config-options', async () => {
    const ctx = await makeApi()
    try {
      expect(await (await fetch(`${ctx.base}/api/health`)).json()).toEqual({ status: 'ok' })
      const platforms = (await (await fetch(`${ctx.base}/api/config/platforms`)).json()) as { platforms: unknown[] }
      expect(platforms.platforms).toHaveLength(7)
      const options = (await (await fetch(`${ctx.base}/api/config/options`)).json()) as Record<string, unknown[]>
      expect(options.login_types).toHaveLength(3)
      expect(options.crawler_types).toHaveLength(3)
    } finally {
      ctx.dispose()
      await ctx.close()
      await rm(ctx.root, { recursive: true, force: true })
    }
  })

  it('starts and rejects a duplicate start, then stops', async () => {
    const ctx = await makeApi()
    try {
      const started = await (await fetch(`${ctx.base}/api/crawler/start`, { method: 'POST', body: JSON.stringify(req) })).json()
      expect(started).toMatchObject({ status: 'started' })
      const status = await (await fetch(`${ctx.base}/api/crawler/status`)).json()
      expect(status).toMatchObject({ status: 'running', platform: 'xhs' })
      const rejected = await (await fetch(`${ctx.base}/api/crawler/start`, { method: 'POST', body: JSON.stringify(req) })).json()
      expect(rejected).toMatchObject({ status: 'rejected' })
      const stopped = await (await fetch(`${ctx.base}/api/crawler/stop`, { method: 'POST' })).json()
      expect(stopped).toMatchObject({ status: 'stopped' })
    } finally {
      ctx.dispose()
      await ctx.close()
      await rm(ctx.root, { recursive: true, force: true })
    }
  })

  it('maps invalid bodies to 400 with stable codes', async () => {
    const ctx = await makeApi()
    try {
      const response = await fetch(`${ctx.base}/api/crawler/start`, { method: 'POST', body: '{"platform":42}' })
      expect(response.status).toBe(400)
      const payload = (await response.json()) as { code: string }
      expect(payload.code).toBe('INVALID_ARGUMENT')
      const empty = await fetch(`${ctx.base}/api/crawler/start`, { method: 'POST' })
      expect(empty.status).toBe(400)
    } finally {
      ctx.dispose()
      await ctx.close()
      await rm(ctx.root, { recursive: true, force: true })
    }
  })

  it('serves logs, the domain data face and 404 for unknown routes', async () => {
    const ctx = await makeApi()
    try {
      expect(((await (await fetch(`${ctx.base}/api/crawler/logs?limit=5`)).json()) as { logs: unknown[] }).logs).toEqual([])
      const domain = (await (await fetch(`${ctx.base}/api/data/domain`)).json()) as { open: boolean; contents: number }
      expect(domain).toMatchObject({ open: false, contents: 0 })
      const unknown = await fetch(`${ctx.base}/api/data/nope`)
      expect((await unknown.json()).code).toBe('NOT_FOUND')
    } finally {
      ctx.dispose()
      await ctx.close()
      await rm(ctx.root, { recursive: true, force: true })
    }
  })

  it('serves the storage-domain data face', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crawler-http-'))
    try {
      const rows = new Map<string, unknown>([['wb::n1', { id: 'n1', title: 'x' }]])
      const manager = new CrawlerManager(() => hangingHandle(), { stopTimeoutMs: 200 })
      const mounted = await mountApi(manager, root, { domain: () => ({
        table: () => ({ put: async () => {}, entries: () => rows.entries() }),
      }) as never })
      try {
        const payload = (await (await fetch(`${mounted.base}/api/data/domain`)).json()) as { open: boolean; contents: number; by_platform: Record<string, number> }
        expect(payload).toMatchObject({ open: true, contents: 1 })
        expect(payload.by_platform).toEqual({ wb: 1 })
      } finally {
        mounted.dispose()
        await mounted.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('dispose removes the registered routes', async () => {
    const ctx = await makeApi()
    ctx.dispose()
    expect(ctx.routes).toHaveLength(0)
    await ctx.close()
    await rm(ctx.root, { recursive: true, force: true })
  })
})
