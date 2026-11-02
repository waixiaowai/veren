/**
 * 归一化层的单测：信封拆解、字段候选取值、时间折叠、内容类型推断、链接取 id。
 * Unit tests for the normalization layer: envelope unwrapping, candidate
 * field reads, time folding, content-type inference, and id extraction.
 */
import { describe, expect, it } from 'vitest'
import {
  asRows,
  contentIdOf,
  normalizeAccountStats,
  normalizeComment,
  normalizeContentRef,
  normalizeContentStats,
  normalizeHotItem,
  normalizeQuestion,
  normalizeQuota,
  toContentType,
  toIso,
  unwrapPayload,
} from '../src/official/normalize.ts'

describe('envelope unwrapping', () => {
  it('reads the capitalized Data key', () => {
    expect(unwrapPayload({ Code: 0, Message: 'success', Data: { Total: 5 } })).toEqual({ Total: 5 })
  })

  it('passes a bare payload through', () => {
    expect(unwrapPayload({ Total: 5 })).toEqual({ Total: 5 })
  })
})

describe('row extraction', () => {
  it('reads the capitalized Items list', () => {
    expect(asRows({ Items: [{ id: 1 }] })).toEqual([{ id: 1 }])
  })

  it('reads an array payload', () => {
    expect(asRows([{ TotalQuota: 10 }])).toEqual([{ TotalQuota: 10 }])
  })

  it('drops non-object rows', () => {
    expect(asRows({ Items: [{ id: 1 }, 'nope'] })).toEqual([{ id: 1 }])
  })
})

describe('time folding', () => {
  it('folds epoch seconds into ISO', () => {
    expect(toIso(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('folds epoch milliseconds into ISO', () => {
    expect(toIso(1_700_000_000_000)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('answers undefined for junk', () => {
    expect(toIso('not a date')).toBeUndefined()
  })
})

describe('content type inference', () => {
  it('maps the platform values', () => {
    expect(toContentType('answer')).toBe('answer')
    expect(toContentType('article')).toBe('article')
    expect(toContentType('zvideo')).toBe('video')
    expect(toContentType('pin')).toBe('pin')
  })

  it('is case-insensitive', () => {
    expect(toContentType('Article')).toBe('article')
  })
})

describe('content id extraction', () => {
  it('reads the last path segment of an answer url', () => {
    expect(contentIdOf('https://www.zhihu.com/answer/123456789')).toBe('123456789')
  })

  it('reads the last path segment of an article url', () => {
    expect(contentIdOf('https://zhuanlan.zhihu.com/p/987')).toBe('987')
  })

  it('drops the query string', () => {
    expect(contentIdOf('https://www.zhihu.com/answer/42?utm_source=x')).toBe('42')
  })
})

describe('account stats normalization', () => {
  it('reads the followers, creation counts, and metrics', () => {
    const snapshot = normalizeAccountStats({
      Code: 0,
      Data: {
        Followers: { Total: 1200, Yesterday: 2 },
        CreationCounts: { Answer: 34, Article: 6, Video: 1 },
        Metrics: { ViewCount: 9000, LikeCount: 700, UpvoteCount: 300 },
      },
    }, '2026-11-01T00:00:00.000Z')
    expect(snapshot.followerCount).toBe(1200)
    expect(snapshot.answerCount).toBe(34)
    expect(snapshot.articleCount).toBe(6)
    expect(snapshot.videoCount).toBe(1)
    expect(snapshot.totalViewCount).toBe(9000)
    expect(snapshot.totalLikeCount).toBe(700)
    expect(snapshot.totalUpvoteCount).toBe(300)
  })

  it('answers zeros for a body without the sections', () => {
    const snapshot = normalizeAccountStats({ Code: 0, Data: {} }, '2026-11-01T00:00:00.000Z')
    expect(snapshot.followerCount).toBe(0)
  })
})

describe('content reference normalization', () => {
  it('reads a list row and derives the id from the url', () => {
    const ref = normalizeContentRef({
      ContentType: 'answer',
      Url: 'https://www.zhihu.com/answer/123456789',
      Title: '标题',
      CreatedAt: 1_700_000_000,
      LikeCount: 12,
      CommentCount: 3,
      FavoriteCount: 5,
    })
    expect(ref?.contentId).toBe('123456789')
    expect(ref?.contentType).toBe('answer')
    expect(ref?.title).toBe('标题')
    expect(ref?.likeCount).toBe(12)
    expect(ref?.collectCount).toBe(5)
    expect(ref?.createdAt).toBe('2023-11-14T22:13:20.000Z')
  })

  it('rejects a row without a url', () => {
    expect(normalizeContentRef({ Title: 'no url' })).toBeUndefined()
  })
})

describe('content stats normalization', () => {
  it('reads the funnel metrics', () => {
    const stats = normalizeContentStats({
      Code: 0,
      Data: {
        Items: [{
          Url: 'https://zhuanlan.zhihu.com/p/123',
          Metrics: {
            ViewCount: 300, PageShowUV: 900, UpvoteCount: 20, LikeCount: 8,
            CommentCount: 4, CollectCount: 6, ShareCount: 2,
            ReadFinishedRate: 0.42, FollowerGain: 7, FollowerConversionRate: 0.03,
          },
        }],
      },
    }, 'fallback')
    expect(stats.contentId).toBe('123')
    expect(stats.viewCount).toBe(300)
    expect(stats.exposureCount).toBe(900)
    expect(stats.readFinishedRate).toBe(0.42)
    expect(stats.followerGain).toBe(7)
  })

  it('keeps the metrics the platform omitted absent', () => {
    const stats = normalizeContentStats({ Code: 0, Data: { Items: [{ Metrics: { ViewCount: 5 } }] } }, 'x')
    expect(stats.viewCount).toBe(5)
    expect(stats.collectCount).toBeUndefined()
    expect(stats.readFinishedRate).toBeUndefined()
  })
})

describe('comment normalization', () => {
  it('reads the wrapped comment row', () => {
    const comment = normalizeComment({
      Comment: {
        ID: 456,
        Content: '写得好',
        LikeCount: 2,
        AuthorToken: 'example-user',
        CreatedAt: 1_742_822_400,
      },
      Children: [],
    })
    expect(comment?.commentId).toBe('456')
    expect(comment?.authorToken).toBe('example-user')
    expect(comment?.content).toBe('写得好')
    expect(comment?.likeCount).toBe(2)
  })

  it('rejects a row without an id', () => {
    expect(normalizeComment({ Comment: { Content: 'x' } })).toBeUndefined()
  })
})

describe('hot item normalization', () => {
  it('reads a hot row', () => {
    const item = normalizeHotItem({ Title: '热点', Url: 'https://x', Summary: '摘要' }, 3)
    expect(item?.title).toBe('热点')
    expect(item?.rank).toBe(3)
    expect(item?.summary).toBe('摘要')
  })
})

describe('question normalization', () => {
  it('reads a question row', () => {
    const question = normalizeQuestion({ Title: '好问题', Url: 'https://www.zhihu.com/question/123' })
    expect(question?.questionId).toBe('123')
    expect(question?.title).toBe('好问题')
  })

  it('rejects a row without a url', () => {
    expect(normalizeQuestion({ Title: '好问题' })).toBeUndefined()
  })
})

describe('quota normalization', () => {
  it('sums the allowance groups', () => {
    expect(normalizeQuota({
      Code: 0,
      Data: [
        { APIID: 'creator', TotalQuota: 500, TotalUsed: 12, RemainingQuota: 488 },
        { APIID: 'user_data', TotalQuota: 1000, TotalUsed: 3, RemainingQuota: 997 },
      ],
    })).toEqual({ total: 1500, used: 15, remaining: 1485 })
  })

  it('answers zeros for an empty allowance list', () => {
    expect(normalizeQuota({ Code: 0, Data: [] })).toEqual({ total: 0, used: 0, remaining: 0 })
  })
})
