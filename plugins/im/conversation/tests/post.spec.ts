import { describe, expect, it } from 'vitest'
import { ConvStorage } from '../src/store.ts'
import { RoomService } from '../src/rooms.ts'
import { PostService } from '../src/post.ts'
import { ReadService } from '../src/reads.ts'
import { MemoryTables } from './memory-tables.ts'

/** Assemble one facade over a fresh memory seam with a deterministic clock. */
/** 在全新内存接缝上组装一只定准时钟的门面。 */
function build() {
  let clock = 1_000
  let counter = 0
  const store = new ConvStorage()
  store.attach(new MemoryTables())
  const rooms = new RoomService({ store, now: () => clock })
  const post = new PostService({
    store,
    rooms,
    now: () => clock,
    newId: () => `msg-${++counter}`,
  })
  const reads = new ReadService({ store, now: () => clock })
  return { store, rooms, post, reads, clockOf: () => clock }
}

describe('conversation post path', () => {
  it('allocates room-exclusive increasing sequences across concurrent posts', async () => {
    const { rooms, post } = build()
    const room = await rooms.createRoom({ kind: 'group', title: '工作台', memberIds: ['human:owner', 'agent:default'] })
    // Fire concurrently: the room chain must serialize the counter work.
    // 并发点火：房间写链必须把计数器工作串行化。
    const [first, second, third] = await Promise.all([
      post.post({ roomId: room.id, actorId: 'human:owner', kind: 'text', body: '一' }),
      post.post({ roomId: room.id, actorId: 'agent:default', kind: 'text', body: '二' }),
      post.post({ roomId: room.id, actorId: 'human:owner', kind: 'text', body: '三' }),
    ])
    void rooms
    expect([first.message.sequence, second.message.sequence, third.message.sequence].sort((a, b) => a - b))
      .toEqual([1, 2, 3])
    const listed = post.list({ roomId: room.id })
    expect(listed.map(m => m.sequence)).toEqual([1, 2, 3])
  })

  it('replays the same client id and conflicts on the same key with a new body', async () => {
    const { rooms, post } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: ['human:owner'] })
    const first = await post.post({
      roomId: room.id, actorId: 'human:owner', kind: 'text', body: '原文', clientId: 'c1',
    })
    expect(first.replayed).toBe(false)
    const replay = await post.post({
      roomId: room.id, actorId: 'human:owner', kind: 'text', body: '原文', clientId: 'c1',
    })
    expect(replay.replayed).toBe(true)
    expect(replay.message.id).toBe(first.message.id)
    expect(post.list({ roomId: room.id })).toHaveLength(1)
    await expect(post.post({
      roomId: room.id, actorId: 'human:owner', kind: 'text', body: '换了内容', clientId: 'c1',
    })).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT' })
  })

  it('reads a non-member as not-found on post', async () => {
    const { rooms, post } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: ['human:owner'] })
    await expect(post.post({
      roomId: room.id, actorId: 'agent:default', kind: 'text', body: '偷跑',
    })).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' })
  })

  it('lets the system author record facts without membership', async () => {
    const { rooms, post } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: ['human:owner'] })
    const result = await post.post({
      roomId: room.id, actorId: 'system', kind: 'system', body: '已建立房间',
    })
    expect(result.message.sequence).toBe(1)
    expect(result.message.authorId).toBe('system')
  })

  it('keeps read cursors monotonic and derives unread counts', async () => {
    const { rooms, post, reads } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: ['human:owner', 'agent:default'] })
    await post.post({ roomId: room.id, actorId: 'agent:default', kind: 'text', body: '一' })
    await post.post({ roomId: room.id, actorId: 'agent:default', kind: 'text', body: '二' })
    await reads.markRead(room.id, 'human:owner', 1)
    expect(reads.unread(room.id, 'human:owner')).toBe(1)
    // A late stale request must not push the cursor back.
    // 迟到的过期请求绝不能把游标推回去。
    await reads.markRead(room.id, 'human:owner', 0)
    expect(reads.readOf(room.id, 'human:owner')).toBe(1)
    await reads.markRead(room.id, 'human:owner', 2)
    expect(reads.unread(room.id, 'human:owner')).toBe(0)
  })

  it('exposes the newest peer message for the verbatim gate', async () => {
    const { rooms, post } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: ['human:owner', 'agent:default'] })
    await post.post({ roomId: room.id, actorId: 'human:owner', kind: 'text', body: '甲' })
    await post.post({ roomId: room.id, actorId: 'agent:default', kind: 'text', body: '乙' })
    await post.post({ roomId: room.id, actorId: 'human:owner', kind: 'text', body: '丙' })
    // For agent:default the newest non-self body is 丙 (human:owner).
    // 对 agent:default 而言，最新的非自身正文是丙（human:owner）。
    expect(post.lastPeerMessage(room.id, 'agent:default')?.body).toBe('丙')
    expect(post.lastPeerMessage(room.id, 'human:owner')?.body).toBe('乙')
  })
})
