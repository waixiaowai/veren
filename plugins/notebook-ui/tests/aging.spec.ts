/**
 * The aging labels: window-edge arithmetic and the template rendering, both
 * pure and clock-explicit — the presentation half of the freshness window.
 *
 * 老化文案：窗口边界的算术与模板渲染，皆纯函数、时钟显式——保鲜窗的展示一半。
 */

import { describe, expect, it } from 'vitest'
import { agingLabelOf, agingText, DAY_MS } from '../src/client/aging.ts'

const NOW = Date.parse('2026-11-03T12:00:00.000Z')

describe('aging labels / 老化文案', () => {
  it('counts whole days left within the window', () => {
    expect(agingLabelOf(new Date(NOW + 2 * DAY_MS).toISOString(), NOW)).toEqual({ key: 'dueIn', days: 2 })
    expect(agingLabelOf(new Date(NOW + DAY_MS).toISOString(), NOW)).toEqual({ key: 'dueIn', days: 1 })
    // 23 hours left still reads as one whole day.
    // 剩 23 小时仍读作一整天。
    expect(agingLabelOf(new Date(NOW + 23 * 3600_000).toISOString(), NOW)).toEqual({ key: 'dueIn', days: 1 })
  })

  it('flips to overdue at the deadline and counts whole days past', () => {
    expect(agingLabelOf(new Date(NOW).toISOString(), NOW)).toEqual({ key: 'overdueFor', days: 1 })
    expect(agingLabelOf(new Date(NOW - 3 * DAY_MS).toISOString(), NOW)).toEqual({ key: 'overdueFor', days: 3 })
  })

  it('renders the templates with the day count substituted, both locales', () => {
    const zh = { dueIn: '剩 {d} 天', overdueFor: '已过期 {d} 天' }
    const en = { dueIn: '{d}d left', overdueFor: 'overdue {d}d' }
    expect(agingText({ key: 'dueIn', days: 2 }, key => zh[key])).toBe('剩 2 天')
    expect(agingText({ key: 'overdueFor', days: 5 }, key => zh[key])).toBe('已过期 5 天')
    expect(agingText({ key: 'dueIn', days: 2 }, key => en[key])).toBe('2d left')
  })
})
