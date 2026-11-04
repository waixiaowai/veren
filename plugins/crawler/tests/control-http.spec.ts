import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ControlServer } from '../src/control/http-server.ts'
import { CrawlerManager } from '../src/control/manager.ts'
import type { CrawlerRunRequest, RunnerHandle } from '../src/control/runner.ts'

// api.md 端点集成：真实端口 + 注入假进程，覆盖启停、状态、日志、配置、健康与数据端点。
// api.md endpoint integration: a real port with an injected fake runner,
// covering start/stop/status/logs/config/health/data endpoints.
const req: CrawlerRunRequest = {
  platform: 'xhs', loginType: 'qrcode', crawlerType: 'search', keywords: ['美食'],
  specifiedIds: [], creatorIds: [], enableComments: true, enableSubComments: false,
  enableMedia: false, saveOption: 'jsonl', cookies: null, headless: false,
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

async function makeServer(): Promise<{ base: string; close: () => Promise<void>; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'crawler-http-'))
  await writeFile(join(root, 'xhs.jsonl'), '{"id":"n1"}\n')
  const manager = new CrawlerManager(() => hangingHandle(), { stopTimeoutMs: 200 })
  const server = new ControlServer({ manager, dataRoot: root })
  const port = await server.start()
  return { base: `http://127.0.0.1:${port}`, close: async () => await server.stop(), root }
}

describe('ControlServer endpoints', () => {
  it('serves health, config-platforms and config-options', async () => {
    const ctx = await makeServer()
    try {
      expect(await (await fetch(`${ctx.base}/api/health`)).json()).toEqual({ status: 'ok' })
      const platforms = (await (await fetch(`${ctx.base}/api/config/platforms`)).json()) as { platforms: unknown[] }
      expect(platforms.platforms).toHaveLength(7)
      const options = (await (await fetch(`${ctx.base}/api/config/options`)).json()) as Record<string, unknown[]>
      expect(options.login_types).toHaveLength(3)
      expect(options.save_options).toHaveLength(8)
    } finally {
      await ctx.close()
      await rm(ctx.root, { recursive: true, force: true })
    }
  })

  it('starts and rejects a duplicate start, then stops', async () => {
    const ctx = await makeServer()
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
      await ctx.close()
      await rm(ctx.root, { recursive: true, force: true })
    }
  })

  it('maps invalid bodies to 400 with stable codes', async () => {
    const ctx = await makeServer()
    try {
      const response = await fetch(`${ctx.base}/api/crawler/start`, { method: 'POST', body: '{"platform":42}' })
      expect(response.status).toBe(400)
      const payload = (await response.json()) as { code: string }
      expect(payload.code).toBe('INVALID_ARGUMENT')
      const empty = await fetch(`${ctx.base}/api/crawler/start`, { method: 'POST' })
      expect(empty.status).toBe(400)
    } finally {
      await ctx.close()
      await rm(ctx.root, { recursive: true, force: true })
    }
  })

  it('serves logs, data files list, preview, download, stats and 404 for unknown routes', async () => {
    const ctx = await makeServer()
    try {
      expect(((await (await fetch(`${ctx.base}/api/crawler/logs?limit=5`)).json()) as { logs: unknown[] }).logs).toEqual([])
      const files = (await (await fetch(`${ctx.base}/api/data/files`)).json()) as { files: { path: string }[] }
      expect(files.files.map((file) => file.path)).toEqual(['xhs.jsonl'])
      const preview = await (await fetch(`${ctx.base}/api/data/files/xhs.jsonl?preview=true&limit=10`)).json()
      expect(preview).toMatchObject({ total: 1 })
      const download = await fetch(`${ctx.base}/api/data/download/xhs.jsonl`)
      expect(await download.text()).toContain('n1')
      const stats = await (await fetch(`${ctx.base}/api/data/stats`)).json()
      expect(stats).toMatchObject({ total_files: 1 })
      const missing = await fetch(`${ctx.base}/api/data/download/nope.json`)
      expect(missing.status).toBe(404)
      expect((await (await fetch(`${ctx.base}/api/nope`)).json()).code).toBe('NOT_FOUND')
    } finally {
      await ctx.close()
      await rm(ctx.root, { recursive: true, force: true })
    }
  })
})
