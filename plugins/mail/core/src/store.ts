/**
 * The durable store: typed accessors over the mail storage domain's tables.
 *
 * The store reads through a narrow domain handle rather than the concrete
 * `Domain` class. That is what lets a test drive the real logic against an
 * in-memory double: the handle is the seam, and the real domain satisfies it
 * unchanged.
 *
 * Each accessor names its table by literal, so the record type comes from the
 * domain's own declaration rather than a hand-written mirror.
 *
 * 持久化存储：邮件存储域各表的类型化访问器。
 *
 * 存储通过一个窄的域句柄读取，而非具体的 `Domain` 类。这正是测试能用内存替身驱动真实逻辑的
 * 原因：句柄是接缝，真实域原样满足它。
 *
 * 每个访问器都以字面量指名其表，因此记录类型来自域自身的声明，而不是手写的镜像。
 *
 * @module @veren/mail/store
 */

import type { Context } from '@deepseek-ai/cordis'
import { DomainError, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { mailError } from './errors.ts'
import {
  CONVERSATION_EVENTS_TABLE,
  CONVERSATIONS_TABLE,
  FACTS_TABLE,
  INTEGRATIONS_TABLE,
  JOBS_TABLE,
  MAIL_DOMAIN_NAME,
  MESSAGES_TABLE,
  PREFERENCES_TABLE,
  RUNS_TABLE,
  SUBSCRIBERS_TABLE,
  SUBSCRIPTIONS_TABLE,
  TOPICS_TABLE,
  WORKFLOWS_TABLE,
  mailDomain,
} from './store-schema.ts'
import {
  conversationEventKey,
  conversationKey,
  encodeKeySegment,
  factKey,
  jobKey,
  messageKey,
  runKey,
  subscriberKey,
  subscriptionKey,
  topicKeyOf,
  workflowKey,
} from './store-keys.ts'
import type {
  ConversationEventRecord,
  ConversationRecord,
  FactRecord,
  IntegrationRecord,
  JobRecord,
  MessageRecord,
  PreferenceRecord,
  RunRecord,
  SubscriberRecord,
  SubscriptionRecord,
  TopicRecord,
  WorkflowRecord,
} from './types.ts'

/**
 * The typed table handle this store consumes. The real domain's table
 * satisfies it as-is; a `Map`-backed double satisfies it too, which is what
 * lets the domain's logic be tested without a medium.
 *
 * 本存储实际消费的表句柄。真实域的表原样满足它；由 `Map` 支撑的替身同样满足，
 * 因此域逻辑无需介质即可测试。
 */
export interface TableHandle<T> {
  /** Read one record. / 读取一条记录。 */
  get(key: string): T | undefined
  /** Iterate every record. / 遍历全部记录。 */
  entries(): IterableIterator<[string, T]>
  /** Write one record. / 写入一条记录。 */
  put(key: string, value: T): Promise<void>
  /** Remove one record; resolves false when it was already absent. / 删除一条记录；原本缺失时返回 false。 */
  delete(key: string): Promise<boolean>
}

/**
 * The domain handle this store reads through, one method per table.
 *
 * The methods are named rather than indexed so each returns its own record
 * type — a generic `table(name)` cannot tie the name to the value type, and
 * an untied value type is an `unknown` in disguise.
 *
 * 本存储读取所经的域句柄，每张表一个方法。
 *
 * 方法以命名而非下标区分，因此每个都返回自己的记录类型——泛型的 `table(name)` 无法把表名与
 * 值类型绑定，而未绑定的值类型就是换了脸的 `unknown`。
 */
export interface MailDomainHandle {
  /** The workflow definitions. / 工作流定义。 */
  workflows(): TableHandle<WorkflowRecord>
  /** The recipient profiles. / 收件人档案。 */
  subscribers(): TableHandle<SubscriberRecord>
  /** The subscription groups. / 订阅分组。 */
  topics(): TableHandle<TopicRecord>
  /** The subscription relationships. / 订阅关系。 */
  subscriptions(): TableHandle<SubscriptionRecord>
  /** The preference layers. / 偏好层。 */
  preferences(): TableHandle<PreferenceRecord>
  /** The channel integrations. / 渠道集成。 */
  integrations(): TableHandle<IntegrationRecord>
  /** The execution chains. / 执行链。 */
  runs(): TableHandle<RunRecord>
  /** The step instances. / 步骤实例。 */
  jobs(): TableHandle<JobRecord>
  /** The delivered messages. / 已投递消息。 */
  messages(): TableHandle<MessageRecord>
  /** The conversations. / 会话。 */
  conversations(): TableHandle<ConversationRecord>
  /** The conversation messages. / 会话消息。 */
  conversationEvents(): TableHandle<ConversationEventRecord>
  /** The execution facts. / 执行事实。 */
  facts(): TableHandle<FactRecord>
}

/** The concrete domain this store opens. / 本存储打开的具体域。 */
export type MailDomain = Domain<typeof mailDomain>

/**
 * Adapt the concrete domain to the narrow handle. Each table is named by
 * literal, so the domain's own declaration supplies the record type.
 *
 * 把具体域适配为窄句柄。每张表都以字面量指名，因此记录类型由域自身的声明提供。
 *
 * @param domain - the opened domain / 已打开的域
 * @returns the handle / 句柄
 */
export function handleOf(domain: MailDomain): MailDomainHandle {
  return {
    workflows: () => domain.table(WORKFLOWS_TABLE),
    subscribers: () => domain.table(SUBSCRIBERS_TABLE),
    topics: () => domain.table(TOPICS_TABLE),
    subscriptions: () => domain.table(SUBSCRIPTIONS_TABLE),
    preferences: () => domain.table(PREFERENCES_TABLE),
    integrations: () => domain.table(INTEGRATIONS_TABLE),
    runs: () => domain.table(RUNS_TABLE),
    jobs: () => domain.table(JOBS_TABLE),
    messages: () => domain.table(MESSAGES_TABLE),
    conversations: () => domain.table(CONVERSATIONS_TABLE),
    conversationEvents: () => domain.table(CONVERSATION_EVENTS_TABLE),
    facts: () => domain.table(FACTS_TABLE),
  }
}

/**
 * The durable store over the mail storage domain.
 */
export class MailStore {
  private domain: MailDomainHandle | undefined

  /**
   * @param domain - an already-opened domain handle, for a test / 已打开的域句柄（供测试使用）
   */
  constructor(domain?: MailDomainHandle) {
    this.domain = domain
  }

  /**
   * Open the domain, closing a handle a previous activation left behind.
   * @param ctx - context carrying `storageDomain` / 携带 `storageDomain` 的上下文
   */
  async open(ctx: Context): Promise<void> {
    const stale = ctx.storageDomain.get(MAIL_DOMAIN_NAME)
    if (stale !== undefined) {
      try {
        await stale.close()
        ctx.logger.warn('mail: closed the storage domain left open by a previous activation')
      } catch (error: unknown) {
        ctx.logger.warn(`mail: the previous storage domain could not close: ${String(error)}`)
      }
    }
    this.domain = handleOf(await this.openDomain(ctx))
  }

  /**
   * Open the declared domain, translating a medium failure into a structured
   * error rather than letting a raw `DomainError` escape.
   * @param ctx - context carrying `storageDomain` / 携带 `storageDomain` 的上下文
   * @returns the opened domain / 已打开的域
   */
  private async openDomain(ctx: Context): Promise<MailDomain> {
    try {
      return await ctx.storageDomain.open(mailDomain)
    } catch (error: unknown) {
      const code = error instanceof DomainError ? error.code : 'unknown'
      const detail = error instanceof Error ? error.message : String(error)
      throw mailError(
        'MAIL_INTERNAL',
        `mail: opening the '${MAIL_DOMAIN_NAME}' storage domain failed (${code}): ${detail}`,
      )
    }
  }

  /** Close the domain; safe to call twice. / 关闭域；可安全调用两次。 */
  async close(): Promise<void> {
    this.domain = undefined
  }

  /** Read one workflow definition. / 读取一条工作流定义。 */
  getWorkflow(workflowId: string): WorkflowRecord | undefined {
    return this.require().workflows().get(workflowKey(workflowId))
  }

  /** Every workflow definition. / 全部工作流定义。 */
  workflows(): WorkflowRecord[] {
    return rows(this.require().workflows().entries())
  }

  /** Write one workflow definition. / 写入一条工作流定义。 */
  async putWorkflow(record: WorkflowRecord): Promise<void> {
    await this.require().workflows().put(workflowKey(record.workflowId), record)
  }

  /** Read one recipient profile. / 读取一个收件人档案。 */
  getSubscriber(subscriberId: string): SubscriberRecord | undefined {
    return this.require().subscribers().get(subscriberKey(subscriberId))
  }

  /** Every recipient profile. / 全部收件人档案。 */
  subscribers(): SubscriberRecord[] {
    return rows(this.require().subscribers().entries())
  }

  /** Write one recipient profile. / 写入一个收件人档案。 */
  async putSubscriber(record: SubscriberRecord): Promise<void> {
    await this.require().subscribers().put(subscriberKey(record.subscriberId), record)
  }

  /** Read one group. / 读取一个分组。 */
  getTopic(topicKey: string): TopicRecord | undefined {
    return this.require().topics().get(topicKeyOf(topicKey))
  }

  /** Every group. / 全部分组。 */
  topics(): TopicRecord[] {
    return rows(this.require().topics().entries())
  }

  /** Write one group. / 写入一个分组。 */
  async putTopic(record: TopicRecord): Promise<void> {
    await this.require().topics().put(topicKeyOf(record.topicKey), record)
  }

  /** Read one subscription relationship. / 读取一条订阅关系。 */
  getSubscription(topicKey: string, subscriberId: string): SubscriptionRecord | undefined {
    return this.require().subscriptions().get(subscriptionKey(topicKey, subscriberId))
  }

  /** Every subscription relationship. / 全部订阅关系。 */
  subscriptions(): SubscriptionRecord[] {
    return rows(this.require().subscriptions().entries())
  }

  /** Write one subscription relationship. / 写入一条订阅关系。 */
  async putSubscription(record: SubscriptionRecord): Promise<void> {
    await this.require().subscriptions()
      .put(subscriptionKey(record.topicKey, record.subscriberId), record)
  }

  /** Remove one subscription relationship. / 删除一条订阅关系。 */
  async deleteSubscription(topicKey: string, subscriberId: string): Promise<boolean> {
    return this.require().subscriptions().delete(subscriptionKey(topicKey, subscriberId))
  }

  /** Every stored preference layer. / 全部已存储的偏好层。 */
  preferences(): PreferenceRecord[] {
    return rows(this.require().preferences().entries())
  }

  /** Write one preference layer under the given key. / 按给定键写入一个偏好层。 */
  async putPreference(key: string, record: PreferenceRecord): Promise<void> {
    await this.require().preferences().put(key, record)
  }

  /** Remove one preference layer. / 删除一个偏好层。 */
  async deletePreference(key: string): Promise<boolean> {
    return this.require().preferences().delete(key)
  }

  /** Every channel integration. / 全部渠道集成。 */
  integrations(): IntegrationRecord[] {
    return rows(this.require().integrations().entries())
  }

  /** Write one channel integration. / 写入一个渠道集成。 */
  async putIntegration(record: IntegrationRecord): Promise<void> {
    await this.require().integrations().put(encodeKeySegment(record.integrationId), record)
  }

  /** Read one execution chain. / 读取一条执行链。 */
  getRun(runId: string): RunRecord | undefined {
    return this.require().runs().get(runKey(runId))
  }

  /** Every execution chain. / 全部执行链。 */
  runs(): RunRecord[] {
    return rows(this.require().runs().entries())
  }

  /** Write one execution chain. / 写入一条执行链。 */
  async putRun(record: RunRecord): Promise<void> {
    await this.require().runs().put(runKey(record.runId), record)
  }

  /** Read one step instance. / 读取一条步骤实例。 */
  getJob(jobId: string): JobRecord | undefined {
    return this.require().jobs().get(jobKey(jobId))
  }

  /** Every step instance. / 全部步骤实例。 */
  jobs(): JobRecord[] {
    return rows(this.require().jobs().entries())
  }

  /** Write one step instance. / 写入一条步骤实例。 */
  async putJob(record: JobRecord): Promise<void> {
    await this.require().jobs().put(jobKey(record.jobId), record)
  }

  /** Read one delivered message. / 读取一条已投递消息。 */
  getMessage(messageId: string): MessageRecord | undefined {
    return this.require().messages().get(messageKey(messageId))
  }

  /** Every delivered message. / 全部已投递消息。 */
  messages(): MessageRecord[] {
    return rows(this.require().messages().entries())
  }

  /** Write one delivered message. / 写入一条已投递消息。 */
  async putMessage(record: MessageRecord): Promise<void> {
    await this.require().messages().put(messageKey(record.messageId), record)
  }

  /** Read one conversation. / 读取一条会话。 */
  getConversation(conversationId: string): ConversationRecord | undefined {
    return this.require().conversations().get(conversationKey(conversationId))
  }

  /** Every conversation. / 全部会话。 */
  conversations(): ConversationRecord[] {
    return rows(this.require().conversations().entries())
  }

  /** Write one conversation. / 写入一条会话。 */
  async putConversation(record: ConversationRecord): Promise<void> {
    await this.require().conversations().put(conversationKey(record.conversationId), record)
  }

  /** Every conversation message of one conversation, oldest first. / 某条会话的全部会话消息，按时间升序。 */
  conversationEvents(conversationId: string): ConversationEventRecord[] {
    return rows(this.require().conversationEvents().entries())
      .filter((event) => event.conversationId === conversationId)
      .sort((left, right) => left.occurredAt - right.occurredAt)
  }

  /**
   * The stored message carrying one platform message identifier, wherever it
   * lives. The identifier is unique across conversations — a platform does
   * not reuse it — so this is the dedupe anchor for inbound messages.
   *
   * 携带某平台消息标识的已存储消息，无论它在哪条会话里。该标识在会话之间唯一——平台不会复用
   * 它——因此它是入站消息的去重锚点。
   *
   * @param platformMessageId - the platform's message identifier / 平台消息标识
   * @returns the stored message, when it was handled already / 已处理过的消息
   */
  conversationEventByPlatformMessageId(platformMessageId: string): ConversationEventRecord | undefined {
    return rows(this.require().conversationEvents().entries())
      .find((event) => event.platformMessageId === platformMessageId)
  }

  /** Write one conversation message. / 写入一条会话消息。 */
  async putConversationEvent(record: ConversationEventRecord): Promise<void> {
    await this.require().conversationEvents()
      .put(conversationEventKey(record.conversationId, record.eventId), record)
  }

  /** Every execution fact. / 全部执行事实。 */
  facts(): FactRecord[] {
    return rows(this.require().facts().entries())
  }

  /** Write one execution fact. / 写入一条执行事实。 */
  async putFact(record: FactRecord): Promise<void> {
    await this.require().facts().put(factKey(record.factId), record)
  }

  /** Resolve the open domain or fail loudly. / 解析已打开的域，否则响亮失败。 */
  private require(): MailDomainHandle {
    const domain = this.domain
    if (domain === undefined) {
      throw mailError('MAIL_INTERNAL', 'mail: the storage domain is not open')
    }
    return domain
  }
}

/**
 * Every record of one table, in iteration order.
 *
 * 某张表的全部记录，按迭代顺序。
 *
 * @param entries - the table's entries / 该表的条目
 * @returns the records / 记录
 */
function rows<T>(entries: IterableIterator<[string, T]>): T[] {
  return [...entries].map(([, row]) => row)
}
