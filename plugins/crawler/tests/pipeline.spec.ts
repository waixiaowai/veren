import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPipeline } from '../src/pipeline.ts'
import type { CrawlerRunRequest } from '../src/control/runner.ts'
import type { PlatformAuth } from '../src/platform/login.ts'
import { fakeSession } from './helpers/session.ts'

// 管线全链路（架构铁律 2）：会话 → 登录 → 爬取器 → 整形脱敏 → 介质落盘；
// 未接入平台在启动前拒绝；登录失败绝不发业务请求且会话必定关闭。
// The full pipeline (invariant 2): session → login → crawler → shape/mask
// → medium persistence; unwired platforms reject before launch; a failed
// login never issues a business request and the session always closes.
const request: CrawlerRunRequest = {
  platform: 'wb', loginType: 'cookie', crawlerType: 'search', keywords: ['美食'],
  specifiedIds: [], creatorIds: [], enableComments: true, enableSubComments: false,
  enableMedia: false, saveOption: 'jsonl', cookies: 'SUB=abc', headless: true,
  maxNotesCount: 20, maxCommentsCount: 10, startPage: 1,
}

function mblogPayload(id: string): unknown {
  return {
    ok: 1,
    data: { cards: [{ mblog: {
      id, bid: `b${id}`, text: '正文', created_at: '2026-11-04',
      user: { idstr: 'u1', screen_name: '张三' },
      attitudes_count: 1, comments_count: 2,
    } }] },
  }
}

/** 已登录的登录面：探针直中，登录器不被调用 / a logged-in face: the probe hits, no login runs */
function loggedInAuth(): PlatformAuth {
  return {
    probe: async () => ({ loggedIn: true, probeMethod: 'api' }),
    login: {
      platform: 'wb',
      begin: async () => {},
      loginByQrcode: async () => true,
      loginByMobile: async () => true,
      loginByCookies: async () => {},
    },
  }
}

describe('runPipeline', () => {
  it('crawls through the sink into the jsonl medium with masked person fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crawler-pipeline-'))
    try {
      const fetchJson = vi.fn(async (url: string) => {
        if (url.includes('page=1')) return mblogPayload('n1')
        return { ok: 0, data: { cards: [] } }
      })
      const code = await runPipeline(
        request,
        { fetchJson, launchSession: async () => fakeSession(), auth: loggedInAuth() },
        root,
      )
      expect(code).toBe(0)
      const lines = (await readFile(join(root, 'wb', 'jsonl', 'search_contents_' + new Date().toISOString().slice(0, 10) + '.jsonl'), 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(1)
      const record = JSON.parse(lines[0]) as Record<string, unknown>
      expect(record.id).toBe('n1')
      expect(record.creatorHash).toMatch(/^[0-9a-f]{16}$/)
      expect(record.nickname).toBe('张*')
      expect(JSON.stringify(record)).not.toContain('u1')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects unwired platforms before launching anything', async () => {
    const fetchJson = vi.fn(async () => mblogPayload('n1'))
    const launchSession = vi.fn(async () => fakeSession())
    await expect(
      runPipeline({ ...request, platform: 'xhs' }, { fetchJson, launchSession }, '.'),
    ).rejects.toMatchObject({ code: 'INVALID_PLATFORM' })
    expect(fetchJson).not.toHaveBeenCalled()
    expect(launchSession).not.toHaveBeenCalled()
  })

  it('rejects store media that has not landed yet', async () => {
    await expect(
      runPipeline({ ...request, saveOption: 'excel' }, { launchSession: async () => fakeSession(), auth: loggedInAuth() }, '.'),
    ).rejects.toMatchObject({ code: 'INVALID_SAVE_OPTION' })
  })

  it('aborts before business requests when the probe fails and login is abandoned, closing the session', async () => {
    const fetchJson = vi.fn(async () => mblogPayload('n1'))
    const session = fakeSession()
    const auth: PlatformAuth = {
      probe: async () => ({ loggedIn: false, probeMethod: 'api' }),
      login: {
        platform: 'wb',
        begin: async () => {},
        loginByQrcode: async () => {
          throw new Error('login abandoned')
        },
        loginByMobile: async () => false,
        loginByCookies: async () => {},
      },
    }
    await expect(
      runPipeline(
        { ...request, loginType: 'qrcode' },
        { fetchJson, launchSession: async () => session, auth },
        '.',
      ),
    ).rejects.toThrowError(/login abandoned/)
    expect(fetchJson).not.toHaveBeenCalled()
    expect(session.close).toHaveBeenCalledTimes(1)
  })
})
