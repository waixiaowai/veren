/**
 * Inbound routing segment: per-conversation serialization, binding resolution,
 * the Session hand-off, and the reply back to the source conversation — plus
 * the people-directory hygiene the inbound path and account removal share.
 *
 * Directory bookkeeping must never drop a message: a storage failure is
 * logged, then routing proceeds. Replies only go back when the Session
 * answered.
 *
 * 入站路由段：按会话串行、绑定解析、Session 交接，以及把回答发回来源会话——同时附带入站路径
 * 与账号删除共用的目录清理动作。
 *
 * 目录记账绝不能丢消息：存储失败只记日志，路由继续。只有 Session 真的回了话才回发。
 *
 * @module @veren/im/router-inbound
 */

import type { ImBinding, ImMessage, ImRegistry } from './contract.ts'
import { ImBindings } from './bindings.ts'
import { errorMessage } from './runtime-seams.ts'
import type { ImLogger, ImSessionGateway } from './runtime-seams.ts'
import type { ImStrangerIntake } from './intake.ts'
import type { ImPeople } from './people.ts'
import type { ImPersonView } from './people-types.ts'
import { renderPrompt } from './router-prompt.ts'
import type { ImRouterConfig } from './router-types.ts'

/**
 * The inbound half of the router: it owns the per-conversation chains and runs
 * observe → intake → route for every message, in order, per conversation.
 * 路由的入站半区：拥有按会话串行链，对每条消息依序执行 观察 → 采集 → 路由，同一会话内有序。
 */
export class RouterInbound {
  private readonly bindings: ImBindings
  private readonly gateway: ImSessionGateway
  private readonly registry: ImRegistry
  private readonly people: ImPeople
  private readonly intake: ImStrangerIntake
  private readonly logger: ImLogger
  private readonly config: ImRouterConfig
  private readonly conversationChains = new Map<string, Promise<unknown>>()

  constructor(deps: {
    bindings: ImBindings
    gateway: ImSessionGateway
    registry: ImRegistry
    people: ImPeople
    intake: ImStrangerIntake
    logger: ImLogger
    config: ImRouterConfig
  }) {
    this.bindings = deps.bindings
    this.gateway = deps.gateway
    this.registry = deps.registry
    this.people = deps.people
    this.intake = deps.intake
    this.logger = deps.logger
    this.config = deps.config
  }

  /**
   * Route one inbound message. Messages from one conversation run in order.
   * @param providerId - provider that emitted the message.
   * @param message - normalized inbound message.
   */
  handle(providerId: string, message: ImMessage): Promise<void> {
    const key = `${providerId}\u0000${message.accountId}\u0000${message.conversationId}`
    return this.serialize(key, async () => {
      // Directory bookkeeping must never drop a message: a storage failure is
      // reported, then routing proceeds.
      // 目录记账绝不能丢消息：存储失败只记日志，路由继续。
      let person: ImPersonView | undefined
      try {
        person = await this.people.observeMessage(providerId, message)
      } catch (error: unknown) {
        this.logger.error(
          `[im:${providerId}] inbound sender could not be recorded in the people directory: ${errorMessage(error)}`,
        )
      }
      // Intake runs before routing and owns its own failure containment: the
      // fixed question is not an agent turn.
      // 采集在路由之前运行，并自行收敛失败：固定询问不是 agent turn。
      await this.intake.handle(providerId, message, person)
      return this.route(providerId, message)
    })
  }

  /** Resolve a binding, auto-create one, ask the Session, and reply to the source. */
  private async route(providerId: string, message: ImMessage): Promise<void> {
    try {
      const binding = await this.bindingFor(providerId, message)
      if (binding === undefined) return
      const answer = await this.gateway.ask({
        sessionId: binding.sessionId,
        prompt: renderPrompt(providerId, message, knownSenderName(this.people, this.logger, providerId, message)),
        source: {
          providerId,
          accountId: message.accountId,
          conversationId: message.conversationId,
          messageId: message.id,
        },
      })
      if (answer === undefined || answer.trim() === '') return
      const provider = this.registry.get(providerId)
      await provider.service.send({
        target: { accountId: message.accountId, conversationId: message.conversationId },
        content: { type: 'text', text: answer },
        replyToMessageId: message.id,
      })
    } catch (error: unknown) {
      this.logger.error(`[im:${providerId}] inbound handling failed: ${errorMessage(error)}`)
    }
  }

  /**
   * The active binding for one inbound conversation, auto-creating one when the
   * router is configured to; `undefined` means the message is ignored.
   * 一条入站消息的 active binding；配置允许时自动创建。返回 undefined 表示消息被忽略。
   */
  private async bindingFor(providerId: string, message: ImMessage): Promise<ImBinding | undefined> {
    const existing = this.bindings.activeBinding(message.accountId, message.conversationId)
    if (existing !== undefined) return existing
    if (!this.config.autoCreateSession) {
      this.logger.warn(
        `[im:${providerId}] no active binding for ${message.accountId}/${message.conversationId}; message ignored`,
      )
      return undefined
    }
    const { sessionId } = await this.gateway.ensureSession({ settings: {} })
    const binding = await this.bindings.createActiveBinding(message.accountId, message.conversationId, sessionId)
    this.logger.info?.(
      `[im:${providerId}] auto-created session ${sessionId} for ${message.accountId}/${message.conversationId}`,
    )
    return binding
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

/**
 * Record one conversation's address under its account's provider.
 * 把一个会话地址登记在其账号的 provider 名下。
 */
export async function observePerson(
  bindings: ImBindings,
  people: ImPeople,
  logger: ImLogger,
  accountId: string,
  conversationId: string,
): Promise<void> {
  const account = bindings.account(accountId)
  if (account === undefined) return
  try {
    await people.observeConversation({
      provider: account.provider,
      accountId,
      conversationId,
    })
  } catch (error: unknown) {
    logger.warn(
      `[im:people] ${accountId}/${conversationId} could not be recorded: ${errorMessage(error)}`,
    )
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
