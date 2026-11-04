import { describe, expect, it, vi } from 'vitest'
import { parseTiebaSearchResponse, tiebaHasMore } from '../src/platform/tieba/parse.ts'
import { TiebaCrawler } from '../src/platform/tieba/crawler.ts'
import { createPlatformCrawler } from '../src/pipeline.ts'
import type { DataSink, RawItem } from '../src/crawler/contract.ts'
import type { BrowserSession } from '../src/browser/contract.ts'
import type { CrawlerRunRequest } from '../src/control/runner.ts'

// 贴吧平台验收（design/modules/crawler.md §5）：免登录 JSON 解析、空页终止、
// 管线分发到 tieba 爬取器。
// Tieba acceptance (crawler.md §5): the login-free json parsing, the
// empty-page stop, and the pipeline dispatch to the tieba crawler.
function payloadOf(tids: string[], hasMore = 0): unknown {
  return {
    no: 0,
    data: {
      has_more: hasMore,
      post_list: tids.map((tid) => ({
        tid,
        title: `帖子${tid}`,
        content: '正文',
        time: 1793705654,
        like_num: 5,
        post_num: 7,
        user: { id: 42, user_name: '张三', show_name: '' },
        media: [{ big_pic: `https://pic/${tid}.jpg` }],
      })),
    },
  }
}

describe('parseTiebaSearchResponse', () => {
  it('maps threads onto raw items with media and counters', () => {
    const items = parseTiebaSearchResponse(payloadOf(['t1']))
    expect(items).toHaveLength(1)
    const first: RawItem = items[0]
    expect(first).toMatchObject({
      id: 't1',
      url: 'https://tieba.baidu.com/p/t1',
      title: '帖子t1',
      creatorId: '42',
      nickname: '张三',
      likedCount: 5,
      commentCount: 7,
    })
    expect(first.imageList).toEqual(['https://pic/t1.jpg'])
  })

  it('tolerates malformed and failed payloads', () => {
    expect(parseTiebaSearchResponse(null)).toEqual([])
    expect(parseTiebaSearchResponse({ no: 5, error: 'x' })).toEqual([])
  })

  it('hasMore requires no=0 and has_more=1', () => {
    expect(tiebaHasMore(payloadOf(['a'], 1))).toBe(true)
    expect(tiebaHasMore(payloadOf(['a'], 0))).toBe(false)
    expect(tiebaHasMore({ no: 3 })).toBe(false)
  })
})

describe('TiebaCrawler', () => {
  function makeCrawler(fetchJson: (url: string) => Promise<unknown>) {
    return new TiebaCrawler({
      fetchJson,
      targets: { keywords: ['美食'], specifiedId: [], creatorId: [] },
      startPage: 1,
      maxNotesCount: 5,
      pageIntervalMs: 0,
    })
  }

  const session: BrowserSession = {
    context: {
      newPage: async () => ({ goto: async () => undefined, content: async () => '' }),
      addCookies: async () => {},
      cookies: async () => [],
      requestJson: async () => ({}),
      close: async () => {},
    },
    close: async () => {},
  }

  it('crawls search pages and stops when has_more=0', async () => {
    const handed: string[] = []
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('pn=2')) return payloadOf([], 0)
      return payloadOf(['t1', 't2'], 1)
    })
    const crawler = makeCrawler(fetchJson)
    crawler.keywords = ['美食']
    await crawler.search('美食', { content: async (item) => void handed.push(item.id), comment: async () => {} })
    expect(handed).toEqual(['t1', 't2'])
    expect(fetchJson).toHaveBeenCalledTimes(2)
  })

  it('falls back to search for creator mode (no per-author api)', async () => {
    const fetchJson = vi.fn(async (_url: string) => payloadOf(['t1'], 0))
    const crawler = makeCrawler(fetchJson)
    await crawler.creator('张三', { content: async () => {}, comment: async () => {} })
    const firstCall = fetchJson.mock.calls[0]
    expect(String(firstCall?.[0])).toContain('search/thread')
  })
})

describe('pipeline dispatch for tieba', () => {
  it('instantiates the tieba crawler for platform=tieba', () => {
    const request: CrawlerRunRequest = {
      platform: 'tieba', loginType: 'cookie', crawlerType: 'search', keywords: ['美食'],
      specifiedIds: [], creatorIds: [], enableComments: false, enableSubComments: false,
      enableMedia: false, saveOption: 'dsh', cookies: null, headless: true,
      maxNotesCount: 5, maxCommentsCount: 3, startPage: 1,
    }
    const crawler = createPlatformCrawler(request, async () => payloadOf([]))
    expect(crawler.platform).toBe('tieba')
  })
})
