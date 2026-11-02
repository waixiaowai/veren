/**
 * 派生指标的单测：账号趋势、内容表现、movers、待回评论。
 * Unit tests for the derived metrics: the account trend, the content
 * performance, the movers, and the reply candidates.
 */
import { describe, expect, it } from 'vitest'
import { accountTrend, contentPerformance, moversOf, replyCandidates } from '../src/collect/metrics.ts'
import type { AccountStatsRow, ContentRow, ContentStatsRow } from '../src/store/store.ts'

/** 造一条账号日快照 / one account day snapshot */
function accountRow(day: string, followerCount: number, followerDelta: number): AccountStatsRow {
  return {
    day,
    follower_count: followerCount,
    following_count: 10,
    answer_count: 5,
    article_count: 2,
    video_count: 0,
    total_like_count: 100,
    follower_delta: followerDelta,
    collected_at: `${day}T00:00:00.000Z`,
  }
}

/** 造一条内容档案 / one content profile */
function contentRow(id: string, title: string): ContentRow {
  return {
    content_id: id,
    content_type: 'answer',
    title,
    first_seen_day: '2026-11-01',
    updated_day: '2026-11-01',
  }
}

/** 造一条内容日统计 / one per-content day stats row */
function statsRow(day: string, contentId: string, views: number, likes: number, comments: number): ContentStatsRow {
  return {
    day,
    content_id: contentId,
    view_count: views,
    like_count: likes,
    comment_count: comments,
    collect_count: 0,
    collected_at: `${day}T00:00:00.000Z`,
  }
}

describe('account trend', () => {
  it('computes the window growth and the daily average', () => {
    const trend = accountTrend([
      accountRow('2026-11-01', 100, 5),
      accountRow('2026-11-02', 110, 10),
    ])
    expect(trend.followerCount).toBe(110)
    expect(trend.followerDelta).toBe(10)
    expect(trend.windowGrowth).toBe(10)
    expect(trend.windowDays).toBe(2)
    expect(trend.dailyAverage).toBe(5)
  })

  it('answers zeros for an empty window', () => {
    const trend = accountTrend([])
    expect(trend.followerCount).toBe(0)
    expect(trend.windowDays).toBe(0)
    expect(trend.dailyAverage).toBe(0)
  })
})

describe('content performance', () => {
  it('reads the latest values and the window delta', () => {
    const performance = contentPerformance(contentRow('c1', '标题'), [
      statsRow('2026-11-01', 'c1', 100, 4, 2),
      statsRow('2026-11-02', 'c1', 160, 9, 3),
    ])
    expect(performance.viewCount).toBe(160)
    expect(performance.viewDelta).toBe(60)
    expect(performance.likeCount).toBe(9)
    expect(performance.commentCount).toBe(3)
  })

  it('computes the engagement proxy', () => {
    const performance = contentPerformance(contentRow('c1', '标题'), [statsRow('2026-11-01', 'c1', 100, 4, 2)])
    expect(performance.engagementRate).toBe(0.06)
  })

  it('answers zero engagement when there are no views', () => {
    const performance = contentPerformance(contentRow('c1', '标题'), [statsRow('2026-11-01', 'c1', 0, 4, 2)])
    expect(performance.engagementRate).toBe(0)
  })
})

describe('movers and reply candidates', () => {
  const performances = [
    contentPerformance(contentRow('c1', 'A'), [statsRow('2026-11-01', 'c1', 100, 10, 1)]),
    contentPerformance(contentRow('c2', 'B'), [statsRow('2026-11-01', 'c2', 500, 2, 9)]),
  ]

  it('orders the movers by the window growth', () => {
    expect(moversOf(performances, 2).map((item) => item.contentId)).toEqual(['c2', 'c1'])
  })

  it('keeps only the movers within the limit', () => {
    expect(moversOf(performances, 1)).toHaveLength(1)
  })

  it('picks the pieces with more comments than likes', () => {
    expect(replyCandidates(performances, 5).map((item) => item.contentId)).toEqual(['c2'])
  })
})
