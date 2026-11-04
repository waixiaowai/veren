/**
 * Durable row shapes and key helpers of the `im_conversation` storage domain.
 *
 * Messages key on message id (lookups by id are the hot path for idempotent
 * replay); listings filter by room and sort by sequence in memory — at
 * personal-host scale this is the right trade, and it keeps the on-disk shape
 * free of padded numeric keys.
 *
 * `im_conversation` 存储域的持久行形状与键助手。
 *
 * 消息按消息 id 键控（按 id 查找是幂等回放的热路径）；列表按房间过滤、在内存里按序号排序
 * ——个人宿主的规模下这是正确的取舍，磁盘形状也因此不必用补零数字键。
 *
 * @module @veren/im-conversation/rows
 */

import type { Message, MessageKind, ReadCursor, Room, RoomKind, RoomMember } from './types.ts'

/** One `rooms` row; `members` is the listing projection. */
/** 一行 `rooms`；`members` 是列表投影。 */
export interface RoomRow {
  id: string
  kind: RoomKind
  title?: string
  members: string[]
  created_at: number
  updated_at: number
}

/** One `room_members` row. */
/** 一行 `room_members`。 */
export interface RoomMemberRow {
  room_id: string
  participant_id: string
  ordinal: number
  joined_at: number
}

/** One `messages` row. */
/** 一行 `messages`。 */
export interface MessageRow {
  id: string
  room_id: string
  author_id: string
  kind: MessageKind
  body: string
  sequence: number
  client_id?: string
  created_at: number
}

/** One `room_counters` row: one per room, `next_sequence` only grows. */
/** 一行 `room_counters`：一房一行，`next_sequence` 只增不减。 */
export interface CounterRow {
  room_id: string
  next_sequence: number
}

/** One `room_reads` row: monotonic forward-only. */
/** 一行 `room_reads`：只进不退。 */
export interface ReadRow {
  room_id: string
  participant_id: string
  last_read_sequence: number
  updated_at: number
}

/**
 * One `message_client_ids` row: the idempotency index. Same room + author +
 * client id converges to one message id.
 * 一行 `message_client_ids`：幂等索引。同房间+同作者+同 client id 收敛到同一个消息 id。
 */
export interface ClientIdRow {
  room_id: string
  author_id: string
  client_id: string
  message_id: string
  body: string
}

/** Stable key for one membership row. */
/** 一行成员关系的稳定键。 */
export function memberKey(roomId: string, participantId: string): string {
  return `${roomId}\u0000${participantId}`
}

/** Stable key for one read-cursor row. */
/** 一行已读游标的稳定键。 */
export function readKey(roomId: string, participantId: string): string {
  return `${roomId}\u0000${participantId}`
}

/** Stable key for one idempotency-index row. */
/** 一行幂等索引的稳定键。 */
export function clientIdKey(roomId: string, authorId: string, clientId: string): string {
  return `${roomId}\u0000${authorId}\u0000${clientId}`
}

/** Project one room row into its public view. */
/** 把一行房间投影成公开视图。 */
export function roomOf(row: RoomRow): Room {
  return {
    id: row.id,
    kind: row.kind,
    ...(row.title === undefined ? {} : { title: row.title }),
    members: [...row.members],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Project one membership row into its public view. */
/** 把一行成员关系投影成公开视图。 */
export function memberOf(row: RoomMemberRow): RoomMember {
  return {
    roomId: row.room_id,
    participantId: row.participant_id,
    ordinal: row.ordinal,
    joinedAt: row.joined_at,
  }
}

/** Project one message row into its public view. */
/** 把一行消息投影成公开视图。 */
export function messageOf(row: MessageRow): Message {
  return {
    id: row.id,
    roomId: row.room_id,
    authorId: row.author_id,
    kind: row.kind,
    body: row.body,
    sequence: row.sequence,
    ...(row.client_id === undefined ? {} : { clientId: row.client_id }),
    createdAt: row.created_at,
  }
}

/** Project one read-cursor row into its public view. */
/** 把一行已读游标投影成公开视图。 */
export function readOf(row: ReadRow): ReadCursor {
  return {
    roomId: row.room_id,
    participantId: row.participant_id,
    lastReadSequence: row.last_read_sequence,
    updatedAt: row.updated_at,
  }
}
