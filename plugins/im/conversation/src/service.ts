/**
 * The conversation service facade: one object over rooms, posting, and reads.
 * Downstream packages (coordination, turn, tools, the panel's remote) consume
 * this single token; ownership of the tables stays here.
 *
 * 会话服务门面：房间、写入与已读之上的一个对象。下游各包（协调、回合、工具、面板远端）
 * 只消费这一个令牌；表的所有权留在这里。
 *
 * @module @veren/im-conversation/service
 */

import { defineToken } from '@veren/core'
import type { ListInput, Message, PostGate, PostInput, PostResult, ReadCursor, Room, RoomMember } from './types.ts'
import type { PostService } from './post.ts'
import type { RoomService } from './rooms.ts'
import type { ReadService } from './reads.ts'

/** The facade the rest of the family programs against. */
/** 家族其余部分面向编程的门面。 */
export interface ConversationService {
  /** Ensure a channel-backed room and seat its members. */
  /** 确保一个渠道背书的房间并安排成员座位。 */
  ensureChannelRoom(input: {
    readonly roomId: string
    readonly title?: string
    readonly memberIds: readonly string[]
  }): Promise<Room>
  /** Create an internal room (group or direct). */
  /** 创建一个内部房间（群或私聊）。 */
  createRoom(input: {
    readonly roomId?: string
    readonly kind: 'direct' | 'group'
    readonly title?: string
    readonly memberIds: readonly string[]
  }): Promise<Room>
  /** Seat more members in one group room (idempotent per member). */
  /** 为一个群聊房间追加成员（按成员幂等）。 */
  addMembers(input: {
    readonly roomId: string
    readonly actorId: string
    readonly memberIds: readonly string[]
  }): Promise<Room>
  /** Read one room. */
  /** 读取一个房间。 */
  room(roomId: string): Room | undefined
  /** Every room. */
  /** 全部房间。 */
  rooms(): Room[]
  /** One room's memberships in roster order. */
  /** 一个房间的成员关系，按名册顺序。 */
  memberships(roomId: string): RoomMember[]
  /**
   * Post one message (idempotent by client id when given), optionally behind
   * a write gate that runs inside the room's write chain.
   * 写入一条消息（提供 client id 时幂等），可置于房间写链内运行的写入闸门之后。
   */
  post(input: PostInput, gate?: PostGate): Promise<PostResult>
  /** Read one message by id. */
  /** 按 id 读取一条消息。 */
  message(messageId: string): Message | undefined
  /** Incremental fetch of one room's messages. */
  /** 一个房间消息的增量拉取。 */
  list(input: ListInput): Message[]
  /** The newest non-self message of one room (verbatim-gate target). */
  /** 一个房间最新的非自身消息（逐字闸门比对对象）。 */
  lastPeerMessage(roomId: string, selfId: string): Message | undefined
  /** Advance one participant's read cursor (monotonic). */
  /** 推进一个参与者的已读游标（单调）。 */
  markRead(roomId: string, participantId: string, sequence: number): Promise<ReadCursor>
  /** One participant's cursor position in one room. */
  /** 一个参与者在一个房间的游标位置。 */
  readSequence(roomId: string, participantId: string): number
  /** Unread count for one participant in one room. */
  /** 一个参与者在一个房间的未读数。 */
  unread(roomId: string, participantId: string): number
}

/** The concrete facade assembled from the three halves. */
/** 由三个半区组装的具体门面。 */
export class ConversationFacade implements ConversationService {
  private readonly roomHalf: RoomService
  private readonly postHalf: PostService
  private readonly readHalf: ReadService

  /**
   * @param roomHalf - room provisioning and membership.
   * @param postHalf - the write half.
   * @param readHalf - read cursors and unread counts.
   */
  constructor(roomHalf: RoomService, postHalf: PostService, readHalf: ReadService) {
    this.roomHalf = roomHalf
    this.postHalf = postHalf
    this.readHalf = readHalf
  }

  ensureChannelRoom(input: Parameters<RoomService['ensureChannelRoom']>[0]): Promise<Room> {
    return this.roomHalf.ensureChannelRoom(input)
  }

  createRoom(input: Parameters<RoomService['createRoom']>[0]): Promise<Room> {
    return this.roomHalf.createRoom(input)
  }

  addMembers(input: Parameters<RoomService['addMembers']>[0]): Promise<Room> {
    return this.roomHalf.addMembers(input)
  }

  room(roomId: string): Room | undefined {
    return this.roomHalf.room(roomId)
  }

  rooms(): Room[] {
    return this.roomHalf.list()
  }

  memberships(roomId: string): RoomMember[] {
    return this.roomHalf.memberships(roomId)
  }

  post(input: PostInput, gate?: PostGate): Promise<PostResult> {
    return this.postHalf.post(input, gate)
  }

  message(messageId: string): Message | undefined {
    return this.postHalf.message(messageId)
  }

  list(input: ListInput): Message[] {
    return this.postHalf.list(input)
  }

  lastPeerMessage(roomId: string, selfId: string): Message | undefined {
    return this.postHalf.lastPeerMessage(roomId, selfId)
  }

  markRead(roomId: string, participantId: string, sequence: number): Promise<ReadCursor> {
    return this.readHalf.markRead(roomId, participantId, sequence)
  }

  readSequence(roomId: string, participantId: string): number {
    return this.readHalf.readOf(roomId, participantId)
  }

  unread(roomId: string, participantId: string): number {
    return this.readHalf.unread(roomId, participantId)
  }
}

/** The conversation service token. */
/** 会话服务令牌。 */
export const ConversationToken = defineToken<ConversationService>('imConversation')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The conversation service provided by @veren/im-conversation. */
    /** 由 @veren/im-conversation 提供的会话服务。 */
    imConversation: ConversationService
  }
}
