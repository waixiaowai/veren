import { describe, expect, it } from 'vitest'
import { parseZhihuSearchResponse, zhihuHasMore } from '../src/platform/zhihu/parse.ts'
import { parseDySearchResponse, dyHasMore } from '../src/platform/dy/parse.ts'
import { parseKsSearchResponse, ksNextCursor } from '../src/platform/ks/parse.ts'

// 骨架平台解析器验收（zhihu/dy/ks）：形状映射、容错、分页游标语义。
// Skeleton-platform parser acceptance (zhihu/dy/ks): shape mapping,
// tolerance, and pagination cursor semantics.

describe('parseZhihuSearchResponse', () => {
  const payload = {
    data: [
      {
        type: 'search_result',
        object: {
          type: 'article',
          id: 42,
          title: '知乎专栏',
          excerpt: '摘要内容',
          author: { name: '作者甲', url_token: 'auth-a' },
          voteup_count: 12,
          comment_count: 3,
        },
      },
      { type: 'advert', object: { id: 99 } },
    ],
    paging: { is_end: false },
  }
  it('unwraps search_result objects into raw items', () => {
    const items = parseZhihuSearchResponse(payload)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: '42',
      title: '知乎专栏',
      desc: '摘要内容',
      creatorId: 'auth-a',
      nickname: '作者甲',
      likedCount: 12,
      commentCount: 3,
    })
    expect(items[0].url).toContain('zhuanlan.zhihu.com/p/42')
  })
  it('tolerates malformed payloads and honors paging.is_end', () => {
    expect(parseZhihuSearchResponse(null)).toEqual([])
    expect(parseZhihuSearchResponse({ data: [] })).toEqual([])
    expect(zhihuHasMore(payload)).toBe(true)
    expect(zhihuHasMore({ paging: { is_end: true } })).toBe(false)
    expect(zhihuHasMore(null)).toBe(false)
  })
})

describe('parseDySearchResponse', () => {
  const payload = {
    status_code: 0,
    data: [
      {
        type: 1,
        aweme_info: {
          aweme_id: 'v1',
          desc: '抖音视频',
          author: { nickname: '作者乙', sec_uid: 'sec-b' },
          statistics: { digg_count: 100, comment_count: 5, collect_count: 7, share_count: 2 },
          video: { cover: ['https://img/c.jpg'], play_addr: ['https://v/play'] },
        },
      },
      { type: 2, aweme_info: { aweme_id: 'v2' } },
    ],
  }
  it('maps type=1 aweme entries with counters and video url', () => {
    const items = parseDySearchResponse(payload)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'v1',
      desc: '抖音视频',
      creatorId: 'sec-b',
      nickname: '作者乙',
      likedCount: 100,
      commentCount: 5,
      shareCount: 2,
      videoUrl: 'https://v/play',
    })
    expect(items[0].imageList).toEqual(['https://img/c.jpg'])
    expect(items[0].url).toContain('douyin.com/video/v1')
  })
  it('tolerates malformed payloads and honors status_code', () => {
    expect(parseDySearchResponse(null)).toEqual([])
    expect(parseDySearchResponse({ status_code: -1, data: [] })).toEqual([])
    expect(dyHasMore(payload)).toBe(true)
    expect(dyHasMore({ status_code: 0, data: [] })).toBe(false)
    expect(dyHasMore(null)).toBe(false)
  })
})

describe('parseKsSearchResponse', () => {
  const payload = {
    data: {
      visionSearchPhoto: {
        feeds: [
          {
            photo: {
              id: 'k1',
              caption: '快手视频',
              likeCount: '66',
              commentCount: '4',
              timestamp: 1700000000,
              coverUrls: [{ url: 'https://img/k.jpg' }],
              author: { id: 'auth-c', name: '作者丙' },
            },
          },
        ],
        pcursor: '2.0',
      },
    },
  }
  it('maps GraphQL feeds with string counters', () => {
    const items = parseKsSearchResponse(payload)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'k1',
      desc: '快手视频',
      creatorId: 'auth-c',
      nickname: '作者丙',
      likedCount: 66,
      commentCount: 4,
    })
    expect(items[0].imageList).toEqual(['https://img/k.jpg'])
    expect(items[0].url).toContain('kuaishou.com/short-video/k1')
  })
  it('tolerates malformed payloads and reads the pcursor', () => {
    expect(parseKsSearchResponse(null)).toEqual([])
    expect(parseKsSearchResponse({ data: {} })).toEqual([])
    expect(ksNextCursor(payload)).toBe('2.0')
    expect(ksNextCursor({ data: { visionSearchPhoto: { pcursor: '' } } })).toBeNull()
    expect(ksNextCursor(null)).toBeNull()
  })
})
