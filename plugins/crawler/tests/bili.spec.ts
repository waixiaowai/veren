import { describe, expect, it, vi } from 'vitest'
import { mixinKeyOf, signWbiQuery, wbiKeysFromNav } from '../src/platform/bili/wbi.ts'
import { parseBiliSearchResponse, biliHasMore } from '../src/platform/bili/parse.ts'
import { BiliCrawler } from '../src/platform/bili/crawler.ts'

// B 站平台验收（crawler.md §5）：WBI 签名确定性、解析、搜索循环、分发。
// Bilibili acceptance (crawler.md §5): deterministic wbi signing, parsing,
// the search loop, and dispatch.
function navPayload(img: string, sub: string): unknown {
  return { code: 0, data: { wbi_img: { img_url: `https://img/${img}.png`, sub_url: `https://img/${sub}.png` } } }
}

describe('wbi signing', () => {
  it('derives the mixin key via the permutation table (32 chars)', () => {
    const mixin = mixinKeyOf({ imgKey: 'a'.repeat(32), subKey: 'b'.repeat(32) })
    expect(mixin).toHaveLength(32)
    // 置换表第 0/1 位是 46/47 → 取并集串的第 46/47 个字符 / table picks chars 46,47 first
    expect(mixin[0]).toBe('b')
    expect(mixin[1]).toBe('b')
  })

  it('signs deterministically: same params + keys + wts yield the same w_rid', () => {
    const mixin = mixinKeyOf({ imgKey: 'img', subKey: 'sub' })
    const a = signWbiQuery({ keyword: '美食', page: '1' }, mixin, 1700000000)
    const b = signWbiQuery({ keyword: '美食', page: '1' }, mixin, 1700000000)
    expect(a).toEqual(b)
    expect(a.wRid).toMatch(/^[0-9a-f]{32}$/)
  })

  it('filters reserved characters and includes wts in the digest', () => {
    const mixin = mixinKeyOf({ imgKey: 'img', subKey: 'sub' })
    const plain = signWbiQuery({ keyword: 'abc' }, mixin, 1)
    const starred = signWbiQuery({ keyword: 'a*b*c!' }, mixin, 1)
    // 过滤 !*() 后两者查询串一致 → 摘要一致 / after filtering, both digest alike
    expect(starred.wRid).toBe(plain.wRid)
  })

  it('extracts keys from a nav payload and rejects others', () => {
    expect(wbiKeysFromNav(navPayload('img', 'sub'))).toEqual({ imgKey: 'img', subKey: 'sub' })
    expect(wbiKeysFromNav({ code: -101 })).toBeNull()
    expect(wbiKeysFromNav(null)).toBeNull()
  })
})

describe('parseBiliSearchResponse', () => {
  it('maps results onto raw items, stripping em highlight tags', () => {
    const payload = {
      code: 0,
      data: { result: [{ bvid: 'BV1x', title: '<em class="keyword">美食</em>探店', author: 'up主', mid: 7, like: 1, reply: 2, favorite: 3, pubdate: 1793705654, pic: 'https://pic/1.jpg' }] },
    }
    const items = parseBiliSearchResponse(payload)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'BV1x', title: '美食探店', url: 'https://www.bilibili.com/video/BV1x', creatorId: '7', nickname: 'up主' })
  })

  it('yields empty for failures and detects hasMore', () => {
    expect(parseBiliSearchResponse({ code: -412 })).toEqual([])
    expect(biliHasMore({ code: 0, data: { result: [{ bvid: 'BV1', mid: 1 }] } })).toBe(true)
    expect(biliHasMore({ code: 0, data: { result: [] } })).toBe(false)
  })
})

describe('BiliCrawler', () => {
  function makeCrawler(fetchJson: (url: string) => Promise<unknown>) {
    return new BiliCrawler({
      fetchJson,
      targets: { keywords: ['美食'], specifiedId: [], creatorId: [] },
      startPage: 1,
      maxNotesCount: 5,
      pageIntervalMs: 0,
    })
  }

  it('signs each page against the nav keys and stops at hasMore=false', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('/finger/spi')) return { b_3: 'buvid3', b_4: 'buvid4' }
      if (url.includes('/nav')) return navPayload('img', 'sub')
      if (url.includes('page=2')) return { code: 0, data: { result: [] } }
      expect(url).toContain('w_rid=')
      return { code: 0, data: { result: [{ bvid: 'BV1', author: 'up', mid: 7 }] } }
    })
    const crawler = makeCrawler(fetchJson)
    crawler.keywords = ['美食']
    const handed: string[] = []
    await crawler.search('美食', { content: async (item) => void handed.push(item.id), comment: async () => {} })
    expect(handed).toEqual(['BV1'])
    // 3 次：spi 预热 + nav 密钥 + 第 1 页搜索；预热先于签名发生 / 3 calls: spi warm-up + nav keys + page-1 search; warm-up precedes signing
    const calls = fetchJson.mock.calls.map((call) => String(call[0]))
    expect(calls).toHaveLength(4)
    expect(calls[0]).toContain('/finger/spi')
    expect(calls[1]).toContain('/nav')
    expect(calls.find((url) => url.includes('page=1'))).toBeDefined()
  })
})
