import { describe, expect, it } from 'vitest'
import { ALICE, BOB, OWNER, build } from './helpers.ts'

describe('deterministic triage', () => {
  it('wakes the agent in a direct room when a human speaks', async () => {
    const { rooms, coordination } = build()
    const room = await rooms.createRoom({ kind: 'direct', memberIds: [OWNER, ALICE] })
    const verdict = coordination.triage({ roomId: room.id, authorId: OWNER, body: '在吗', candidateId: ALICE })
    expect(verdict).toEqual({ actionable: true, source: 'direct-human' })
  })

  it('keeps agents quiet about other agents unless mentioned', async () => {
    const { rooms, coordination } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: [OWNER, ALICE, BOB] })
    const quiet = coordination.triage({ roomId: room.id, authorId: ALICE, body: '我先看看', candidateId: BOB })
    expect(quiet).toEqual({ actionable: false, source: 'agent-quiet' })
    const mentioned = coordination.triage({ roomId: room.id, authorId: ALICE, body: '@鲍勃 你来接手', candidateId: BOB })
    expect(mentioned).toEqual({ actionable: true, source: 'mentioned' })
  })

  it('keeps group chatter quiet unless a human names an agent', async () => {
    const { rooms, coordination } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: [OWNER, ALICE, BOB] })
    const quiet = coordination.triage({ roomId: room.id, authorId: OWNER, body: '大家随便看看', candidateId: ALICE })
    expect(quiet).toEqual({ actionable: false, source: 'group-quiet' })
    const named = coordination.triage({ roomId: room.id, authorId: OWNER, body: '爱丽丝 帮我把这份文档理一下', candidateId: ALICE })
    expect(named).toEqual({ actionable: true, source: 'mentioned' })
  })

  it('never wakes the author itself', async () => {
    const { rooms, coordination } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: [OWNER, ALICE] })
    const verdict = coordination.triage({ roomId: room.id, authorId: ALICE, body: '爱丽丝 在吗', candidateId: ALICE })
    expect(verdict).toEqual({ actionable: false, source: 'self-authored' })
  })

  it('drops low-priority wakes once the budget is exhausted, then recovers', async () => {
    const { coordination, advanceClock } = build({ budget: 2 })
    expect(coordination.takeBudget()).toBe(true)
    expect(coordination.takeBudget()).toBe(true)
    expect(coordination.takeBudget()).toBe(false)
    advanceClock(60_001)
    expect(coordination.takeBudget()).toBe(true)
  })
})
