import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPipeline } from '../src/pipeline.ts'
import type { CrawlerRunRequest } from '../src/control/runner.ts'
import type { BrowserSession } from '../src/browser/contract.ts'

// 管线全链路（架构铁律 2）：请求 → 爬取器 → 整形脱敏 → 介质落盘；
// 未接入平台在采集开始前拒绝。
// The full pipeline (invariant 2): request → crawler → shape/mask →
// medium persistence; unwired platforms reject before any crawl.
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

function fakeSession(): BrowserSession {
  return {
    context: {
      newPage: async () => ({ goto: async () => undefined, content: async () => '' }),
      addCookies: async () => {},
      cookies: async () => [],
      requestJson: async () => ({}),
      close: async () => {},
    },
    close: async () => {},
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
        { fetchJson, launchSession: async () => fakeSession() },
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

  it('rejects unwired platforms before any crawl or file output', async () => {
    const fetchJson = vi.fn(async () => mblogPayload('n1'))
    await expect(
      runPipeline({ ...request, platform: 'xhs' }, { fetchJson, launchSession: async () => fakeSession() }, '.'),
    ).rejects.toMatchObject({ code: 'INVALID_PLATFORM' })
    expect(fetchJson).not.toHaveBeenCalled()
  })

  it('rejects store media that has not landed yet', async () => {
    await expect(
      runPipeline({ ...request, saveOption: 'excel' }, { fetchJson: async () => ({}), launchSession: async () => fakeSession() }, '.'),
    ).rejects.toMatchObject({ code: 'INVALID_SAVE_OPTION' })
  })
})
