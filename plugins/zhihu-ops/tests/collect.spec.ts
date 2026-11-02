/**
 * 采集与调度的单测：按天幂等、失败记账、额度耗尽算 partial、到点判定。
 * Unit tests for the pull and the scheduler: the per-day idempotency, the
 * failure ledger, the quota exhaustion reading as partial, and the due check.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ZhihuDataSource } from '@veren/zhihu-client'
import { ZhihuError, ZhihuErrorCode } from '@veren/zhihu-client'
import { runPull } from '../src/collect/pull.ts'
import type { PullStorage } from '../src/collect/pull.ts'
import { PullScheduler, parseHourMinute } from '../src/schedule/runner.ts'
import { dayKey } from '../src/collect/day.ts'
import type { PullRunRow, AccountStatsRow, ContentRow, ContentStatsRow, CommentRow, HotItemRow, QuestionRow } from '../src/store/store.ts'

/** 一个内存存储（实现采集用到的存储端口）/ an in-memory storage (implements the pull's storage port) */
class MemoryStorage implements PullStorage {
  readonly pullRuns = new Map<string, PullRunRow>()
  readonly accountRows = new Map<string, AccountStatsRow>()
  readonly contentRows = new Map<string, ContentRow>()
  readonly statsRows = new Map<string, ContentStatsRow>()
  readonly commentRows = new Map<string, CommentRow>()
  readonly hotRows = new Map<string, HotItemRow>()
  readonly questionRows = new Map<string, QuestionRow>()

  async putPullRun(row: PullRunRow): Promise<void> { this.pullRuns.set(row.day, row) }
  async putAccountStats(row: AccountStatsRow): Promise<void> { this.accountRows.set(row.day, row) }
  async putContent(row: ContentRow): Promise<void> { this.contentRows.set(row.content_id, row) }
  async putContentStats(row: ContentStatsRow): Promise<void> { this.statsRows.set(`${row.day}::${row.content_id}`, row) }
  async putComment(row: CommentRow): Promise<void> { this.commentRows.set(`${row.content_id}::${row.comment_id}`, row) }
  async putHotItem(row: HotItemRow): Promise<void> { this.hotRows.set(`${row.day}::${row.rank}`, row) }
  async putQuestion(row: QuestionRow): Promise<void> { this.questionRows.set(`${row.day}::${row.question_id}`, row) }
  accountStats(): AccountStatsRow[] { return [...this.accountRows.values()] }
  contents(): ContentRow[] { return [...this.contentRows.values()] }
  contentStats(): ContentStatsRow[] { return [...this.statsRows.values()] }
  getPullRun(day: string): PullRunRow | undefined { return this.pullRuns.get(day) }
}

/** 一个假的数据源 / a fake data source */
function fakeSource(overrides: Partial<ZhihuDataSource> = {}): ZhihuDataSource {
  const base: ZhihuDataSource = {
    name: 'fake',
    accountStats: async () => ({
      followerCount: 100, followingCount: 5, answerCount: 3, articleCount: 1,
      videoCount: 0, totalLikeCount: 20, totalUpvoteCount: 10, totalViewCount: 500,
      collectedAt: '2026-11-02T00:00:00.000Z',
    }),
    contents: async () => [{
      contentId: 'c1', contentType: 'answer', title: '标题',
      url: 'https://www.zhihu.com/answer/c1', createdAt: '2026-11-01T00:00:00.000Z',
    }],
    contentStats: async () => ({ contentId: 'c1', viewCount: 10, likeCount: 2, commentCount: 1 }),
    comments: async () => [{ commentId: 'm1', authorToken: 'u1', content: '好', likeCount: 1, createdAt: '2026-11-02T00:00:00.000Z' }],
    hotList: async () => [{ rank: 1, title: '热点', url: 'https://www.zhihu.com/question/1' }],
    suggestedQuestions: async () => [{ questionId: 'q1', title: '好问题', url: 'https://www.zhihu.com/question/q1' }],
    quota: async () => ({ total: 1000, used: 1, remaining: 999 }),
  }
  return { ...base, ...overrides }
}

/** 一个固定的存储（供采集用）/ a fixed storage (for the pull) */
function storageOf(): MemoryStorage {
  return new MemoryStorage()
}

/** 采集用到的固定时刻 / the fixed instant the pull sees */
const NOW = new Date('2026-11-02T09:00:00Z')

describe('pull', () => {
  it('stores the account stats, the contents, and the hot list', async () => {
    const storage = new MemoryStorage()
    const outcome = await runPull({ source: fakeSource(), storage, contentLimit: 5, now: () => NOW })
    expect(outcome.state).toBe('ok')
    expect(outcome.day).toBe(dayKey(NOW))
    expect(storage.accountStats()).toHaveLength(1)
    expect(storage.contents()).toHaveLength(1)
    expect(storage.getPullRun(dayKey(NOW))?.state).toBe('ok')
  })

  it('is idempotent per day: a second pull overwrites', async () => {
    const storage = new MemoryStorage()
    await runPull({ source: fakeSource(), storage, contentLimit: 5, now: () => NOW })
    await runPull({ source: fakeSource(), storage, contentLimit: 5, now: () => NOW })
    expect(storage.accountStats()).toHaveLength(1)
  })

  it('records a failed pull honestly', async () => {
    const storage = new MemoryStorage()
    const failing = fakeSource({
      accountStats: async () => { throw new Error('boom') },
    })
    const outcome = await runPull({ source: failing, storage, contentLimit: 5, now: () => NOW })
    expect(outcome.state).toBe('failed')
    expect(storage.getPullRun(dayKey(NOW))?.reason).toContain('boom')
  })

  it('reads an exhausted allowance as partial, not failed', async () => {
    const storage = new MemoryStorage()
    const exhausted = fakeSource({
      contents: async () => { throw new ZhihuError(ZhihuErrorCode.QuotaExhausted, 'no quota') },
    })
    const outcome = await runPull({ source: exhausted, storage, contentLimit: 5, now: () => NOW })
    expect(outcome.state).toBe('partial')
    expect(storage.getPullRun(dayKey(NOW))?.state).toBe('partial')
  })

  it('computes the follower delta against the previous day', async () => {
    const storage = new MemoryStorage()
    const growing = fakeSource({
      accountStats: async () => ({
        followerCount: 120, followingCount: 5, answerCount: 3, articleCount: 1,
        videoCount: 0, totalLikeCount: 20, totalUpvoteCount: 10, totalViewCount: 500,
        collectedAt: '2026-11-02T00:00:00.000Z',
      }),
    })
    await runPull({ source: fakeSource(), storage, contentLimit: 5, now: () => new Date('2026-11-01T09:00:00Z') })
    await runPull({ source: growing, storage, contentLimit: 5, now: () => NOW })
    const rows = storage.accountStats()
    expect(rows[1]?.follower_delta).toBe(20)
  })
})

describe('scheduler', () => {
  it('parses the configured pull time', () => {
    expect(parseHourMinute('08:30')).toEqual({ hour: 8, minute: 30 })
  })

  it('rejects an illegal pull time', () => {
    expect(() => parseHourMinute('25:00')).toThrow()
  })

  it('is due after the pull time when today has no pull', async () => {
    let pulled = false
    const scheduler = new PullScheduler(fakeHost(), {
      pull: async () => { pulled = true; return { day: '2026-11-02', state: 'ok', followerCount: 0, contentCount: 0, requestCount: 0 } },
      pulledOn: () => false,
      now: () => new Date('2026-11-02T09:00:00'),
    }, { pullLocalTime: '08:00', tickMs: 1000 })
    expect(scheduler.isDue()).toBe(true)
    await scheduler.tick()
    expect(pulled).toBe(true)
  })

  it('is not due before the pull time', () => {
    const scheduler = new PullScheduler(fakeHost(), {
      pull: async () => { throw new Error('must not run') },
      pulledOn: () => false,
      now: () => new Date('2026-11-02T07:00:00'),
    }, { pullLocalTime: '08:00', tickMs: 1000 })
    expect(scheduler.isDue()).toBe(false)
  })

  it('is not due once today already has a pull', () => {
    const scheduler = new PullScheduler(fakeHost(), {
      pull: async () => { throw new Error('must not run') },
      pulledOn: () => true,
      now: () => new Date('2026-11-02T09:00:00'),
    }, { pullLocalTime: '08:00', tickMs: 1000 })
    expect(scheduler.isDue()).toBe(false)
  })
})

/** 一个只提供 effect 与 logger 的假宿主 / a fake host providing only effect and logger */
function fakeHost(): Context {
  return {
    effect: <T>(run: () => T) => { run(); return () => undefined },
    logger: { info: () => undefined, warn: () => undefined },
  } as unknown as Context
}
