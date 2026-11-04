import { describe, expect, it, vi } from 'vitest'
import { parseWbSearchResponse, wbHasMore } from '../src/platform/wb/parse.ts'
import { WbCrawler } from '../src/platform/wb/crawler.ts'
import type { DataSink, RawItem } from '../src/crawler/contract.ts'

// 微博爬取器（design/modules/crawler.md §5）：解析、空页终止、长文补全、
// 登录探测门禁（先凭证后请求）。
// The weibo crawler (crawler.md §5): parsing, empty-page stop, long-post
// completion, and the probe gate (credentials before requests).
function payloadOf(cards: unknown[], ok = 1): unknown {
  return { ok, data: { cards } }
}

function mblog(id: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    mblog: {
      id,
      bid: `b${id}`,
      text: '截断的正文…',
      isLongText: false,
      created_at: 'Tue Nov 04 2026',
      user: { idstr: 'u1', screen_name: '张三' },
      attitudes_count: 1,
      comments_count: 2,
      reposts_count: 3,
      pics: [{ large: { url: 'https://img/1.jpg' } }],
      ...overrides,
    },
  }
}

describe('parseWbSearchResponse', () => {
  it('maps mblog cards onto raw items', () => {
    const items = parseWbSearchResponse(payloadOf([mblog('a'), { card_type: 9 }, mblog('b')]))
    expect(items).toHaveLength(2)
    const first: RawItem = items[0]
    expect(first).toMatchObject({
      id: 'a',
      url: 'https://m.weibo.cn/status/ba',
      creatorId: 'u1',
      nickname: '张三',
      likedCount: 1,
      commentCount: 2,
      shareCount: 3,
    })
    expect(first.imageList).toEqual(['https://img/1.jpg'])
  })

  it('yields an empty page for malformed or empty payloads', () => {
    expect(parseWbSearchResponse(null)).toEqual([])
    expect(parseWbSearchResponse({ ok: 0 })).toEqual([])
  })

  it('hasMore requires ok=1 and non-empty cards', () => {
    expect(wbHasMore(payloadOf([mblog('a')]))).toBe(true)
    expect(wbHasMore(payloadOf([]))).toBe(false)
    expect(wbHasMore(payloadOf([mblog('a')], 0))).toBe(false)
  })
})

function makeCrawler(fetchJson: (url: string) => Promise<unknown>, probes: boolean[]) {
  const probe = vi.fn(async () => probes.shift() ?? true)
  const login = vi.fn(async () => {})
  const sessionClosed = vi.fn(async () => {})
  const crawler = new WbCrawler({
    fetchJson,
    launchSession: async () => ({
      context: {
        newPage: async () => ({ goto: async () => undefined, content: async () => '' }),
        addCookies: async () => {},
        cookies: async () => [],
        requestJson: async () => ({}),
        close: async () => {},
      },
      close: sessionClosed,
    }),
    probeLoggedIn: probe,
    login,
    targets: { keywords: ['美食'], specifiedId: [], creatorId: [] },
    startPage: 1,
    maxNotesCount: 5,
    pageIntervalMs: 0,
    fullTextUrl: (id) => `https://m.weibo.cn/statuses/extend?id=${id}`,
  })
  return { crawler, probe, login, sessionClosed }
}

const sink: DataSink = { content: async () => {}, comment: async () => {} }

describe('WbCrawler', () => {
  it('crawls search pages with long-text completion and stops when hasMore=false', async () => {
    const handed: RawItem[] = []
    const longTextPayload = { data: { isLongText: true, longTextContent: '完整正文内容' } }
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('extend')) return longTextPayload
      // 第二页为空页，终止翻页 / the second page is empty, stopping pagination
      if (url.includes('page=2')) return payloadOf([])
      return payloadOf([mblog('a', { isLongText: true })])
    })
    const { crawler } = makeCrawler(fetchJson, [true])
    crawler.keywords = ['美食']
    await crawler.search('美食', { content: async (i) => void handed.push(i), comment: async () => {} })
    expect(handed).toHaveLength(1)
    expect(handed[0].desc).toBe('完整正文内容')
    // 3 次调用：第 1 页搜索 + 长文补全 + 第 2 页（空页终止前探测）。
    // 3 calls: page-1 search + long-text completion + page 2 (probed before the empty-page stop).
    expect(fetchJson).toHaveBeenCalledTimes(3)
  })

  it('aborts without business requests when the probe fails and login is abandoned', async () => {
    const fetchJson = vi.fn(async () => payloadOf([mblog('a')]))
    const { crawler, probe, login, sessionClosed } = makeCrawler(fetchJson, [false])
    login.mockRejectedValueOnce(new Error('login abandoned'))
    crawler.keywords = ['美食']
    await expect(
      crawler.start({ content: async () => {}, comment: async () => {} }),
    ).rejects.toThrowError(/login abandoned/)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledTimes(1)
    expect(fetchJson).not.toHaveBeenCalled()
    expect(sessionClosed).toHaveBeenCalledTimes(1)
  })

  it('dispatches detail mode for specified ids', async () => {
    const handed: string[] = []
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('statuses/show')) {
        return { id: 'd1', user: { idstr: 'u1', screen_name: '张三' } }
      }
      return payloadOf([])
    })
    const { crawler } = makeCrawler(fetchJson, [true])
    // 直接以 detail 入口验证 / verify the detail entry directly
    await crawler.detail('d1', { content: async (i) => void handed.push(i.id), comment: async () => {} })
    expect(handed).toEqual(['d1'])
  })
})
