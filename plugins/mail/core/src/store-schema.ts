/**
 * The durable boundary: the zod schemas every stored record is validated
 * against, and the storage-domain declaration that owns them.
 *
 * Validation happens at the medium, not at the caller, so a record written by
 * an older build cannot enter the domain in a shape the current code would
 * misread. The domain version stays at 1: every field added since is optional
 * and a missing table reads as empty, so a file written before the field
 * existed still opens without discarding records.
 *
 * Each schema is declared as `z.ZodType<Record>`, which makes the record
 * interface the schema's contract rather than a second declaration that could
 * drift from it. The identifiers carry their brand through a transform, so
 * the value that comes back out of the medium is the branded one.
 *
 * 持久化边界：每条存储记录被校验所依据的 zod schema，以及拥有它们的存储域声明。
 *
 * 校验发生在介质层而非调用方，因此旧构建写下的记录无法以当前代码会误读的形状进入域。
 * 域版本保持 1：此后新增的字段都是可选的，缺失的表读作空表，因此字段出现之前写下的文件
 * 仍能打开而不丢记录。
 *
 * 每个 schema 都声明为 `z.ZodType<Record>`，这让记录接口成为 schema 的契约，而不是可能
 * 与之漂移的第二份声明。标识通过 transform 带上品牌，因此从介质取回的值就是带品牌的那一个。
 *
 * @module @veren/mail/store-schema
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  ConversationEventRecord,
  ConversationId,
  ConversationRecord,
  FactRecord,
  IntegrationRecord,
  JobId,
  JobRecord,
  MessageId,
  MessageRecord,
  PreferenceRecord,
  RunId,
  RunRecord,
  SubscriberId,
  SubscriberRecord,
  SubscriptionRecord,
  TopicKey,
  TopicRecord,
  WorkflowId,
  WorkflowRecord,
} from './types.ts'

/** The domain's name; also the backend unit name. / 域名；同时是后端单元名。 */
export const MAIL_DOMAIN_NAME = 'mail'

/** The table holding workflow definitions. / 存放工作流定义的表。 */
export const WORKFLOWS_TABLE = 'workflows'

/** The table holding recipient profiles. / 存放收件人档案的表。 */
export const SUBSCRIBERS_TABLE = 'subscribers'

/** The table holding subscription groups. / 存放订阅分组的表。 */
export const TOPICS_TABLE = 'topics'

/** The table holding subscription relationships. / 存放订阅关系的表。 */
export const SUBSCRIPTIONS_TABLE = 'subscriptions'

/** The table holding preference layers. / 存放偏好层的表。 */
export const PREFERENCES_TABLE = 'preferences'

/** The table holding channel integrations. / 存放渠道集成的表。 */
export const INTEGRATIONS_TABLE = 'integrations'

/** The table holding execution chains. / 存放执行链的表。 */
export const RUNS_TABLE = 'runs'

/** The table holding step instances. / 存放步骤实例的表。 */
export const JOBS_TABLE = 'jobs'

/** The table holding delivered messages. / 存放已投递消息的表。 */
export const MESSAGES_TABLE = 'messages'

/** The table holding conversations. / 存放会话的表。 */
export const CONVERSATIONS_TABLE = 'conversations'

/** The table holding conversation messages. / 存放会话消息的表。 */
export const CONVERSATION_EVENTS_TABLE = 'conversation_events'

/** The table holding execution facts. / 存放执行事实的表。 */
export const FACTS_TABLE = 'facts'

/** A workflow identifier, branded. / 带品牌的工作流标识。 */
const workflowIdSchema = z.string().min(1).transform((value) => brandString<WorkflowId>(value))

/** A recipient identifier, branded. / 带品牌的收件人标识。 */
const subscriberIdSchema = z.string().min(1).transform((value) => brandString<SubscriberId>(value))

/** A group identifier, branded. / 带品牌的分组标识。 */
const topicKeySchema = z.string().min(1).transform((value) => brandString<TopicKey>(value))

/** A transaction identifier, branded. / 带品牌的事务标识。 */
const transactionIdSchema = z.string().min(1).transform((value) => brandString<JobRecord['transactionId']>(value))

/** An execution-chain identifier, branded. / 带品牌的执行链标识。 */
const runIdSchema = z.string().min(1).transform((value) => brandString<RunId>(value))

/** A step identifier, branded. / 带品牌的步骤标识。 */
const jobIdSchema = z.string().min(1).transform((value) => brandString<JobId>(value))

/** A message identifier, branded. / 带品牌的消息标识。 */
const messageIdSchema = z.string().min(1).transform((value) => brandString<MessageId>(value))

/** A conversation identifier, branded. / 带品牌的会话标识。 */
const conversationIdSchema = z.string().min(1).transform((value) => brandString<ConversationId>(value))

/** The channel names one record may carry. / 记录可携带的渠道名。 */
const channelSchema = z.enum(['in_app', 'email', 'sms', 'chat', 'push', 'tool'])

/** One step's stored filter. / 一条已存储的步骤条件。 */
const filterSchema = z.object({
  source: z.enum(['payload', 'subscriber', 'previousStep', 'tenant']),
  field: z.string(),
  operator: z.enum(['equals', 'notEquals', 'contains', 'exists', 'gt', 'lt']),
  value: z.unknown().optional(),
})

/** One workflow's stored shape. / 一条已存储的工作流形状。 */
export const workflowSchema: z.ZodType<WorkflowRecord> = z.object({
  workflowId: workflowIdSchema,
  triggerIdentifier: z.string().min(1),
  name: z.string(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ERROR']),
  draft: z.boolean(),
  steps: z.array(z.object({
    stepId: z.string().min(1),
    type: z.enum([
      'in_app', 'email', 'sms', 'chat', 'push', 'tool',
      'delay', 'throttle', 'digest', 'trigger', 'http_request', 'custom',
    ]),
    filters: z.array(filterSchema).optional(),
    content: z.object({ subject: z.string().optional(), body: z.string() }).optional(),
    control: z.record(z.string(), z.unknown()).optional(),
    shouldStopOnFail: z.boolean().optional(),
  })),
  payloadSchema: z.record(z.string(), z.unknown()).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  critical: z.boolean(),
  tags: z.array(z.string()),
  updatedAt: z.number(),
})

/** One recipient's stored shape. / 一条已存储的收件人形状。 */
export const subscriberSchema: z.ZodType<SubscriberRecord> = z.object({
  subscriberId: subscriberIdSchema,
  email: z.string().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  deleted: z.boolean(),
  updatedAt: z.number(),
})

/** One group's stored shape. / 一条已存储的分组形状。 */
export const topicSchema: z.ZodType<TopicRecord> = z.object({
  topicKey: topicKeySchema,
  name: z.string(),
  updatedAt: z.number(),
})

/** One subscription's stored shape. / 一条已存储的订阅形状。 */
export const subscriptionSchema: z.ZodType<SubscriptionRecord> = z.object({
  topicKey: topicKeySchema,
  subscriberId: subscriberIdSchema,
  contextKeys: z.array(z.string()),
})

/** One preference layer's stored shape. / 一条已存储的偏好层形状。 */
export const preferenceSchema: z.ZodType<PreferenceRecord> = z.object({
  layer: z.enum([
    'workflow_resource', 'user', 'subject_global', 'subject_workflow', 'subscription',
  ]),
  workflowId: workflowIdSchema.optional(),
  subscriberId: subscriberIdSchema.optional(),
  topicKey: topicKeySchema.optional(),
  contextKeys: z.array(z.string()),
  enabled: z.boolean(),
  readOnly: z.boolean(),
  channels: z.record(z.string(), z.boolean()).optional(),
  schedule: z.object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
    enabled: z.boolean(),
  }).optional(),
})

/** One integration's stored shape. / 一条已存储的集成形状。 */
export const integrationSchema: z.ZodType<IntegrationRecord> = z.object({
  integrationId: z.string().min(1),
  channel: channelSchema,
  providerId: z.string().min(1),
  active: z.boolean(),
  primary: z.boolean(),
  priority: z.number(),
  config: z.record(z.string(), z.unknown()),
})

/** One execution chain's stored shape. / 一条已存储的执行链形状。 */
export const runSchema: z.ZodType<RunRecord> = z.object({
  runId: runIdSchema,
  transactionId: transactionIdSchema,
  workflowId: workflowIdSchema,
  recipientCount: z.number().int().nonnegative(),
  status: z.enum([
    'pending', 'sent', 'errored', 'skipped',
    'canceled', 'merged', 'delivered', 'interacted',
  ]),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  sourceSessionId: z.string().optional(),
})

/** One step instance's stored shape. / 一条已存储的步骤实例形状。 */
export const jobSchema: z.ZodType<JobRecord> = z.object({
  jobId: jobIdSchema,
  runId: runIdSchema,
  transactionId: transactionIdSchema,
  workflowId: workflowIdSchema,
  subscriberId: subscriberIdSchema,
  stepId: z.string().min(1),
  stepType: z.enum([
    'in_app', 'email', 'sms', 'chat', 'push', 'tool',
    'delay', 'throttle', 'digest', 'trigger', 'http_request', 'custom',
  ]),
  state: z.enum([
    'pending', 'queued', 'running', 'completed', 'failed',
    'delayed', 'canceled', 'merged', 'skipped',
  ]),
  attempts: z.number().int().nonnegative(),
  deferredCount: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
  channel: channelSchema.optional(),
  sequence: z.number().int().nonnegative(),
  leaseOwner: z.string().optional(),
  leaseExpiresAt: z.number().optional(),
  skipReason: z.enum([
    'step_condition', 'preference',
    'missing_email', 'missing_phone', 'missing_push_token', 'missing_webhook_url',
  ]).optional(),
  messageId: messageIdSchema.optional(),
  createdAt: z.number(),
})

/** One delivered message's stored shape. / 一条已存储的投递消息形状。 */
export const messageSchema: z.ZodType<MessageRecord> = z.object({
  messageId: messageIdSchema,
  jobId: jobIdSchema,
  runId: runIdSchema,
  subscriberId: subscriberIdSchema,
  channel: channelSchema,
  content: z.string(),
  subject: z.string().optional(),
  providerId: z.string().min(1),
  status: z.enum(['sent', 'error', 'warning']),
  errorId: z.string().optional(),
  errorText: z.string().optional(),
  deliveredAt: z.number().optional(),
  seen: z.boolean(),
  read: z.boolean(),
  archived: z.boolean(),
  snoozedUntil: z.number().optional(),
  createdAt: z.number(),
  sourceSessionId: z.string().optional(),
})

/** One conversation's stored shape. / 一条已存储的会话形状。 */
export const conversationSchema: z.ZodType<ConversationRecord> = z.object({
  conversationId: conversationIdSchema,
  channel: channelSchema,
  threadId: z.string().min(1),
  subscriberId: subscriberIdSchema,
  status: z.enum(['active', 'resolved']),
  messageCount: z.number().int().nonnegative(),
  lastMessagePreview: z.string().optional(),
  lastActivityAt: z.number(),
  createdAt: z.number(),
})

/** One conversation message's stored shape. / 一条已存储的会话消息形状。 */
export const conversationEventSchema: z.ZodType<ConversationEventRecord> = z.object({
  eventId: z.string().min(1),
  conversationId: conversationIdSchema,
  direction: z.enum(['inbound', 'outbound']),
  platformMessageId: z.string().min(1),
  content: z.string(),
  occurredAt: z.number(),
})

/** One execution fact's stored shape. / 一条已存储的执行事实形状。 */
export const factSchema: z.ZodType<FactRecord> = z.object({
  factId: z.string().min(1),
  runId: runIdSchema,
  jobId: jobIdSchema.optional(),
  kind: z.enum(['step_started', 'step_finished', 'message_sent', 'message_failed', 'step_skipped']),
  detail: z.string().optional(),
  occurredAt: z.number(),
})

/**
 * The authoritative mail storage domain.
 *
 * `per-record` layout: the domain holds many independent records whose
 * lifetime differs (a workflow outlives its messages), so each record is its
 * own document rather than one rewritten aggregate.
 *
 * 权威的邮件存储域。
 *
 * `per-record` 布局：域中许多记录的生命周期各不相同（工作流比它的消息活得久），
 * 因此每条记录是独立文档，而不是一个被反复重写的聚合体。
 */
export const mailDomain = defineDomain({
  name: MAIL_DOMAIN_NAME,
  version: 1,
  layout: 'per-record',
  tables: {
    [WORKFLOWS_TABLE]: domainTable<string, WorkflowRecord>(workflowSchema),
    [SUBSCRIBERS_TABLE]: domainTable<string, SubscriberRecord>(subscriberSchema),
    [TOPICS_TABLE]: domainTable<string, TopicRecord>(topicSchema),
    [SUBSCRIPTIONS_TABLE]: domainTable<string, SubscriptionRecord>(subscriptionSchema),
    [PREFERENCES_TABLE]: domainTable<string, PreferenceRecord>(preferenceSchema),
    [INTEGRATIONS_TABLE]: domainTable<string, IntegrationRecord>(integrationSchema),
    [RUNS_TABLE]: domainTable<string, RunRecord>(runSchema),
    [JOBS_TABLE]: domainTable<string, JobRecord>(jobSchema),
    [MESSAGES_TABLE]: domainTable<string, MessageRecord>(messageSchema),
    [CONVERSATIONS_TABLE]: domainTable<string, ConversationRecord>(conversationSchema),
    [CONVERSATION_EVENTS_TABLE]: domainTable<string, ConversationEventRecord>(conversationEventSchema),
    [FACTS_TABLE]: domainTable<string, FactRecord>(factSchema),
  },
})
