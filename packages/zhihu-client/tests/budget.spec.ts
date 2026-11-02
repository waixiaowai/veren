/**
 * 本地日预算的单测：上限、跨日重置、不限额度。
 * Unit tests for the local daily budget: the cap, the day rollover, and the
 * unlimited case.
 */
import { describe, expect, it } from 'vitest'
import { DailyCallBudget } from '../src/official/budget.ts'
import { ZhihuErrorCode } from '../src/errors.ts'

/** 一个可推进的假钟面 / a movable fake clock */
function clockAt(start: string): { now: () => number; advance: (days: number) => void } {
  let current = new Date(start).getTime()
  return {
    now: () => current,
    advance: (days: number) => { current += days * 24 * 60 * 60 * 1000 },
  }
}

describe('daily call budget', () => {
  it('counts the calls it spent', () => {
    const budget = new DailyCallBudget(10, clockAt('2026-11-01T00:00:00Z').now)
    budget.consume('a')
    budget.consume('b')
    expect(budget.usedToday()).toBe(2)
  })

  it('throws once the cap is reached', () => {
    const budget = new DailyCallBudget(1, clockAt('2026-11-01T00:00:00Z').now)
    budget.consume('a')
    expect(() => budget.consume('b')).toThrowError(expect.objectContaining({ code: ZhihuErrorCode.DailyCapReached }))
  })

  it('resets the count on the next day', () => {
    const clock = clockAt('2026-11-01T23:00:00Z')
    const budget = new DailyCallBudget(1, clock.now)
    budget.consume('a')
    clock.advance(1)
    expect(budget.usedToday()).toBe(0)
    expect(() => budget.consume('b')).not.toThrow()
  })

  it('never throws when the cap is not positive', () => {
    const budget = new DailyCallBudget(0, clockAt('2026-11-01T00:00:00Z').now)
    for (let index = 0; index < 50; index += 1) budget.consume('a')
    expect(budget.usedToday()).toBe(50)
  })
})
