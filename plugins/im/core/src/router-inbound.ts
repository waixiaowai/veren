/**
 * Inbound routing segment: per-conversation serialization over the durable
 * queue — observe → intake → enqueue → drain — plus the people-directory
 * hygiene the inbound path and account removal share.
 *
 * The queue owns durability, so a crash between receive and reply loses
 * nothing: the row is still `queued`/`consuming` and restart recovery re-runs
 * it. Directory bookkeeping never drops a message either — a storage failure
 * is logged, then routing proceeds.
 *
 * 入站路由段：在持久化队列之上的按会话串行——观察 → 采集 → 入队 → 排空——同时附带入站路径
 * 与账号删除共用的目录清理动作。
 *
 * 队列持有持久化，接收与回复之间的崩溃不丢任何东西：行仍在 `queued`/`consuming`，
 * 重启恢复会重跑。目录记账同样绝不丢消息：存储失败只记日志，路由继续。
 *
 * @module @veren/im/router-inbound
 */

import type { ImMessage, ImRegistry } from './contract.ts'
import { errorMessage } from './runtime-seams.ts'
import type { ImLogger, ImSessionGateway } from './runtime-seams.ts'
import type { ImStrangerIntake } from './intake.ts'
import type { ImPeople } from './people.ts'
import type { ImPersonView } from './people-types.ts'
import { ImMessageQueue } from './queue.ts'
import { renderPrompt } from './router-prompt.ts'

/** The queued ack sent when a conversation already has work in flight. */
/** 会话已有在途工作时发送的排队告知。 */
const QUEUE_ACK_TEXT = '已收到，正在处理，你前面还有排队的消息。'

/**
 * The inbound half of the router: it owns the per-conversation chains and runs
 * observe → intake → enqueue → drain for every message, in order, per
 * conversation. The drain consumes the durable queue until the conversation is
 * empty, so a burst of messages is answered strictly in arrival order.
 * 路由的入站半区：拥有按会话串行链，对每条消息依序执行 观察 → 采集 → 入队 → 排空，同一
 * 会话内有序。排空会持续消费持久化队列直到该会话清空，因此消息爆发也按到达顺序回答。
 */
export class RouterInbound {
  private readonly gateway: ImSessionGateway
  private readonly registry: ImRegistry
  private readonly people: ImPeople
  private readonly intake: ImStrangerIntake
  private readonly queue: ImMessageQueue
  private readonly logger: ImLogger
  private readonly conversationChains = new Map<string, Promise<unknown>>()

  constructor(deps: {
    gateway: ImSessionGateway
    registry: ImRegistry
    people: ImPeople
    intake: ImStrangerIntake
    queue: ImMessageQueue
    logger: ImLogger
  }) {
    this.gateway = deps.gateway
    this.registry = deps.registry
    this.people = deps.people
    this.intake = deps.intake
    this.queue = deps.queue
    this.logger = deps.logger
  }

  /**
   * Route one inbound message. The durable enqueue happens before any
   * serialization, so the window between "received" and "durable" is empty —
   * a crash cannot lose a message that was seen. The rest (directory,
   * intake, drain) runs per conversation, in order.
   * 路由一条入站消息。持久化入队发生在一切串行之前，「已接收」到「已入队」之间没有窗口——
   * 崩溃不可能丢掉一条已看见的消息。其余（目录、采集、排空）按会话串行、有序执行。
   * @param providerId - provider that emitted the message.
   * @param message - normalized inbound message.
   */
  async handle(providerId: string, message: ImMessage): Promise<void> {
    const enqueued = await this.queue.enqueue(providerId, message)
    if (enqueued === 'duplicate') return
    const key = `${providerId}\u0000${message.accountId}\u0000${message.conversationId}`
    void this.ackIfBusy(key, providerId, message)
    await this.serialize(key, async () => {
      // Directory bookkeeping must never drop a message: a storage failure is
      // reported, then routing proceeds. When a cloud directory is attached the
      // observation also pushes upstream (fire-and-forget — a hub failure never
      // blocks the inbound path; the local store stays the read cache).
      // 目录记账绝不能丢消息：存储失败只记日志，路由继续。挂了云端目录时观察同时
      // 上报（fire-and-forget——hub 故障绝不阻塞入站路径；本地存储仍是读缓存）。
      let person: ImPersonView | undefined
      try {
        person = await this.people.observeMessage(providerId, message)
      } catch (error: unknown) {
        this.logger.error(
          `[im:${providerId}] inbound sender could not be recorded in the people directory: ${errorMessage(error)}`,
        )
      }
      const remote = this.registry.directoryRemote()
      if (remote !== undefined && person !== undefined) {
        void remote.upsert({
          provider: providerId,
          externalId: message.sender.id,
          displayName: person.displayName,
          ...(person.claimedName === undefined ? {} : { claimedName: person.claimedName }),
          ...(person.identityStatus === undefined ? {} : { identityStatus: person.identityStatus }),
        }).catch((error: unknown) => {
          this.logger.warn(`[im:${providerId}] directory upsert failed: ${errorMessage(error)}`)
        })
      }
      // Intake runs before the drain and owns its own failure containment: the
      // fixed question is not an agent turn.
      // 采集在排空之前运行，并自行收敛失败：固定询问不是 agent turn。
      await this.intake.handle(providerId, message, person)
      await this.drain(providerId, message.accountId, message.conversationId)
    })
  }

  /**
   * Consume the conversation's queue until it is empty: claim one row, run the
   * private session turn, deliver the answer. A failed attempt requeues; the
   * dead-letter state is announced to the user once.
   * 排空一个会话的队列：认领一行、跑私有会话回合、送达回答。失败的尝试重新排队；
   * 进入死信终态时向用户告知一次。
   */
  private async drain(providerId: string, accountId: string, conversationId: string): Promise<void> {
    for (;;) {
      const row = await this.queue.claimNext(conversationId)
      if (row === undefined) return
      try {
        const sessionId = await this.resolveSession(conversationId)
        const answer = await this.gateway.ask({
          sessionId,
          prompt: renderPrompt(providerId, messageOf(row), knownSenderName(this.people, this.logger, providerId, {
            ...messageOf(row),
            accountId,
          })),
          source: { providerId, accountId, conversationId, messageId: row.message_id },
        })
        if (answer !== undefined && answer.trim() !== '') {
          await this.send(providerId, accountId, conversationId, answer, row.message_id)
        }
        await this.queue.markReplied(providerId, row.message_id, (answer ?? '').trim())
      } catch (error: unknown) {
        this.logger.error(`[im:${providerId}] message ${row.message_id} failed: ${errorMessage(error)}`)
        const failed = await this.queue.markFailed(providerId, row.message_id)
        if (failed.status === 'dead') {
          await this.send(
            providerId,
            accountId,
            conversationId,
            '这条消息处理失败了（已自动重试），请稍后再发一次。',
            row.message_id,
          ).catch(() => undefined)
        }
      }
    }
  }

  /**
   * When this conversation's processing chain is already busy (an earlier
   * message of the same conversation has not finished), tell the user their
   * new message is queued instead of letting silence look like vanishing.
   * The chain map is the busy signal: an entry exists exactly while an earlier
   * message of the conversation is still being processed, and the earlier
   * handle inserted it synchronously before any later handle can check.
   * 当该会话的处理链已在忙（同会话前一条消息尚未处理完）时，告知用户新消息已排队，而不是
   * 让沉默看起来像石沉大海。链表就是忙信号：且仅当同会话更早的消息仍在处理时才有条目，
   * 而更早的 handle 一定在任何更晚的 handle 检查之前同步插入了它。
   */
  private async ackIfBusy(key: string, providerId: string, message: ImMessage): Promise<void> {
    if (!this.conversationChains.has(key)) return
    await this.send(providerId, message.accountId, message.conversationId, QUEUE_ACK_TEXT, message.id)
      .catch((error: unknown) => {
        this.logger.warn(`[im:${providerId}] queue ack could not be sent: ${errorMessage(error)}`)
      })
  }

  /**
   * Resolve the conversation's private session: reuse the stored one, or
   * create it once and remember. Resumption after a restart happens inside
   * the gateway.
   * 解析会话的私有 Session：有存者复用；没有则创建一次并记住。重启后的恢复在网关内部发生。
   */
  private async resolveSession(conversationId: string): Promise<string> {
    const known = this.queue.sessionOf(conversationId)
    if (known !== undefined) return known
    const { sessionId } = await this.gateway.ensureSession({ settings: {} })
    await this.queue.rememberSession(conversationId, sessionId)
    this.logger.info?.(`[im:router] private session ${sessionId} created for ${conversationId}`)
    return sessionId
  }

  /** Send one text back over the message's own account path. */
  /** 沿消息自身的账号路径回发一条文本。 */
  private async send(
    providerId: string,
    accountId: string,
    conversationId: string,
    text: string,
    replyToMessageId: string,
  ): Promise<void> {
    const provider = this.registry.get(providerId)
    await provider.service.send({
      target: { accountId, conversationId },
      content: { type: 'text', text },
      replyToMessageId,
    })
  }

  /** Serialize one conversation's inbound processing. */
  private serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.conversationChains.get(key) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tail = next.catch(() => undefined)
    this.conversationChains.set(key, tail)
    return next.finally(() => {
      if (this.conversationChains.get(key) === tail) this.conversationChains.delete(key)
    })
  }
}

/** Rebuild one normalized message from its queue row (text-only by contract). */
/** 从队列行重建一条归一化消息（契约上仅文本）。 */
function messageOf(row: { message_id: string; conversation_id: string; sender: string; text: string; received_at: number }): ImMessage {
  return {
    id: row.message_id,
    accountId: '',
    conversationId: row.conversation_id,
    sender: { id: row.sender },
    sentAt: row.received_at,
    content: { type: 'text', text: row.text },
  }
}

/**
 * Remove one account's addresses; profiles and names stay for a later rebind.
 * 清掉一个账号的全部地址；档案与名字保留，供日后重新绑定。
 */
export async function clearPersonAddresses(people: ImPeople, logger: ImLogger, accountId: string): Promise<void> {
  try {
    await people.removeAddressesOf(accountId)
  } catch (error: unknown) {
    logger.warn(`[im:people] addresses of ${accountId} were not removed: ${errorMessage(error)}`)
  }
}

/**
 * The known sender label, marking a self-reported name as unverified.
 * 已知发送者的显示名；自述名会标注「未核实」。
 */
export function knownSenderName(
  people: ImPeople,
  logger: ImLogger,
  providerId: string,
  message: ImMessage,
): string | undefined {
  try {
    const person = people.viewAt(providerId, message.accountId, message.conversationId)
    if (person === undefined) return undefined
    if (person.identityStatus === 'self-reported' && person.claimedName !== undefined
      && person.displayName === message.sender.id) {
      return `${person.claimedName}（自称）`
    }
    return person.displayName
  } catch (error: unknown) {
    logger.warn(`[im:people] sender lookup failed: ${errorMessage(error)}`)
    return undefined
  }
}
