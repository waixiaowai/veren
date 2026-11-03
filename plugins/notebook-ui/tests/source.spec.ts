/**
 * The owner election's invariants — the executable half of O1/O5 in
 * docs/notebook-canvas-optimization-task.cn.md.
 *
 * The old rule (`prefer the declared preset`) opened a fresh reader on a blank
 * canvas while a box full of cards waited one manual selection away. These
 * specs pin the replacement: an explicit memory wins while it exists, boxes
 * with cards outrank empty ones, card count then recency then id decide, and a
 * declared empty box only leads when every box is empty.
 *
 * 归属选举的不变式——docs/notebook-canvas-optimization-task.cn.md O1/O5 的可
 * 执行一半。
 *
 * 旧规则（「声明优先」）会在满盒卡片只差一次手选时把新读者扔进空白画布。
 * 这些测试钉住替代规则：显式记忆只要存在就赢，有卡的盒压过空盒，卡数→最近
 * 活跃→id 依次裁决，只有所有盒都空时声明过的空盒才领先。
 */

import { describe, expect, it } from 'vitest'
import { electOwner } from '../src/client/source.ts'
import type { OwnerView } from '../src/client/remote.ts'

/** One roster row with the fields the election reads. 只带选举所读字段的归属行。 */
function owner(id: string, noteCount: number, declared = true, lastActiveAt = ''): OwnerView {
  return { id, declared, noteCount, lastActiveAt }
}

describe('owner election — explicit memory / 显式记忆', () => {
  it('keeps the remembered owner while it still exists', () => {
    const owners = [owner('empty', 0), owner('big', 9)]
    expect(electOwner(owners, 'empty')).toBe('empty')
  })

  it('elects afresh when the remembered owner is gone', () => {
    const owners = [owner('empty', 0), owner('big', 9)]
    expect(electOwner(owners, 'removed')).toBe('big')
  })

  it('does not let a stale id win the empty roster', () => {
    expect(electOwner([], 'gone')).toBeUndefined()
  })
})

describe('owner election — cards before declarations / 有卡优先', () => {
  it('prefers a box with cards over an empty declared preset', () => {
    // The U1 regression: `cordis` is declared, `standard` holds nine cards.
    // U1 回归：`cordis` 被声明，`standard` 有九张卡。
    const owners = [owner('cordis', 0), owner('standard', 9, false)]
    expect(electOwner(owners, undefined)).toBe('standard')
  })

  it('ranks card count first, then recency', () => {
    const owners = [
      owner('older-many', 5, true, '2026-10-01T00:00:00.000Z'),
      owner('newer-few', 2, true, '2026-11-03T00:00:00.000Z'),
      owner('older-few', 2, true, '2026-10-02T00:00:00.000Z'),
    ]
    expect(electOwner(owners, undefined)).toBe('older-many')
  })

  it('breaks equal card counts by the most recent activity', () => {
    const owners = [
      owner('old', 3, true, '2026-10-01T00:00:00.000Z'),
      owner('fresh', 3, true, '2026-11-03T00:00:00.000Z'),
    ]
    expect(electOwner(owners, undefined)).toBe('fresh')
  })

  it('breaks equal card counts and activity by id, deterministically', () => {
    const owners = [owner('b', 1), owner('a', 1)]
    expect(electOwner(owners, undefined)).toBe('a')
    expect(electOwner([...owners].reverse(), undefined)).toBe('a')
  })
})

describe('owner election — all boxes empty / 全空', () => {
  it('prefers a declared empty box over a remembered-only one', () => {
    const owners = [owner('orphan', 0, false), owner('declared', 0)]
    expect(electOwner(owners, undefined)).toBe('declared')
  })

  it('still answers when nothing is declared', () => {
    expect(electOwner([owner('b', 0, false), owner('a', 0, false)], undefined)).toBe('a')
  })
})
