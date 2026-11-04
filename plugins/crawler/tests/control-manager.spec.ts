import { describe, expect, it, vi } from 'vitest'
import { CrawlerManager, STOP_TIMEOUT_MS } from '../src/control/manager.ts'
import { LogBuffer } from '../src/control/logs.ts'
import type { CrawlerRunRequest, RunnerHandle, RunnerSpawner } from '../src/control/runner.ts'

// 控制服务验收（design/modules/api.md §4）：互斥拒绝、异常退出、超时强杀、复位。
// Control-service acceptance (design api.md §4): mutual exclusion, nonzero
// exits, timeout force-kill, and reset.
const req: CrawlerRunRequest = {
  platform: 'xhs', loginType: 'qrcode', crawlerType: 'search', keywords: ['美食'],
  specifiedIds: [], creatorIds: [], enableComments: true, enableSubComments: false,
  enableMedia: false, saveOption: 'jsonl', cookies: null, headless: false,
  maxNotesCount: 20, maxCommentsCount: 10, startPage: 1,
}

/** 可控假进程 / a controllable fake process */
function fakeHandle(exitCode: number | null = null): RunnerHandle & { resolve(code: number): void } {
  let resolveExit!: (code: number) => void
  const exit = new Promise<number>((resolve) => {
    resolveExit = resolve
  })
  return {
    exit,
    terminate: vi.fn(),
    kill: vi.fn(),
    resolve: (code: number) => {
      resolveExit(exitCode ?? code)
    },
  }
}

describe('CrawlerManager.start', () => {
  it('progresses idle→starting→running and returns started', async () => {
    const handle = fakeHandle()
    const manager = new CrawlerManager(() => handle)
    expect(await manager.start(req)).toEqual({ status: 'started', message: '已启动' })
    expect(manager.status().status).toBe('running')
    expect(manager.status().platform).toBe('xhs')
    handle.resolve(0)
    await handle.exit
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(manager.status().status).toBe('idle')
  })

  it('rejects a duplicate start while running', async () => {
    const handle = fakeHandle()
    const manager = new CrawlerManager(() => handle)
    await manager.start(req)
    expect(await manager.start(req)).toMatchObject({ status: 'rejected' })
    handle.resolve(0)
  })

  it('marks error with the exit message on nonzero exit, then allows restart after reset', async () => {
    const handle = fakeHandle()
    const manager = new CrawlerManager(() => handle)
    await manager.start(req)
    handle.resolve(1)
    await handle.exit
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(manager.status().status).toBe('error')
    expect(manager.status().errorMessage).toContain('1')
    manager.reset()
    expect(manager.status().status).toBe('idle')
    handle.resolve(0)
    expect((await manager.start(req)).status).toBe('started')
    handle.resolve(0)
  })

  it('spawner failure returns rejected and reverts to idle', async () => {
    const spawner: RunnerSpawner = () => {
      throw new Error('no node')
    }
    const manager = new CrawlerManager(spawner)
    expect(await manager.start(req)).toMatchObject({ status: 'rejected' })
    expect(manager.status().status).toBe('idle')
  })
})

describe('CrawlerManager.stop', () => {
  it('returns not_running when idle', async () => {
    const manager = new CrawlerManager(() => fakeHandle())
    expect(await manager.stop()).toMatchObject({ status: 'not_running' })
  })

  it('terminates, waits for exit, and returns to idle', async () => {
    const handle = fakeHandle()
    const manager = new CrawlerManager(() => handle)
    await manager.start(req)
    const stopped = manager.stop()
    handle.resolve(0)
    expect(await stopped).toMatchObject({ status: 'stopped' })
    expect(manager.status().status).toBe('idle')
    expect(handle.terminate).toHaveBeenCalled()
  })

  it('force-kills when the process ignores the terminate signal', async () => {
    const handle = fakeHandle()
    handle.terminate = () => {} // never exits on its own / 忽略终止信号
    const manager = new CrawlerManager(() => handle, { stopTimeoutMs: 100 })
    await manager.start(req)
    const stopped = manager.stop()
    setTimeout(() => handle.resolve(9), 300)
    expect(await stopped).toMatchObject({ status: 'stopped' })
    expect(handle.kill).toHaveBeenCalled()
    expect(manager.status().status).toBe('idle')
  })
})

describe('LogBuffer', () => {
  it('parses levels, strips prefixes, caps at 500 entries and notifies subscribers', () => {
    const logs = new LogBuffer()
    const seen: number[] = []
    logs.subscribe((entry) => seen.push(entry.id))
    logs.append('[ERROR] boom')
    logs.append('[WARNING] slow')
    logs.append('plain info')
    const all = logs.recent(500)
    expect(all.map((entry) => entry.level)).toEqual(['ERROR', 'WARNING', 'INFO'])
    expect(all[0].message).toBe('boom')
    expect(all[2].message).toBe('plain info')
    expect(seen).toHaveLength(3)
    for (let i = 0; i < 600; i += 1) logs.append(`line ${i}`)
    expect(logs.recent(1000)).toHaveLength(500)
    expect(logs.recent(2)).toHaveLength(2)
  })
})
