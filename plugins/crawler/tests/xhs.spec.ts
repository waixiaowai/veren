import { describe, expect, it, vi } from 'vitest'
import { parseXhsSearchResponse, xhsHasMore } from '../src/platform/xhs/parse.ts'
import { XhsCrawler } from '../src/platform/xhs/crawler.ts'
import type { BrowserSession } from '../src/browser/contract.ts'
import type { DataSink, RawItem } from '../src/crawler/contract.ts'

// xhs 平台验收（crawler.md §5）：解析、xsec_token 缓存与详情复用、空页终止。
// Xhs acceptance (crawler.md §5): parsing, xsec_token caching and detail
// reuse, empty-page stop.
function searchPayload(notes: Array<{ id: string; token?: string }>, hasMore = false): unknown {
  return {
    code: 0,
    data: {
      has_more: hasMore,
      items: notes.map((n) => ({
        id: n.id,
        xsec_token: n.token,
        note_card: {
          title: `笔记${n.id}`,
          desc: '内容描述',
          user: { user_id: 'u1', nickname: '小红书用户' },
          interact_info: { liked_count: '42' },
          image_list: [{ url: 'https://img/1.jpg' }],
        },
      })),
    },
  }
}

describe('parseXhsSearchResponse', () => {
  it('maps notes onto raw items with xsec_token and interaction counts', () => {
    const items = parseXhsSearchResponse(searchPayload([{ id: 'n1', token: 'tok1' }]))
    expect(items).toHaveLength(1)
    const first: RawItem = items[0]
    expect(first).toMatchObject({
      id: 'n1',
      url: 'https://www.xiaohongshu.com/explore/n1?xsec_token=tok1',
      title: '笔记n1',
      creatorId: 'u1',
      nickname: '小红书用户',
      likedCount: 42,
      xsecToken: 'tok1',
    })
    expect(first.imageList).toEqual(['https://img/1.jpg'])
  })

  it('tolerates malformed and empty payloads', () => {
    expect(parseXhsSearchResponse(null)).toEqual([])
    expect(parseXhsSearchResponse({ code: -1 })).toEqual([])
  })

  it('hasMore requires code=0 and has_more=true', () => {
    expect(xhsHasMore(searchPayload([{ id: 'a' }], true))).toBe(true)
    expect(xhsHasMore(searchPayload([{ id: 'a' }], false))).toBe(false)
    expect(xhsHasMore({ code: -1 })).toBe(false)
  })
})

/** 假会话 / a fake browser session */
function fakeSession(): BrowserSession {
  return {
    context: {
      newPage: async () => ({ goto: async () => undefined, content: async () => '', evaluate: async () => undefined as never }),
      pages: async () => [],
      addCookies: async () => {},
      cookies: async () => [],
      requestJson: async () => ({}),
      close: async () => {},
    },
    close: async () => {},
  }
}

describe('XhsCrawler xsec_token reuse', () => {
  it('caches tokens from search and reuses them in detail mode', async () => {
    const handed: string[] = []
    const sink: DataSink = { content: async (item) => void handed.push(item.id), comment: async () => {} }
    const fetchJson = vi.fn(async (url: string, _headers?: unknown) => {
      if (url.includes('search/notes')) return searchPayload([{ id: 'n1', token: 'tok-search' }], false)
      if (url.includes('/feed')) {
        expect(url).toContain('xsec_token=tok-search')
        return { code: 0, title: '详情正文', desc: '完整内容', user: { user_id: 'u1', nickname: '小红书用户' } }
      }
      return { code: -1 }
    })
    const crawler = new XhsCrawler({
      fetchJson: async (url, headers) => await fetchJson(url, headers),
      signProducer: async () => ({ timestamp: '1', sign: 's', common: 'c', traceId: 't' }),
      targets: { keywords: ['美食'], specifiedId: [], creatorId: [] },
      startPage: 1,
      maxNotesCount: 5,
      pageIntervalMs: 0,
    })
    crawler.keywords = ['美食']
    await crawler.search('美食', sink)
    expect(handed).toEqual(['n1'])
    // 详情复用搜索缓存的 xsec_token / detail reuses the cached token from search
    await crawler.detail('n1', sink)
    const detailCall = fetchJson.mock.calls.find((call) => String(call[0]).includes('/feed'))
    expect(detailCall).toBeDefined()
  })

  it('detail without a cached token throws CONTENT_NOT_FOUND', async () => {
    const crawler = new XhsCrawler({
      fetchJson: async () => ({}),
      signProducer: async () => ({ timestamp: '1', sign: 's', common: 'c', traceId: 't' }),
      targets: { keywords: [], specifiedId: [], creatorId: [] },
      startPage: 1,
      maxNotesCount: 5,
      pageIntervalMs: 0,
    })
    await expect(
      crawler.detail('unknown-id', { content: async () => {}, comment: async () => {} }),
    ).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' })
  })

  it('detail fails loud (CONTENT_NOT_FOUND) when the feed api returns a business error', async () => {
    const crawler = new XhsCrawler({
      fetchJson: async (url: string) => {
        // 搜索返回正常结果（缓存 token）；详情 feed 返回业务错误 / search ok (caches token); feed returns a business error
        if (url.includes('/feed')) return { code: -100, success: false }
        return searchPayload([{ id: 'n1', token: 'tok' }], false)
      },
      signProducer: async () => ({ timestamp: '1', sign: 's', common: 'c', traceId: 't' }),
      targets: { keywords: [], specifiedId: [], creatorId: [] },
      startPage: 1,
      maxNotesCount: 5,
      pageIntervalMs: 0,
    })
    // 先通过搜索缓存 token，再以错误响应验证 detail 上抛 / cache the token via search, then verify the error path
    const sink: DataSink = { content: async () => {}, comment: async () => {} }
    await crawler.search('美食', sink)
    await expect(crawler.detail('n1', sink)).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' })
  })
})
