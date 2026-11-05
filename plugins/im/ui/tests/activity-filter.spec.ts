/**
 * The working-row filter: a run may still be live in the host while its reply
 * is already on screen. Drawing the row then would say "still writing" under a
 * finished answer, so the reply suppresses the row immediately.
 *
 * 工作行过滤器：运行在宿主里可能还没落定，而回复已经上屏。此时继续画工作行等于在完成的
 * 答案下面写「还在写」，因此回复一到就立刻压掉这一行。
 */

import { describe, expect, it } from 'vitest'
import { visibleActivities } from '../src/client/activity-filter.ts'
import type { Message } from '../src/client/remote.ts'
import type { RoomActivity } from '../src/client/turn-remote.ts'

/** One live run. */
function runOf(overrides: Partial<RoomActivity> = {}): RoomActivity {
  return {
    runId: 'run-1',
    roomId: 'room-1',
    agentParticipantId: 'agent:default',
    phase: 'composing',
    startedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}

/** One message on the open timeline. */
function messageOf(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    roomId: 'room-1',
    authorId: 'human:owner',
    kind: 'text',
    body: '你好',
    sequence: 1,
    createdAt: 900,
    ...overrides,
  }
}

describe('visibleActivities', () => {
  it('draws the open room\'s run while no reply is on screen', () => {
    expect(visibleActivities([runOf()], [messageOf()], 'room-1')).toHaveLength(1)
  })

  it('hides the run once that agent\'s reply is newer than the run', () => {
    const reply = messageOf({ id: 'm2', authorId: 'agent:default', createdAt: 1_500, sequence: 2 })
    expect(visibleActivities([runOf()], [messageOf(), reply], 'room-1')).toEqual([])
  })

  it('keeps the run when the newest message is an older reply', () => {
    const old = messageOf({ id: 'm0', authorId: 'agent:default', createdAt: 500 })
    const mine = messageOf({ id: 'm1', createdAt: 900 })
    expect(visibleActivities([runOf()], [old, mine], 'room-1')).toHaveLength(1)
  })

  it('drops other rooms\' runs and the no-room case', () => {
    expect(visibleActivities([runOf({ roomId: 'room-2' })], [], 'room-1')).toEqual([])
    expect(visibleActivities([runOf()], [], undefined)).toEqual([])
  })
})
