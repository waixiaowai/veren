import { describe, expect, it, vi } from 'vitest'
import { Semaphore } from '../src/crawler/semaphore.ts'
import { classifyPlatformResponse, isFatal, isRetryable, retryable } from '../src/crawler/ratelimit.ts'
import { runCrawlLoop, initCursor } from '../src/crawler/engine.ts'
import { CrawlerError } from '../src/errors.ts'
import type { CrawledPage, DataSink, PageCursor, RawItem } from '../src/crawler/contract.ts'

// 爬取器验收（design/modules/crawler.md §6）：限频退避、数量上限、空页终止、单条失败隔离。
// Crawler acceptance (crawler.md §6): rate-limit backoff, the count cap,
// empty-page termination, single-item failure isolation.
const noSleep = (): Promise<void> => Promise.resolve()
const retryFast = { maxRetries: 2, baseDelayMs: 1, factor: 2, sleep: noSleep }

function item(id: string): RawItem {
  return { id, creatorId: 'u', nickname: '张三' }
}

function page(ids: string[], hasMore: boolean, next?: PageCursor): CrawledPage {
  return { items: ids.map(item), hasMore, next: next ?? { page: null, cursor: null, sessionId: null } }
}

const sink: DataSink = {
  content: async () => {},
  comment: async () => {},
}

describe('Semaphore', () => {
  it('bounds concurrent tasks and releases permits', async () => {
    const semaphore = new Semaphore(2)
    let active = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 5 }, () =>
        semaphore.run(async () => {
          active += 1
          peak = Math.max(peak, active)
          await new Promise((resolve) => setTimeout(resolve, 10))
          active -= 1
        }),
      ),
    )
    expect(peak).toBe(2)
  })
})

describe('classifyPlatformResponse', () => {
  it('maps status codes onto stable error codes', () => {
    expect(classifyPlatformResponse({ httpStatus: 429 })).toBe('RATE_LIMITED')
    expect(classifyPlatformResponse({ httpStatus: 403 })).toBe('IP_BLOCKED')
    expect(classifyPlatformResponse({ httpStatus: 401 })).toBe('SESSION_EXPIRED')
    expect(classifyPlatformResponse({ httpStatus: 404 })).toBe('CONTENT_NOT_FOUND')
    expect(classifyPlatformResponse({ httpStatus: 200 })).toBeNull()
  })

  it('flags retryable vs fatal codes', () => {
    expect(isRetryable(new CrawlerError('RATE_LIMITED', 'x'))).toBe(true)
    expect(isRetryable(new CrawlerError('IP_BLOCKED', 'x'))).toBe(false)
    expect(isFatal(new CrawlerError('IP_BLOCKED', 'x'))).toBe(true)
    expect(isFatal(new CrawlerError('RATE_LIMITED', 'x'))).toBe(false)
  })
})

describe('retryable', () => {
  it('backs off and retries on rate limits, then succeeds', async () => {
    const sleeps: number[] = []
    let calls = 0
    const result = await retryable(async () => {
      calls += 1
      if (calls < 3) throw new CrawlerError('RATE_LIMITED', 'slow down')
      return 'ok'
    }, { maxRetries: 3, baseDelayMs: 10, factor: 2, sleep: async (ms) => { sleeps.push(ms) } })
    expect(result).toBe('ok')
    expect(calls).toBe(3)
    expect(sleeps).toEqual([10, 20])
  })

  it('rethrows immediately on fatal block errors', async () => {
    let calls = 0
    await expect(
      retryable(async () => {
        calls += 1
        throw new CrawlerError('IP_BLOCKED', 'blocked')
      }, retryFast),
    ).rejects.toMatchObject({ code: 'IP_BLOCKED' })
    expect(calls).toBe(1)
  })

  it('gives up after exhausting retries', async () => {
    let calls = 0
    await expect(
      retryable(async () => {
        calls += 1
        throw new CrawlerError('RATE_LIMITED', 'still limited')
      }, retryFast),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(calls).toBe(3)
  })
})

describe('runCrawlLoop', () => {
  it('stops at the count cap across pages', async () => {
    const fetcher = vi.fn(async (_target: string, cursor: PageCursor) =>
      page(['a', 'b', 'c'], true, { page: (cursor.page ?? 1) + 1, cursor: null, sessionId: null }),
    )
    const handed: string[] = []
    const counting: DataSink = { content: async (i) => { handed.push(i.id) }, comment: async () => {} }
    const fetched = await runCrawlLoop(fetcher, counting, {
      target: '美食', startPage: 1, maxNotesCount: 4, pageIntervalMs: 0, maxConcurrencyNum: 1, sleep: noSleep,
    })
    expect(fetched).toBe(4)
    expect(handed).toEqual(['a', 'b', 'c', 'a'])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('stops on an empty page and on hasMore=false', async () => {
    const emptyThenMore = vi.fn(async () => page([], true))
    expect(await runCrawlLoop(emptyThenMore, sink, { target: 'x', startPage: 1, maxNotesCount: 10, pageIntervalMs: 0, maxConcurrencyNum: 1, sleep: noSleep })).toBe(0)
    const single = vi.fn(async () => page(['a'], false))
    expect(await runCrawlLoop(single, sink, { target: 'x', startPage: 1, maxNotesCount: 10, pageIntervalMs: 0, maxConcurrencyNum: 1, sleep: noSleep })).toBe(1)
    expect(single).toHaveBeenCalledTimes(1)
  })

  it('isolates a failing item while the batch continues', async () => {
    const flakySink: DataSink = {
      content: async (i) => {
        if (i.id === 'bad') throw new Error('disk full for this row')
      },
      comment: async () => {},
    }
    const fetcher = vi.fn(async () => page(['good1', 'bad', 'good2'], false))
    const fetched = await runCrawlLoop(fetcher, flakySink, { target: 'x', startPage: 1, maxNotesCount: 10, pageIntervalMs: 0, maxConcurrencyNum: 1, sleep: noSleep })
    expect(fetched).toBe(2)
  })

  it('sleeps between pages with the fixed interval', async () => {
    const sleeps: number[] = []
    let call = 0
    const fetcher = vi.fn(async () => {
      call += 1
      return page([String(call)], call < 2, { page: call + 1, cursor: null, sessionId: null })
    })
    await runCrawlLoop(fetcher, sink, { target: 'x', startPage: 1, maxNotesCount: 10, pageIntervalMs: 500, maxConcurrencyNum: 1, sleep: async (ms) => { sleeps.push(ms) } })
    expect(sleeps).toEqual([500])
  })

  it('retries a rate-limited page fetch', async () => {
    let calls = 0
    const fetcher = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new CrawlerError('RATE_LIMITED', '429')
      return page(['a'], false)
    })
    const fetched = await runCrawlLoop(fetcher, sink, { target: 'x', startPage: 1, maxNotesCount: 5, pageIntervalMs: 0, maxConcurrencyNum: 1, sleep: noSleep, retry: retryFast })
    expect(fetched).toBe(1)
    expect(calls).toBe(2)
  })
})

describe('initCursor', () => {
  it('starts at the configured page', () => {
    expect(initCursor(3)).toEqual({ page: 3, cursor: null, sessionId: null })
  })
})
