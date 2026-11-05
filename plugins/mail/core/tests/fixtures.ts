/**
 * The test fixtures: an in-memory store the domain logic runs against.
 *
 * The store is the only thing the domain's logic touches, so a `Map`-backed
 * double exercises the real code paths without a medium. The double keeps the
 * key encoding honest: a key that the backend would reject never reaches it.
 *
 * 测试夹具：域逻辑所运行的内存存储。
 *
 * 存储是域逻辑唯一触碰的东西，因此由 `Map` 支撑的替身可以在没有介质的情况下走真实代码路径。
 * 该替身让键编码保持诚实：后端会拒绝的键永远到不了它那里。
 *
 * @module @veren/mail/tests/fixtures
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { MailStore, type MailDomainHandle } from '../src/store.ts'
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
} from '../src/types.ts'

/** One table's records, keyed by their storage key. / 一张表的记录，按存储键归集。 */
type Rows = Map<string, unknown>

/** The in-memory domain the fixture store reads. / 夹具存储读取的内存域。 */
export interface FakeDomain {
  /** The workflow definitions. / 工作流定义。 */
  readonly workflows: Rows
  /** The recipient profiles. / 收件人档案。 */
  readonly subscribers: Rows
  /** The subscription groups. / 订阅分组。 */
  readonly topics: Rows
  /** The subscription relationships. / 订阅关系。 */
  readonly subscriptions: Rows
  /** The preference layers. / 偏好层。 */
  readonly preferences: Rows
  /** The channel integrations. / 渠道集成。 */
  readonly integrations: Rows
  /** The execution chains. / 执行链。 */
  readonly runs: Rows
  /** The step instances. / 步骤实例。 */
  readonly jobs: Rows
  /** The delivered messages. / 已投递消息。 */
  readonly messages: Rows
  /** The conversations. / 会话。 */
  readonly conversations: Rows
  /** The conversation messages. / 会话消息。 */
  readonly conversationEvents: Rows
  /** The execution facts. / 执行事实。 */
  readonly facts: Rows
}

/** Build an empty in-memory domain. / 构造一个空的内存域。 */
export function fakeDomain(): FakeDomain {
  return {
    workflows: new Map(),
    subscribers: new Map(),
    topics: new Map(),
    subscriptions: new Map(),
    preferences: new Map(),
    integrations: new Map(),
    runs: new Map(),
    jobs: new Map(),
    messages: new Map(),
    conversations: new Map(),
    conversationEvents: new Map(),
    facts: new Map(),
  }
}

/**
 * Build the domain handle the fixture store reads through.
 *
 * @param domain - the in-memory domain / 内存域
 * @returns the handle / 句柄
 */
export function fakeHandle(domain: FakeDomain): MailDomainHandle {
  const table = <T>(rows: Rows) => ({
    get: (key: string) => rows.get(key) as T | undefined,
    entries: function* () { yield* rows.entries() as IterableIterator<[string, T]> },
    put: async (key: string, value: T) => { rows.set(key, value) },
    delete: async (key: string) => rows.delete(key),
  })
  return {
    workflows: () => table<WorkflowRecord>(domain.workflows),
    subscribers: () => table<SubscriberRecord>(domain.subscribers),
    topics: () => table<TopicRecord>(domain.topics),
    subscriptions: () => table<SubscriptionRecord>(domain.subscriptions),
    preferences: () => table<PreferenceRecord>(domain.preferences),
    integrations: () => table<IntegrationRecord>(domain.integrations),
    runs: () => table<RunRecord>(domain.runs),
    jobs: () => table<JobRecord>(domain.jobs),
    messages: () => table<MessageRecord>(domain.messages),
    conversations: () => table<ConversationRecord>(domain.conversations),
    conversationEvents: () => table<ConversationEventRecord>(domain.conversationEvents),
    facts: () => table<FactRecord>(domain.facts),
  }
}

/**
 * A store reading one in-memory domain.
 *
 * @param domain - the domain to read / 要读取的域
 * @returns the store / 存储
 */
export function fakeStore(domain: FakeDomain): MailStore {
  return new MailStore(fakeHandle(domain))
}

/** A workflow definition the fixtures write. / 夹具写入的一条工作流定义。 */
export function workflowFixture(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    workflowId: brandString<WorkflowRecord['workflowId']>('wf-1'),
    triggerIdentifier: 'order-paid',
    name: 'Order paid',
    status: 'ACTIVE',
    draft: false,
    steps: [{ stepId: 'notify', type: 'in_app', content: { body: 'Order {{orderId}} paid' } }],
    severity: 'medium',
    critical: false,
    tags: [],
    updatedAt: 1,
    ...overrides,
  }
}

/** A recipient profile the fixtures write. / 夹具写入的一个收件人档案。 */
export function subscriberFixture(overrides: Partial<SubscriberRecord> = {}): SubscriberRecord {
  return {
    subscriberId: brandString<SubscriberRecord['subscriberId']>('user-1'),
    email: 'user@example.com',
    deleted: false,
    updatedAt: 1,
    ...overrides,
  }
}

/** A group the fixtures write. / 夹具写入的一个分组。 */
export function topicFixture(overrides: Partial<TopicRecord> = {}): TopicRecord {
  return {
    topicKey: brandString<TopicRecord['topicKey']>('buyers'),
    name: 'Buyers',
    updatedAt: 1,
    ...overrides,
  }
}

/** A subscription the fixtures write. / 夹具写入的一条订阅。 */
export function subscriptionFixture(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    topicKey: brandString<SubscriptionRecord['topicKey']>('buyers'),
    subscriberId: brandString<SubscriptionRecord['subscriberId']>('user-1'),
    contextKeys: [],
    ...overrides,
  }
}

/** A preference layer the fixtures write. / 夹具写入的一个偏好层。 */
export function preferenceFixture(overrides: Partial<PreferenceRecord> = {}): PreferenceRecord {
  return {
    layer: 'subject_global',
    contextKeys: [],
    enabled: true,
    readOnly: false,
    ...overrides,
  }
}

/** An integration the fixtures write. / 夹具写入的一条集成。 */
export function integrationFixture(overrides: Partial<IntegrationRecord> = {}): IntegrationRecord {
  return {
    integrationId: 'int-1',
    channel: 'email',
    providerId: 'smtp',
    active: true,
    primary: true,
    priority: 0,
    config: {},
    ...overrides,
  }
}

/** An execution chain the fixtures write. / 夹具写入的一条执行链。 */
export function runFixture(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: brandString<RunRecord['runId']>('run-1'),
    transactionId: brandString<RunRecord['transactionId']>('tx-1'),
    workflowId: brandString<RunRecord['workflowId']>('wf-1'),
    recipientCount: 1,
    status: 'pending',
    startedAt: 1,
    ...overrides,
  }
}

/** A step instance the fixtures write. / 夹具写入的一条步骤实例。 */
export function jobFixture(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    jobId: brandString<JobRecord['jobId']>('job-1'),
    runId: brandString<JobRecord['runId']>('run-1'),
    transactionId: brandString<JobRecord['transactionId']>('tx-1'),
    workflowId: brandString<JobRecord['workflowId']>('wf-1'),
    subscriberId: brandString<JobRecord['subscriberId']>('user-1'),
    stepId: 'notify',
    stepType: 'in_app',
    state: 'queued',
    attempts: 0,
    deferredCount: 0,
    payload: {},
    sequence: 0,
    createdAt: 1,
    ...overrides,
  }
}

/** A delivered message the fixtures write. / 夹具写入的一条已投递消息。 */
export function messageFixture(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    messageId: brandString<MessageRecord['messageId']>('msg-1'),
    jobId: brandString<MessageRecord['jobId']>('job-1'),
    runId: brandString<MessageRecord['runId']>('run-1'),
    subscriberId: brandString<MessageRecord['subscriberId']>('user-1'),
    channel: 'in_app',
    content: 'hello',
    providerId: 'in_app',
    status: 'sent',
    seen: false,
    read: false,
    archived: false,
    createdAt: 1,
    ...overrides,
  }
}

/** A conversation the fixtures write. / 夹具写入的一条会话。 */
export function conversationFixture(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    conversationId: brandString<ConversationRecord['conversationId']>('conv-1'),
    channel: 'in_app',
    threadId: 'thread-1',
    subscriberId: brandString<ConversationRecord['subscriberId']>('user-1'),
    status: 'active',
    messageCount: 0,
    lastActivityAt: 1,
    createdAt: 1,
    ...overrides,
  }
}

/** A conversation message the fixtures write. / 夹具写入的一条会话消息。 */
export function conversationEventFixture(
  overrides: Partial<ConversationEventRecord> = {},
): ConversationEventRecord {
  return {
    eventId: 'evt-1',
    conversationId: brandString<ConversationRecord['conversationId']>('conv-1'),
    direction: 'inbound',
    platformMessageId: 'pm-1',
    content: 'hello',
    occurredAt: 1,
    ...overrides,
  }
}

/** An execution fact the fixtures write. / 夹具写入的一条执行事实。 */
export function factFixture(overrides: Partial<FactRecord> = {}): FactRecord {
  return {
    factId: 'fact-1',
    runId: brandString<FactRecord['runId']>('run-1'),
    kind: 'step_finished',
    occurredAt: 1,
    ...overrides,
  }
}
