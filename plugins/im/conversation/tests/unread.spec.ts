import { describe, expect, it } from 'vitest'
import { ConvStorage } from '../src/store.ts'
import { RoomService } from '../src/rooms.ts'
import { PostService } from '../src/post.ts'
import { ReadService } from '../src/reads.ts'
import { MemoryTables } from './memory-tables.ts'

/**
 * Unread counts only ever describe other people's messages: your own send is
 * read by definition, so a room with just your message never shows a badge.
 * 未读只描述别人的消息：自己发的按定义已读，因此只有自己发言的房间永远不亮徽标。
 */
describe('unread accounting', () => {
  it('does not count the viewer own messages', async () => {
    const store = new ConvStorage()
    store.attach(new MemoryTables())
    const rooms = new RoomService({ store })
    const post = new PostService({ store, rooms })
    const reads = new ReadService({ store })
    const room = await rooms.createRoom({ kind: 'direct', memberIds: ['human:owner', 'agent:default'] })
    await post.post({ roomId: room.id, actorId: 'human:owner', kind: 'text', body: 'mine' })
    expect(reads.unread(room.id, 'human:owner')).toBe(0)
    await post.post({ roomId: room.id, actorId: 'agent:default', kind: 'text', body: 'theirs' })
    expect(reads.unread(room.id, 'human:owner')).toBe(1)
  })
})
