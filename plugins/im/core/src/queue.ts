/** One conversation's queue state, for the conversations view. */
/** 一个会话的队列状态，供会话视图使用。 */
export interface ImConversationQueueView {
  accountId: string
  conversationId: string
  /** Messages queued or consuming right now. */
  pending: number
  lastStatus?: ImMessageStatus
  lastReceivedAt?: number
  lastExcerpt?: string
}

/**
 * The durable inbound message queue: idempotent enqueue, FIFO consumption per
 * conversation, bounded retries with a dead-letter terminal state, and restart
 * recovery. The semantics are specified in `docs/im-message-queue.cn.md`; when
 * code and spec disagree, the spec changes first.
 *
 * The queue owns durable state only — the consuming itself lives in the
 * router's per-conversation chains, which drive this class row by row.
 *
 * 持久化的入站消息队列：幂等入队、按会话 FIFO 消费、有界重试与死信终态、重启恢复。
 * 语义规格见 `docs/im-message-queue.cn.md`；代码与规格冲突时先改规格。
 *
 * 队列只拥有持久化状态——消费动作在 router 的按会话链里，由它逐行驱动本类。
 *
 * @module @veren/im/queue
 */

import { ImError } from './contract.ts'
import type { ImMessage } from './contract.ts'
import type { ImConversationRow, ImConversationSessionRow, ImMessageRow, ImMessageStatus } from './store-rows.ts'

/** Total consumption attempts before one message lands in the dead letter. */
/** 一条消息进入死信前的总尝试次数。 */
export const MAX_MESSAGE_ATTEMPTS = 3

/** How many recent messages the audit view returns. */
/** 审计视图返回的最近消息条数。 */
export const RECENT_MESSAGE_LIMIT = 50

/** Options of the queue. */
export interface ImQueueOptions {
  store: ImQueueStore
  now?: () => number
}

/**
 * The storage seam the queue needs; the full store satisfies it and tests
 * provide an in-memory implementation.
 * 队列需要的存储接缝；完整存储天然满足，测试提供内存实现。
 */
export interface ImQueueStore {
  getConversation(accountId: string, conversationId: string): ImConversationRow | undefined
  conversations(): ImConversationRow[]
  putConversation(row: ImConversationRow): Promise<void>
  getMessage(provider: string, messageId: string): ImMessageRow | undefined
  messages(): ImMessageRow[]
  putMessage(row: ImMessageRow): Promise<void>
  getConversationSession(conversationId: string): ImConversationSessionRow | undefined
  putConversationSession(row: ImConversationSessionRow): Promise<void>
}

/** The durable inbound queue over one `im` storage domain. */
export class ImMessageQueue {
  private readonly store: ImQueueStore
  private readonly now: () => number

  constructor(options: ImQueueOptions) {
    this.store = options.store
    this.now = options.now ?? Date.now
  }

  /**
   * Enqueue one inbound message. Idempotent: a message id already in the queue
   * (any state) is a no-op that reports `'duplicate'`.
   * 入队一条入站消息。幂等：任何状态下已存在的 message_id 都是报告 `'duplicate'` 的空操作。
   */
  async enqueue(providerId: string, message: ImMessage): Promise<'queued' | 'duplicate'> {
    const text = message.content.type === 'text' || message.content.type === 'markdown'
      ? message.content.text
      : `[${message.content.type}]`
    const existing = this.store.getMessage(providerId, message.id)
    if (existing !== undefined) return 'duplicate'
    const row: ImMessageRow = {
      message_id: message.id,
      provider: providerId,
      account_id: message.accountId,
      conversation_id: message.conversationId,
      sender: message.sender.id,
      text,
      received_at: message.sentAt,
      status: 'queued',
      attempts: 0,
      updated_at: this.now(),
    }
    await this.store.putMessage(row)
    await this.ensureConversation(message.accountId, message.conversationId)
    return 'queued'
  }

  /**
   * Claim the oldest queued message of one conversation and mark it
   * `consuming`; `undefined` means the conversation has no queued work.
   * 认领一个会话中最旧的排队消息并标记为 `consuming`；`undefined` 表示该会话没有排队工作。
   */
  async claimNext(conversationId: string): Promise<ImMessageRow | undefined> {
    const next = this.queuedOf(conversationId)[0]
    if (next === undefined) return undefined
    await this.store.putMessage({ ...next, status: 'consuming', updated_at: this.now() })
    return { ...next, status: 'consuming' }
  }

  /** Terminal success: record the reply excerpt. */
    /** 终态成功：记录回复摘录。 */
  async markReplied(providerId: string, messageId: string, excerpt: string): Promise<void> {
    await this.transition(providerId, messageId, 'replied', row => ({
      ...row,
      reply_excerpt: excerpt.slice(0, 200),
    }))
  }

  /**
   * One failed attempt: back to `queued` for a retry, or `dead` once the
   * attempt budget is spent.
   * 一次失败尝试：回到 `queued` 等待重试；尝试预算用尽则置 `dead`。
   */
  async markFailed(providerId: string, messageId: string): Promise<ImMessageRow> {
    const row = this.require(providerId, messageId)
    const attempts = row.attempts + 1
    const status: ImMessageStatus = attempts >= MAX_MESSAGE_ATTEMPTS ? 'dead' : 'queued'
    const updated: ImMessageRow = { ...row, attempts, status, updated_at: this.now() }
    await this.store.putMessage(updated)
    return updated
  }

  /**
   * Restart recovery: every row caught mid-consumption goes back to `queued`.
   * At-least-once by contract — a reply that left before the crash may repeat.
   * 重启恢复：所有消费中的行回到 `queued`。契约即至少一次——崩溃前已发出的回复可能重复。
   */
  async recoverStuck(): Promise<number> {
    let recovered = 0
    for (const row of this.store.messages()) {
      if (row.status !== 'consuming') continue
      await this.store.putMessage({ ...row, status: 'queued', updated_at: this.now() })
      recovered += 1
    }
    return recovered
  }

  /** How many messages of one conversation are queued or consuming. */
  /** 一个会话正在排队或消费中的消息数。 */
  pendingCount(conversationId: string): number {
    return this.store.messages()
      .filter(row => row.conversation_id === conversationId && (row.status === 'queued' || row.status === 'consuming'))
      .length
  }

  /** The most recent messages, newest first, for the audit view. */
  /** 最近的消息（新者在前），供审计视图。 */
  recent(limit = RECENT_MESSAGE_LIMIT): ImMessageRow[] {
    return [...this.store.messages()]
      .sort((left, right) => right.received_at - left.received_at)
      .slice(0, Math.max(1, Math.min(RECENT_MESSAGE_LIMIT, limit)))
  }

  /**
   * One summary row per known conversation: queue depth plus the newest
   * message's outcome. Conversations without any message (history rows) show
   * zero pending and no last state.
   * 每个已知会话一行摘要：队列深度与最新消息的结局。没有消息的会话（历史行）显示零排队、
   * 无最新状态。
   */
  conversationSummaries(): ImConversationQueueView[] {
    const byConversation = new Map<string, ImConversationQueueView>()
    for (const row of this.store.conversations()) {
      byConversation.set(row.conversation_id, {
        accountId: row.account_id,
        conversationId: row.conversation_id,
        pending: 0,
      })
    }
    for (const row of this.store.messages()) {
      const view = byConversation.get(row.conversation_id) ?? {
        accountId: row.account_id,
        conversationId: row.conversation_id,
        pending: 0,
      }
      if (row.status === 'queued' || row.status === 'consuming') view.pending += 1
      if (view.lastReceivedAt === undefined || row.received_at > view.lastReceivedAt) {
        view.lastStatus = row.status
        view.lastReceivedAt = row.received_at
        view.lastExcerpt = row.reply_excerpt
      }
      byConversation.set(row.conversation_id, view)
    }
    return [...byConversation.values()].sort((left, right) =>
      (right.lastReceivedAt ?? 0) - (left.lastReceivedAt ?? 0))
  }

  /** Move in-flight rows of one account onto its replacement during retirement. */
  /** 账号退役时，把其在途行改挂到接替账号。 */
  async migrateAccount(oldId: string, newId: string): Promise<void> {
    for (const row of this.store.messages().filter(entry => entry.account_id === oldId)) {
      await this.store.putMessage({ ...row, account_id: newId })
    }
  }

  /** The private session of one conversation, when it exists. */
  /** 一个会话的私有 Session（若已创建）。 */
  sessionOf(conversationId: string): string | undefined {
    return this.store.getConversationSession(conversationId)?.session_id
  }

  /** Remember the private session of one conversation. */
  /** 记住一个会话的私有 Session。 */
  async rememberSession(conversationId: string, sessionId: string): Promise<void> {
    await this.store.putConversationSession({
      conversation_id: conversationId,
      session_id: sessionId,
      updated_at: this.now(),
    })
  }

  /** Apply one transition through the read-modify-write the row requires. */
  /** 按行所需的读-改-写执行一次状态转移。 */
  private async transition(
    providerId: string,
    messageId: string,
    status: ImMessageStatus,
    patch: (row: ImMessageRow) => ImMessageRow,
  ): Promise<void> {
    const row = this.require(providerId, messageId)
    await this.store.putMessage({ ...patch(row), status, updated_at: this.now() })
  }

  /** Queued rows of one conversation, oldest first. */
  /** 一个会话的排队行，最旧在前。 */
  private queuedOf(conversationId: string): ImMessageRow[] {
    return this.store.messages()
      .filter(row => row.conversation_id === conversationId && row.status === 'queued')
      .sort((left, right) => left.received_at - right.received_at)
  }

  /** Resolve one row or fail loudly; a missing queue row is an internal fault. */
  /** 解析一行或大声失败；队列行缺失是内部故障。 */
  private require(providerId: string, messageId: string): ImMessageRow {
    const row = this.store.getMessage(providerId, messageId)
    if (row === undefined) {
      throw new ImError('IM_INTERNAL', `queue row disappeared: ${providerId}/${messageId}`)
    }
    return row
  }

  /** Create the conversation row on a conversation's first message ever. */
  /** 会话的第一条消息到达时创建会话行。 */
  private async ensureConversation(accountId: string, conversationId: string): Promise<void> {
    if (this.store.getConversation(accountId, conversationId) !== undefined) return
    await this.store.putConversation({
      account_id: accountId,
      conversation_id: conversationId,
      kind: 'direct',
    })
  }
}
