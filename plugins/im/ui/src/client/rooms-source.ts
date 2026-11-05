/**
 * The conversations tab's single observable over the `imConv` namespace: the
 * room list re-reads on the same 5s cadence as the catalog, and opening a room
 * fetches its members and timeline once (the panel's refresh re-reads).
 *
 * 会话页基于 `imConv` 命名空间的唯一可观察对象：房间列表与目录同按 5s 节奏重读，打开
 * 房间会拉一次成员与时间线（页面的刷新按钮会重读）。
 *
 * @module @veren/im-ui/client/rooms-source
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImConvApi, RoomsSnapshot } from './remote.ts'

/** How long the open tab waits between room-list re-reads, in milliseconds. */
/** 打开的页面两次房间列表重读之间的等待时长（毫秒）。 */
const ROOMS_POLL_MS = 5_000

/** Mutable state shared by the rooms source's closures. */
/** rooms source 各闭包共享的可变状态。 */
interface RoomsState {
  snapshot: RoomsSnapshot
  timer: ReturnType<typeof globalThis.setInterval> | undefined
  listeners: Set<() => void>
}

/** Merge one partial rooms snapshot and notify every listener. */
/** 合并一份部分 rooms 快照并通知所有监听者。 */
function publish(state: RoomsState, next: Partial<RoomsSnapshot>): void {
  state.snapshot = { ...state.snapshot, ...next }
  for (const listener of [...state.listeners]) listener()
}

/** One room-list read; failures surface as the snapshot's error line. */
/** 一次房间列表读取；失败进入快照的错误行。 */
async function readRooms(api: ImConvApi, state: RoomsState): Promise<void> {
  const result = await api.rooms()
  if (!result.ok) {
    publish(state, { status: 'error', error: result.error.message })
    return
  }
  publish(state, { rooms: result.value.rooms, status: 'ready', error: '' })
}

/** Fetch the open room's members and full timeline (v1: full read per open). */
/** 拉取打开房间的成员与完整时间线（v1：每次打开全量读）。 */
async function readRoom(api: ImConvApi, state: RoomsState, roomId: string): Promise<void> {
  const [members, messages] = await Promise.all([
    api.roomMembers({ roomId }),
    api.messages({ roomId, limit: 200 }),
  ])
  publish(state, {
    ...(members.ok ? { members: members.value.members } : {}),
    ...(messages.ok ? { messages: messages.value.messages } : { error: messages.ok ? '' : messages.value.error.message }),
  })
}

/** One listener left: stop the poll timer for the last one. */
/** 一个监听者离开：最后一个离开时停止轮询。 */
function unsubscribe(state: RoomsState, listener: () => void): void {
  state.listeners.delete(listener)
  if (state.listeners.size !== 0) return
  if (state.timer !== undefined) globalThis.clearInterval(state.timer)
  state.timer = undefined
}

/** First listener starts the room polling; the unsubscribe path cleans up. */
/** 第一个监听者启动房间轮询；取消订阅路径负责清理。 */
function subscribe(api: ImConvApi, state: RoomsState, listener: () => void): () => void {
  state.listeners.add(listener)
  if (state.listeners.size === 1) {
    void readRooms(api, state)
    // 列表与打开中的时间线一起轮询：智能体的回复是别人写进来的新事实，只刷列表不刷时间线
    // 会让页面看起来「没人回」。
    // Poll the room list and the open timeline together: an agent's reply is a
    // fact someone else wrote, and refreshing only the list makes the page look
    // like nobody answered.
    state.timer = globalThis.setInterval(() => {
      void readRooms(api, state)
      const open = state.snapshot.openRoomId
      if (open !== undefined) void readRoom(api, state, open)
    }, ROOMS_POLL_MS)
  }
  return () => { unsubscribe(state, listener) }
}

/** Open one room: clear the pane, fetch the timeline, advance the cursor. */
/** 打开一个房间：清空面板、拉取时间线、推进游标。 */
function openRoomOf(api: ImConvApi, state: RoomsState, viewerId: string, roomId: string | undefined): void {
  publish(state, { openRoomId: roomId, messages: [], members: [] })
  if (roomId === undefined) return
  void readRoom(api, state, roomId)
  // 打开即推进该查看者的已读游标（查看者固定为工作区所有者）。
  // Opening advances the viewer's read cursor (the viewer is the workspace
  // owner in v1).
  const newest = state.snapshot.messages[state.snapshot.messages.length - 1]
  if (newest !== undefined) {
    void api.markRead({ roomId, participantId: viewerId, sequence: newest.sequence })
  }
}

/**
 * One owner write into the open room; the timeline re-reads on success.
 * Resolves whether the write committed, so the composer can keep a failed
 * draft in the input (design §26.3).
 * 向打开中的房间写一条所有者消息；成功后重读时间线。返回是否写入成功，供输入区在失败时
 * 保留草稿（设计 §26.3）。
 */
async function sendMessage(api: ImConvApi, state: RoomsState, body: string): Promise<boolean> {
  const roomId = state.snapshot.openRoomId
  if (roomId === undefined || state.snapshot.sending) return false
  publish(state, { sending: true, error: '' })
  // 幂等键每次提交一枚：失败重试是同一条消息，重复点击不会写两条。
  // One idempotency key per submit: a retry is the same message, and a double
  // click never writes twice.
  const result = await api.post({ roomId, body, clientId: globalThis.crypto.randomUUID() })
  if (!result.ok) {
    publish(state, { sending: false, status: 'error', error: result.error.message })
    return false
  }
  publish(state, { sending: false })
  await readRoom(api, state, roomId)
  return true
}

/** Create one internal room, refresh the list, and open it. */
/** 创建一个内部房间，刷新列表并打开它。 */
async function createRoom(api: ImConvApi, state: RoomsState, viewerId: string, title: string | undefined): Promise<void> {
  const result = await api.createRoom({
    kind: 'direct',
    ...(title === undefined ? {} : { title }),
    memberIds: [viewerId, 'agent:default'],
  })
  if (!result.ok) {
    publish(state, { status: 'error', error: result.error.message })
    return
  }
  await readRooms(api, state)
  openRoomOf(api, state, viewerId, result.value.room.id)
}

/** Build the conversations tab's observable and its callbacks. */
/** 构建会话页的可观察对象与回调。 */
export function createRoomsSource(api: ImConvApi, viewerId: string): {
  readonly source: HostObservable<RoomsSnapshot>
  readonly openRoom: (roomId: string | undefined) => void
  readonly refresh: () => void
  readonly send: (body: string) => Promise<boolean>
  readonly createRoom: (title: string | undefined) => void
} {
  const state: RoomsState = {
    snapshot: {
      rooms: [], openRoomId: undefined, messages: [], members: [],
      status: 'loading', error: '', sending: false,
    },
    timer: undefined,
    listeners: new Set(),
  }
  return {
    source: {
      getSnapshot: () => state.snapshot,
      subscribe: listener => subscribe(api, state, listener),
    },
    openRoom: roomId => { openRoomOf(api, state, viewerId, roomId) },
    refresh: () => {
      void readRooms(api, state)
      const open = state.snapshot.openRoomId
      if (open !== undefined) void readRoom(api, state, open)
    },
    send: body => sendMessage(api, state, body),
    createRoom: title => { void createRoom(api, state, viewerId, title) },
  }
}
