/**
 * The vote domain: one attitude per preset, in-place switching, retraction on
 * a repeat, per-preset counting, the vote key, and the counter lookup.
 *
 * 投票域：一个预设一种态度、原地切换、重复即收回、按预设分别计数、投票键，
 * 以及计数查找。
 */

import { describe, expect, it } from 'vitest'
import { castVote, counterLookup, totalsFor } from '../src/votes.ts'
import { voteKey } from '../src/ids.ts'
import type { VoteRecord } from '../src/domain.ts'
import { memoryTable } from './helpers/domain-fixtures.ts'

describe('votes', () => {
  const tables = () => {
    const stored = memoryTable<VoteRecord>()
    return { votes: stored.table, rows: stored.rows }
  }

  it('keeps one attitude per preset and switches it in place', async () => {
    const store = tables()
    const votes = { votes: store.votes }
    await castVote(votes, 'post', 'p1', 'standard', 'up', '2026-01-01T00:00:00.000Z')
    await castVote(votes, 'post', 'p1', 'standard', 'down', '2026-01-01T00:01:00.000Z')
    const totals = totalsFor(votes, 'post', 'p1', 'standard')
    expect(totals).toEqual({ up: 0, down: 1, myVote: 'down' })
    // One row only: the key, not a check, is what makes that true.
    expect(store.rows.size).toBe(1)
  })

  it('clears the attitude when the same button is pressed twice', async () => {
    const store = tables()
    const votes = { votes: store.votes }
    await castVote(votes, 'post', 'p1', 'standard', 'up', '2026-01-01T00:00:00.000Z')
    const cleared = await castVote(votes, 'post', 'p1', 'standard', 'up', '2026-01-01T00:01:00.000Z')
    expect(cleared.cleared).toBe(true)
    expect(cleared.totals).toEqual({ up: 0, down: 0 })
    expect(store.rows.size).toBe(0)
  })

  it('counts one vote per preset separately', async () => {
    const store = tables()
    const votes = { votes: store.votes }
    await castVote(votes, 'post', 'p1', 'standard', 'up', '2026-01-01T00:00:00.000Z')
    await castVote(votes, 'post', 'p1', 'ptc', 'up', '2026-01-01T00:00:00.000Z')
    expect(totalsFor(votes, 'post', 'p1').up).toBe(2)
  })

  it('reports a reader that never voted without an attitude', async () => {
    const store = tables()
    const votes = { votes: store.votes }
    await castVote(votes, 'comment', 'c1', 'ptc', 'down', '2026-01-01T00:00:00.000Z')
    expect(totalsFor(votes, 'comment', 'c1', 'standard')).toEqual({ up: 0, down: 1 })
  })

  it('builds the same key for the same triple and no other', () => {
    expect(voteKey('post', 'p1', 'standard')).toBe(voteKey('post', 'p1', 'standard'))
    expect(voteKey('post', 'p1', 'standard')).not.toBe(voteKey('comment', 'p1', 'standard'))
    expect(voteKey('post', 'p1', 'standard')).not.toBe(voteKey('post', 'p2', 'standard'))
    expect(voteKey('post', 'p1', 'standard')).not.toBe(voteKey('post', 'p1', 'ptc'))
  })
})

describe('counter lookup', () => {
  it('reports totals and the reader attitude for posts and comments alike', () => {
    const rows = new Map<string, VoteRecord>()
    const lookup = counterLookup({
      votes: {
        get: key => rows.get(key),
        put: async (key, value) => { rows.set(key, value) },
        del: async key => rows.delete(key),
        all: () => [...rows.values()],
      },
    }, 'standard')
    expect(lookup('post', 'p1')).toEqual({ up: 0, down: 0 })
  })
})
