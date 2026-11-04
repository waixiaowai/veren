/**
 * Conversation-owned family events, emitted after the durable commit (design:
 * 先落库后分发). Consumers — coordination, turn, and the channel adapters'
 * outbound delivery — react to these; they never write conversation tables
 * themselves.
 *
 * 会话域拥有的家族事件，在持久提交之后发出（设计：先落库后分发）。消费方——协调、回合、
 * 渠道适配器的出站投递——对这些事件做出反应；它们绝不直接写会话表。
 *
 * @module @veren/im-conversation/events
 */

import type { Message, Room } from './types.ts'

/** One freshly committed message. */
/** 一条刚刚提交的消息。 */
export interface ImMessageNew {
  readonly room: Room
  readonly message: Message
}

/** One room change: creation, membership, or projection update. */
/** 一次房间变化：创建、成员关系或投影更新。 */
export interface ImRoomUpdated {
  readonly room: Room
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A message was durably posted to a room (pure notification). Emitted once
     * per committed message, including idempotent replays? No — replays emit
     * nothing new: the first commit already announced the fact.
     * 一条消息已持久写入房间（纯通知）。每条已提交的消息发一次；幂等回放不再发——首次
     * 提交已经宣告过这个事实。
     * @mode emit
     */
    'im/message-new': (payload: ImMessageNew) => void
    /**
     * A room was created or its membership projection changed (pure
     * notification, panel refresh fuel).
     * 一个房间被创建或其成员投影发生了变化（纯通知，面板刷新的燃料）。
     * @mode emit
     */
    'im/room-updated': (payload: ImRoomUpdated) => void
  }
}
