import { describe, expect, it } from 'vitest'
import { ConvStorage } from '../src/store.ts'
import { RoomService } from '../src/rooms.ts'
import { PostService } from '../src/post.ts'
import { MemoryTables } from './memory-tables.ts'

/**
 * The write announces `im/message-new` (persist first, then distribute) and a
 * replay stays silent: the first commit already announced the fact.
 * 写入在提交后宣告 `im/message-new`（先落库再分发），回放保持沉默：首次提交已经宣告过事实。
 */
describe('post announces fresh commits', () => {
  it('emits once per fresh commit and never for a replay', async () => {
    const store = new ConvStorage()
    store.attach(new MemoryTables())
    const rooms = new RoomService({ store })
    const seen: string[] = []
    const post = new PostService({
      store,
      rooms,
      committed: ({ message }) => seen.push(message.id),
    })
    const room = await rooms.createRoom({ kind: 'direct', memberIds: ['human:owner', 'agent:default'] })
    const first = await post.post({
      roomId: room.id, actorId: 'human:owner', kind: 'text', body: 'hello', clientId: 'c1',
    })
    const replay = await post.post({
      roomId: room.id, actorId: 'human:owner', kind: 'text', body: 'hello', clientId: 'c1',
    })
    expect(replay.replayed).toBe(true)
    expect(seen).toEqual([first.message.id])
  })

  it('survives a throwing listener: the fact stays durable', async () => {
    const store = new ConvStorage()
    store.attach(new MemoryTables())
    const rooms = new RoomService({ store })
    const post = new PostService({
      store,
      rooms,
      committed: () => { throw new Error('listener down') },
    })
    const room = await rooms.createRoom({ kind: 'direct', memberIds: ['human:owner'] })
    await expect(post.post({ roomId: room.id, actorId: 'human:owner', kind: 'text', body: 'hello' }))
      .resolves.toMatchObject({ replayed: false })
    expect(post.list({ roomId: room.id })).toHaveLength(1)
  })
})
