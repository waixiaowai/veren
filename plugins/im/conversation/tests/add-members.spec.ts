/**
 * Adding members to an existing room: group rooms take more people and agents
 * after creation, repeats converge on the existing seat, and a direct room —
 * whose two seats are the room itself — refuses.
 *
 * 给既有房间追加成员：群聊在创建之后可以继续收起人与智能体，重复入座收敛到既有座位，而私聊
 * ——两个座位就是房间本身——拒绝新增。
 */

import { describe, expect, it } from 'vitest'
import { ConvStorage } from '../src/store.ts'
import { RoomService } from '../src/rooms.ts'
import { MemoryTables } from './memory-tables.ts'

/** One room service over a fresh memory seam. */
/** 一只跑在全新内存接缝上的房间服务。 */
function build(): { rooms: RoomService } {
  const store = new ConvStorage()
  store.attach(new MemoryTables())
  return { rooms: new RoomService({ store, now: () => 1_000 }) }
}

describe('conversation add members', () => {
  it('seats a person and an agent in a group after creation', async () => {
    const { rooms } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: ['human:owner', 'agent:default'] })
    const updated = await rooms.addMembers({
      roomId: room.id,
      actorId: 'human:owner',
      memberIds: ['human:person-1', 'agent:reviewer'],
    })
    expect(updated.members).toEqual(['human:owner', 'agent:default', 'human:person-1', 'agent:reviewer'])
    expect(rooms.memberships(room.id).map(member => member.participantId)).toEqual(updated.members)
    expect(rooms.room(room.id)?.members).toEqual(updated.members)
  })

  it('converges on the existing seat when a member is added twice', async () => {
    const { rooms } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: ['human:owner'] })
    await rooms.addMembers({ roomId: room.id, actorId: 'human:owner', memberIds: ['agent:reviewer'] })
    const updated = await rooms.addMembers({
      roomId: room.id,
      actorId: 'human:owner',
      memberIds: ['agent:reviewer', 'human:person-1'],
    })
    expect(updated.members).toEqual(['human:owner', 'agent:reviewer', 'human:person-1'])
    expect(rooms.memberships(room.id)).toHaveLength(3)
  })

  it('refuses a direct room, whose two seats are the room itself', async () => {
    const { rooms } = build()
    const room = await rooms.createRoom({ kind: 'direct', memberIds: ['human:owner', 'agent:default'] })
    await expect(rooms.addMembers({
      roomId: room.id,
      actorId: 'human:owner',
      memberIds: ['agent:reviewer'],
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(rooms.room(room.id)?.members).toEqual(['human:owner', 'agent:default'])
  })

  it('reads a non-member actor as not-found and never seats anyone', async () => {
    const { rooms } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: ['human:owner'] })
    await expect(rooms.addMembers({
      roomId: room.id,
      actorId: 'human:person-1',
      memberIds: ['agent:reviewer'],
    })).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' })
    expect(rooms.room(room.id)?.members).toEqual(['human:owner'])
  })
})
