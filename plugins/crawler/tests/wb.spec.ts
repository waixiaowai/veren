import { describe, expect, it, vi } from 'vitest'
import { parseWbSearchResponse, wbHasMore } from '../src/platform/wb/parse.ts'
import { WbCrawler } from '../src/platform/wb/crawler.ts'
import type { DataSink, RawItem } from '../src/crawler/contract.ts'
import { fakeSession } from './helpers/session.ts'

// 微博爬取器（design/modules/crawler.md §5）：解析、空页终止、长文补全、
// 会话只消费不持有（生命周期归管线）。
// The weibo crawler (crawler.md §5): parsing, empty-page stop, long-post
// completion, and consuming—not owning—the session (the pipeline owns it).
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

  it('falls back to the numeric user id when idstr is missing (real search payloads)', () => {
    // 真实搜索响应：user 只有数字 id / real search responses: user carries a numeric id only
    const items = parseWbSearchResponse(
      payloadOf([{ mblog: { id: 5361482364879426, text: '正文', user: { id: 2391044612, screen_name: '山废酛' } } }]),
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: '5361482364879426', creatorId: '2391044612', nickname: '山废酛' })
  })

  it('flattens mblogs nested inside a card group', () => {
    expect(parseWbSearchResponse(payloadOf([{ card_type: 11, card_group: [mblog('g1')] }])).map((item) => item.id)).toEqual(['g1'])
  })
})

function makeCrawler(fetchJson: (url: string) => Promise<unknown>) {
  return new WbCrawler({
    fetchJson,
    targets: { keywords: ['美食'], specifiedId: [], creatorId: [] },
    startPage: 1,
    maxNotesCount: 5,
    pageIntervalMs: 0,
    fullTextUrl: (id) => `https://m.weibo.cn/statuses/extend?id=${id}`,
  })
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
    const crawler = makeCrawler(fetchJson)
    crawler.keywords = ['美食']
    await crawler.search('美食', { content: async (i) => void handed.push(i), comment: async () => {} })
    expect(handed).toHaveLength(1)
    expect(handed[0].desc).toBe('完整正文内容')
    // 3 次调用：第 1 页搜索 + 长文补全 + 第 2 页（空页终止前探测）。
    // 3 calls: page-1 search + long-text completion + page 2 (probed before the empty-page stop).
    expect(fetchJson).toHaveBeenCalledTimes(3)
  })

  it('navigates the index on the given session and never closes it', async () => {
    const goto = vi.fn(async () => undefined)
    const session = fakeSession({ newPage: async () => ({ goto, content: async () => '' }) })
    const crawler = makeCrawler(async () => payloadOf([mblog('a')]))
    await crawler.run(session, sink)
    expect(goto).toHaveBeenCalledWith('https://m.weibo.cn/')
    expect(session.close).not.toHaveBeenCalled()
  })

  it('dispatches detail mode for specified ids', async () => {
    const handed: string[] = []
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('statuses/show')) {
        return { id: 'd1', user: { idstr: 'u1', screen_name: '张三' } }
      }
      return payloadOf([])
    })
    const crawler = makeCrawler(fetchJson)
    // 直接以 detail 入口验证 / verify the detail entry directly
    await crawler.detail('d1', { content: async (i) => void handed.push(i.id), comment: async () => {} })
    expect(handed).toEqual(['d1'])
  })
})
