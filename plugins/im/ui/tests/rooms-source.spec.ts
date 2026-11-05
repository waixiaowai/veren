/**
 * The conversations source: creating a room opens it, and sending posts the
 * composer's body into that room. Both are the panel's only write paths, so a
 * regression here makes the page read-only again.
 *
 * 会话 source：新建房间后会打开它，发送会把输入区的正文写进那个房间。这两条是面板唯一的写入
 * 路径，坏掉的话页面又变成只读。
 */

import { describe, expect, it, vi } from 'vitest'
import type { ImConvApi, Message, Room } from '../src/client/remote.ts'
import { createRoomsSource } from '../src/client/rooms-source.ts'

/** One room as the fake host returns it. */
function roomOf(id: string, title: string | undefined): Room {
  return { id, kind: 'direct', ...(title === undefined ? {} : { title }), members: ['human:owner', 'agent:default'], createdAt: 1, updatedAt: 1 }
}

/** One message as the fake host returns it. */
function messageOf(roomId: string, body: string): Message {
  return { id: 'm1', roomId, authorId: 'human:owner', kind: 'text', body, sequence: 1, createdAt: 1 }
}

/** A fake conversation host: rooms and messages live in this closure. */
function fakeApi(): ImConvApi & { roomsTable: Room[] } {
  const roomsTable: Room[] = []
  const api = {
    roomsTable,
    rooms: async () => ({ ok: true, value: { rooms: roomsTable } }),
    roomMembers: async () => ({ ok: true, value: { members: [] } }),
    messages: async () => ({ ok: true, value: { messages: [] } }),
    post: async (request: { roomId: string; body: string }) => ({
      ok: true as const,
      value: { message: messageOf(request.roomId, request.body), replayed: false },
    }),
    createRoom: async (request: { title?: string }) => {
      const room = roomOf('conv-1', request.title)
      roomsTable.push(room)
      return { ok: true as const, value: { room } }
    },
    markRead: async () => ({ ok: true as const, value: { cursor: { lastReadSequence: 0 } } }),
    unreadCounts: async () => ({ ok: true as const, value: { counts: [] } }),
  }
  return api as ImConvApi & { roomsTable: Room[] }
}

describe('createRoomsSource', () => {
  it('creates a room and opens it', async () => {
    const api = fakeApi()
    const source = createRoomsSource(api, 'human:owner')
    const stop = source.source.subscribe(() => undefined)
    try {
      source.createRoom({ title: '测试会话' })
      await vi.waitFor(() => { expect(source.source.getSnapshot().rooms).toHaveLength(1) })
      expect(source.source.getSnapshot().openRoomId).toBe('conv-1')
      expect(api.roomsTable[0]?.title).toBe('测试会话')
    } finally {
      stop()
    }
  })

  it('creates a group with the chosen members and opens it', async () => {
    const api = fakeApi()
    const sent: { kind: string; memberIds: readonly string[] }[] = []
    const source = createRoomsSource({
      ...api,
      createRoom: async request => {
        sent.push({ kind: request.kind, memberIds: request.memberIds ?? [] })
        const room = roomOf('conv-2', request.title)
        return { ok: true as const, value: { room } }
      },
    }, 'human:owner')
    const stop = source.source.subscribe(() => undefined)
    try {
      source.createRoom({ kind: 'group', title: '小群', memberIds: ['human:owner', 'agent:default', 'human:person-1'] })
      await vi.waitFor(() => { expect(source.source.getSnapshot().openRoomId).toBe('conv-2') })
      expect(sent).toEqual([{ kind: 'group', memberIds: ['human:owner', 'agent:default', 'human:person-1'] }])
    } finally {
      stop()
    }
  })

  it('posts into the open room and keeps the composer idle afterwards', async () => {
    const api = fakeApi()
    const source = createRoomsSource(api, 'human:owner')
    const stop = source.source.subscribe(() => undefined)
    try {
      source.createRoom({})
      await vi.waitFor(() => { expect(source.source.getSnapshot().openRoomId).toBe('conv-1') })
      const sent = await source.send('你好')
      expect(sent).toBe(true)
      expect(source.source.getSnapshot().sending).toBe(false)
    } finally {
      stop()
    }
  })
})
