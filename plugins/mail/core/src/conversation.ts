/**
 * The conversation layer: one thread model across channels.
 *
 * Two rules carry it:
 *
 * - **Dedupe before dispatch.** A platform re-delivers its messages as a
 *   matter of course, so an inbound message is looked up by the platform's
 *   own message identifier before anything happens to it. The same identifier
 *   with different content is a conflict rather than a duplicate — the two
 *   cannot both be right, and silently keeping one hides a platform bug.
 * - **The conversation is the transaction boundary.** A reply is refused
 *   against a resolved conversation; reopening is an explicit act, not a
 *   side effect of sending. A closed thread that quietly reopens because
 *   somebody replied to it is a thread that never really closed.
 *
 * 会话层：跨渠道的统一线程模型。
 *
 * 两条规则承载本模块：
 *
 * - **先去重再分发。** 平台重投消息是家常便饭，因此入站消息在受任何处理之前，先按平台自身的
 *   消息标识查找。标识相同而内容不同是冲突而非重复——二者不可能都对，静默保留其一会掩盖平台缺陷。
 * - **会话即事务边界。** 对已解决的会话回复会被拒绝；重开是显式动作，而非发送的副作用。
 *   因有人回复而悄然重开的会话，是个从未真正关闭过的会话。
 *
 * @module @veren/mail/conversation
 */

import { mailError } from './errors.ts'
import type { MailStore } from './store.ts'
import type {
  ChannelKind,
  ConversationEventRecord,
  ConversationRecord,
  ConversationStatus,
  SubscriberId,
} from './types.ts'

/** One inbound message from a channel. / 一条来自渠道的入站消息。 */
export interface InboundMessage {
  /** The channel the message arrived on. / 消息到达的渠道。 */
  readonly channel: ChannelKind
  /** The platform's thread identifier. / 平台线程标识。 */
  readonly threadId: string
  /** The platform's message identifier; the dedupe anchor. / 平台消息标识；去重锚点。 */
  readonly platformMessageId: string
  /** The sender's identifier. / 发送方标识。 */
  readonly from: string
  /** The message body. / 消息正文。 */
  readonly content: string
  /** The platform's own timestamp, used for ordering. / 平台时间戳，用于排序。 */
  readonly occurredAt: number
}

/** What handling an inbound message concluded. / 处理一条入站消息的结论。 */
export interface InboundResult {
  /** The conversation the message belongs to. / 该消息所属的会话。 */
  readonly conversationId: string
  /** The stored message. / 已存储的消息。 */
  readonly eventId: string
  /** Whether this message had already been handled. / 该消息此前是否已处理。 */
  readonly duplicate: boolean
}

/**
 * Find the conversation one thread belongs to, or start one.
 *
 * @param store - the durable store / 持久化存储
 * @param message - the inbound message / 入站消息
 * @param conversationId - the identifier generator / 标识生成器
 * @param now - the current time / 当前时刻
 * @returns the conversation / 会话
 */
export async function findOrCreateConversation(
  store: MailStore,
  message: InboundMessage,
  conversationId: () => string,
  now: number,
): Promise<ConversationRecord> {
  const existing = store.conversations()
    .find((conversation) => conversation.channel === message.channel
      && conversation.threadId === message.threadId)
  if (existing !== undefined) return existing
  const created: ConversationRecord = {
    conversationId: conversationId() as ConversationRecord['conversationId'],
    channel: message.channel,
    threadId: message.threadId,
    subscriberId: message.from as SubscriberId,
    status: 'active',
    messageCount: 0,
    lastActivityAt: now,
    createdAt: now,
  }
  await store.putConversation(created)
  return created
}

/**
 * Handle one inbound message: dedupe it, record it, and leave the thread's
 * counters in step.
 *
 * @param store - the durable store / 持久化存储
 * @param message - the inbound message / 入站消息
 * @param conversationId - the identifier generator / 标识生成器
 * @param eventId - the identifier generator / 标识生成器
 * @param now - the current time / 当前时刻
 * @returns what handling concluded / 处理结论
 */
export async function handleInbound(
  store: MailStore,
  message: InboundMessage,
  conversationId: () => string,
  eventId: () => string,
  now: number,
): Promise<InboundResult> {
  const seen = store.conversationEventByPlatformMessageId(message.platformMessageId)
  const conversation = await findOrCreateConversation(store, message, conversationId, now)
  if (seen !== undefined) {
    if (seen.content !== message.content) {
      throw mailError(
        'MAIL_CONVERSATION_EVENT_DUPLICATE',
        `mail: the message '${message.platformMessageId}' arrived with different content`,
        { platformMessageId: message.platformMessageId },
      )
    }
    return { conversationId: conversation.conversationId, eventId: seen.eventId, duplicate: true }
  }
  const event: ConversationEventRecord = {
    eventId: eventId(),
    conversationId: conversation.conversationId,
    direction: 'inbound',
    platformMessageId: message.platformMessageId,
    content: message.content,
    occurredAt: message.occurredAt,
  }
  await store.putConversationEvent(event)
  await touchConversation(store, conversation, message.content, now)
  return { conversationId: conversation.conversationId, eventId: event.eventId, duplicate: false }
}

/**
 * Record one outbound message in a conversation.
 *
 * @param store - the durable store / 持久化存储
 * @param conversationId - the conversation / 会话
 * @param platformMessageId - the platform's message identifier / 平台消息标识
 * @param content - the message body / 消息正文
 * @param eventId - the identifier generator / 标识生成器
 * @param now - the current time / 当前时刻
 * @returns the stored message / 已存储的消息
 */
export async function recordOutbound(
  store: MailStore,
  conversationId: string,
  platformMessageId: string,
  content: string,
  eventId: () => string,
  now: number,
): Promise<ConversationEventRecord> {
  const conversation = store.getConversation(conversationId)
  if (conversation === undefined) {
    throw mailError('MAIL_CONVERSATION_NOT_FOUND', `mail: the conversation '${conversationId}' does not exist`, {
      conversationId,
    })
  }
  if (conversation.status === 'resolved') {
    throw mailError('MAIL_CONVERSATION_CLOSED', `mail: the conversation '${conversationId}' is resolved`, {
      conversationId,
    })
  }
  const event: ConversationEventRecord = {
    eventId: eventId(),
    conversationId: conversation.conversationId,
    direction: 'outbound',
    platformMessageId,
    content,
    occurredAt: now,
  }
  await store.putConversationEvent(event)
  await touchConversation(store, conversation, content, now)
  return event
}

/**
 * Update a conversation's counters after a message was added.
 *
 * @param store - the durable store / 持久化存储
 * @param conversation - the conversation / 会话
 * @param content - the newest message's body / 最新消息正文
 * @param now - the current time / 当前时刻
 */
async function touchConversation(
  store: MailStore,
  conversation: ConversationRecord,
  content: string,
  now: number,
): Promise<void> {
  await store.putConversation({
    ...conversation,
    messageCount: conversation.messageCount + 1,
    lastMessagePreview: content.slice(0, 120),
    lastActivityAt: now,
  })
}

/**
 * Reopen a resolved conversation. This is an explicit act: a reply to a
 * resolved conversation is refused, and only this reopens it.
 *
 * 重开一条已解决的会话。这是显式动作：对已解决会话的回复会被拒绝，只有此操作能重开它。
 *
 * @param store - the durable store / 持久化存储
 * @param conversationId - the conversation / 会话
 * @param status - the status to set / 要设置的状态
 * @returns the updated conversation / 更新后的会话
 */
export async function setConversationStatus(
  store: MailStore,
  conversationId: string,
  status: ConversationStatus,
): Promise<ConversationRecord> {
  const conversation = store.getConversation(conversationId)
  if (conversation === undefined) {
    throw mailError('MAIL_CONVERSATION_NOT_FOUND', `mail: the conversation '${conversationId}' does not exist`, {
      conversationId,
    })
  }
  const updated: ConversationRecord = { ...conversation, status }
  await store.putConversation(updated)
  return updated
}
