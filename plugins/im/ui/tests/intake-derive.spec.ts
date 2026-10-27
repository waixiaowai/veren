/**
 * Unit specs for the intake tab's pure derivations: funnel order, the
 * waiting/audit split, the empty verdict, and duration splitting.
 *
 * 采集页签纯派生的单元测试：漏斗顺序、等待/审计分流、空态判定与时长拆分。
 */

import { describe, expect, it } from 'vitest'
import {
  auditRows, funnelCells, intakeUntouched, pendingRows, splitDuration, type IntakeRow,
} from '../src/client/intake-derive.ts'

/** One record factory with overridable fields. */
function row(overrides: Partial<IntakeRow>): IntakeRow {
  return {
    personId: 'p1', personName: '甲', status: 'asked', provider: 'wechat', accountId: 'a1',
    conversationId: 'c1', askedAt: 1_000, askMessageId: 'm1', askText: 'q', expiresAt: 61_000,
    ...overrides,
  }
}

describe('funnelCells', () => {
  it('orders the closed status set as a funnel: asked → answered/declined → expired', () => {
    const cells = funnelCells({ asked: 1, answered: 2, declined: 3, expired: 4 })
    expect(cells.map(cell => cell.status)).toEqual(['asked', 'answered', 'declined', 'expired'])
    expect(cells.map(cell => cell.count)).toEqual([1, 2, 3, 4])
  })

  it('reads keys the loose wire omitted as zero', () => {
    const cells = funnelCells({ asked: 2 } as Parameters<typeof funnelCells>[0])
    expect(cells.map(cell => cell.count)).toEqual([2, 0, 0, 0])
  })
})

describe('pendingRows / auditRows', () => {
  const recent: readonly IntakeRow[] = [
    row({ personId: 'a', status: 'answered', askedAt: 100 }),
    row({ personId: 'b', status: 'asked', askedAt: 300 }),
    row({ personId: 'c', status: 'asked', askedAt: 200 }),
    row({ personId: 'd', status: 'declined', askedAt: 50 }),
  ]

  it('splits waiting rows out of the audit trail, newest ask first', () => {
    expect(pendingRows(recent).map(entry => entry.personId)).toEqual(['b', 'c'])
    expect(auditRows(recent).map(entry => entry.personId)).toEqual(['a', 'd'])
  })

  it('keeps the split total equal to the input', () => {
    expect(pendingRows(recent).length + auditRows(recent).length).toBe(recent.length)
  })
})

describe('intakeUntouched', () => {
  const zeros = { asked: 0, answered: 0, declined: 0, expired: 0 }

  it('is true only when every count is zero and no rows exist', () => {
    expect(intakeUntouched(zeros, [])).toBe(true)
  })

  it('is false once any count is nonzero', () => {
    expect(intakeUntouched({ ...zeros, expired: 1 }, [])).toBe(false)
  })

  it('is false once any row exists, even with all counts zero', () => {
    expect(intakeUntouched(zeros, [row({})])).toBe(false)
  })
})

describe('splitDuration', () => {
  it('splits whole minutes, seconds, and zero honestly', () => {
    expect(splitDuration(120_000)).toEqual({ value: 2, unit: 'minutes' })
    expect(splitDuration(10_000)).toEqual({ value: 10, unit: 'seconds' })
    expect(splitDuration(90_000)).toEqual({ value: 90, unit: 'seconds' })
    expect(splitDuration(0)).toEqual({ value: 0, unit: 'seconds' })
  })
})
