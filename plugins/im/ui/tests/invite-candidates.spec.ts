/**
 * The invite list is a pure derivation: a group room offers every roster agent
 * and address-book person it has not seated yet, each id once, agents first.
 *
 * 邀请清单是纯推导：群聊列出尚未入座的每个名册智能体与通讯录人员，每个 id 只出现一次，
 * 智能体在前。
 */

import { describe, expect, it } from 'vitest'
import { inviteCandidates } from '../src/client/invite-candidates.ts'
import type { ImParticipant, ImPersonView, Room } from '../src/client/remote.ts'

/** Locale seat stand-in: the key is the expectation. */
/** 语座位替身：键就是断言对象。 */
const t = (key: string): string => key

/** One group room seating exactly the given members. */
/** 一个恰好坐着给定成员的群聊。 */
function roomOf(members: readonly string[]): Room {
  return { id: 'conv-1', kind: 'group', members: [...members], createdAt: 1, updatedAt: 1 }
}

/** One address-book contact with the minimum the directory carries. */
/** 通讯录联系人，只带目录必备字段。 */
function personOf(id: string, displayName: string): ImPersonView {
  return {
    id,
    displayName,
    aliases: [],
    contacts: [],
    claimedContacts: [],
    identityStatus: 'unverified',
    addresses: [],
    updatedAt: 1,
  }
}

const PARTICIPANTS: readonly ImParticipant[] = [
  { id: 'human:owner', kind: 'human', displayName: '我' },
  { id: 'agent:default', kind: 'agent', displayName: '助手' },
  { id: 'agent:reviewer', kind: 'agent', displayName: '审阅者' },
]

describe('inviteCandidates', () => {
  it('lists unseated agents before unseated people, with display names', () => {
    const candidates = inviteCandidates(
      roomOf(['human:owner', 'agent:default']),
      [personOf('person-1', '杨明明')],
      PARTICIPANTS,
      t,
    )
    expect(candidates.map(candidate => candidate.id)).toEqual(['agent:reviewer', 'human:person-1'])
    expect(candidates.map(candidate => candidate.label)).toEqual(['审阅者', '杨明明'])
    expect(candidates.map(candidate => candidate.kind)).toEqual(['agent', 'human'])
  })

  it('never offers someone already seated', () => {
    const candidates = inviteCandidates(
      roomOf(['human:owner', 'agent:default', 'agent:reviewer', 'human:person-1']),
      [personOf('person-1', '杨明明')],
      PARTICIPANTS,
      t,
    )
    expect(candidates).toEqual([])
  })

  it('keeps one row per id even when the roster repeats an agent', () => {
    const candidates = inviteCandidates(
      roomOf(['human:owner']),
      [],
      [...PARTICIPANTS, { id: 'agent:reviewer', kind: 'agent', displayName: '审阅者' }],
      t,
    )
    expect(candidates.map(candidate => candidate.id)).toEqual(['agent:default', 'agent:reviewer'])
  })
})
