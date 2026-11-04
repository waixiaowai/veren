import { describe, expect, it } from 'vitest'
import { ALICE, OWNER, build, execOf } from './fixtures.ts'
import { imSendTool } from '../src/send-tool.ts'
import { imRememberTool, imRecallTool } from '../src/memory-tools.ts'
import { imReadTool, imRoomsTool } from '../src/room-tools.ts'

/** Seat one direct room: owner + Alice, with one human line waiting. */
/** 安排一间直聊房：owner + Alice，留一条人类消息等着。 */
async function roomWith() {
  const stack = build()
  const room = await stack.rooms.createRoom({ kind: 'direct', memberIds: [OWNER, ALICE] })
  stack.setAliceRoom(room.id)
  const trigger = await stack.post.post({ roomId: room.id, actorId: OWNER, kind: 'text', body: '帮我看看' })
  return { stack, roomId: room.id, trigger }
}

describe('im_send', () => {
  it('posts the reply into the caller\'s own room behind the gates', async () => {
    const { stack, roomId } = await roomWith()
    const tool = imSendTool(stack.conversation, stack.coordination, stack.turn)
    const result = await tool.execute({ body: '看完了，第二段建议拆两步。' }, execOf())
    expect(result).toMatchObject({ ok: true, sequence: 2 })
    const lines = stack.conversation.list({ roomId })
    expect(lines.filter(m => m.authorId === ALICE)).toHaveLength(1)
  })

  it('returns a held value, not an error, when the verbatim gate refuses', async () => {
    const { stack, roomId } = await roomWith()
    await stack.post.post({ roomId, actorId: OWNER, kind: 'text', body: '收到' })
    const tool = imSendTool(stack.conversation, stack.coordination, stack.turn)
    const result = await tool.execute({ body: '收到' }, execOf())
    expect(result).toMatchObject({ ok: false, held: true, kind: 'verbatim' })
  })

  it('refuses calls made outside any im-managed session', async () => {
    const stack = build()
    stack.setAliceRoom('conv-nowhere')
    const tool = imSendTool(stack.conversation, stack.coordination, stack.turn)
    const result = await tool.execute({ body: '在吗' }, { agent: { session: { id: 'session-unknown' } } } as never)
    expect(result).toMatchObject({ ok: false, error: { code: 'IM_NOT_FOUND' } })
  })
})

describe('im_rooms and im_read', () => {
  it('lists rooms with members named and the caller\'s unread count', async () => {
    const { stack } = await roomWith()
    const tool = imRoomsTool(stack.conversation, stack.participants, stack.turn)
    const result = await tool.execute({}, execOf()) as { ok: boolean; rooms: Array<{ unread: number; members: Array<{ displayName: string }> }> }
    expect(result.ok).toBe(true)
    expect(result.rooms).toHaveLength(1)
    expect(result.rooms[0]?.unread).toBe(1)
    expect(result.rooms[0]?.members.map(m => m.displayName)).toContain('Owner')
  })

  it('advances only the read cursor, never the seen watermark', async () => {
    const { stack, roomId } = await roomWith()
    const read = imReadTool(stack.conversation, stack.turn)
    const result = await read.execute({ roomId }, execOf()) as { ok: boolean; messages: unknown[]; readSequence: number }
    expect(result.ok).toBe(true)
    expect(result.messages).toHaveLength(1)
    expect(result.readSequence).toBe(1)
    // The watermark stays behind: triage still treats Alice as not reacted.
    // 水位仍在原地：分流依然把 Alice 当作未反应。
    expect(stack.coordination.seen(ALICE, roomId)).toBe(0)
    expect(stack.conversation.unread(roomId, ALICE)).toBe(0)
  })
})

describe('im_remember and im_recall', () => {
  it('roundtrips one fact scoped to the calling agent', async () => {
    const { stack } = await roomWith()
    const remember = imRememberTool(stack.memory, stack.turn)
    const recall = imRecallTool(stack.memory, stack.turn)
    const saved = await remember.execute({ kind: 'preference', body: 'Owner 偏好简短回复', pinned: true }, execOf()) as { ok: boolean; id: string }
    expect(saved.ok).toBe(true)
    const recalled = await recall.execute({}, execOf()) as { ok: boolean; memories: Array<{ body: string }> }
    expect(recalled.ok).toBe(true)
    expect(recalled.memories.map(m => m.body)).toContain('Owner 偏好简短回复')
    // Another agent reads nothing: memory is per participant.
    // 另一个智能体什么都读不到：记忆按参与者隔离。
    const stranger = stack.memory.recall({ agentParticipantId: 'agent:bob' })
    expect(stranger).toHaveLength(0)
  })
})
