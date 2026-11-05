/**
 * The mail domain's shared vocabulary: identifiers, enumerations, and the
 * record shapes every module writes.
 *
 * The design's data dictionary is the single source for field names and
 * requiredness; this module restates them as TypeScript types only. No
 * behaviour lives here — the zod schemas in `store-schema.ts` validate what
 * these types describe.
 *
 * 邮件领域的共享词汇：标识、枚举，以及每个模块写入的记录形状。
 *
 * 设计文档的数据字典是字段名与必填性的唯一来源；本模块只把它们复述为 TypeScript 类型，
 * 不含任何行为。`store-schema.ts` 里的 zod schema 负责校验这些类型描述的内容。
 *
 * @module @veren/mail/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** One notification workflow definition. / 一条通知工作流定义。 */
export type WorkflowId = Branded<'MailWorkflowId'>

/** One recipient profile. / 一个收件人档案。 */
export type SubscriberId = Branded<'MailSubscriberId'>

/** One subscription group. / 一个订阅分组。 */
export type TopicKey = Branded<'MailTopicKey'>

/** One trigger execution's chain identifier. / 一次触发执行链的标识。 */
export type TransactionId = Branded<'MailTransactionId'>

/** One step instance — the smallest unit of advancement. / 一步实例：推进的最小单位。 */
export type JobId = Branded<'MailJobId'>

/** One delivered message. / 一条已投递的消息。 */
export type MessageId = Branded<'MailMessageId'>

/** One cross-channel conversation. / 一条跨渠道会话。 */
export type ConversationId = Branded<'MailConversationId'>

/** One execution-chain identifier. / 一条执行链的标识。 */
export type RunId = Branded<'MailRunId'>

/**
 * The delivery channels this plugin speaks. `in_app` is the station inbox:
 * it needs no provider call, so it is the one channel that always resolves.
 *
 * 本插件支持的投递渠道。`in_app` 是站内消息：它无需外呼提供方，因此是唯一总能解析的渠道。
 */
export type ChannelKind = 'in_app' | 'email' | 'sms' | 'chat' | 'push' | 'tool'

/** The workflow definition's lifecycle state. / 工作流定义的生命周期状态。 */
export type WorkflowStatus = 'ACTIVE' | 'INACTIVE' | 'ERROR'

/**
 * The step kinds a workflow may contain. Content steps carry a template;
 * control steps (`delay`, `throttle`, `digest`) shape the chain's timing.
 *
 * 工作流可包含的步骤类型。内容步骤带模板；控制步骤（`delay`/`throttle`/`digest`）调整链路时序。
 */
export type StepType =
  | 'in_app' | 'email' | 'sms' | 'chat' | 'push' | 'tool'
  | 'delay' | 'throttle' | 'digest' | 'trigger' | 'http_request' | 'custom'

/**
 * A step instance's state. `pending` is created by dispatch, `queued` by the
 * enqueuer, `running` by a successful atomic claim.
 *
 * 步骤实例的状态。`pending` 由编排层创建，`queued` 由入队者写入，`running` 由成功的原子领取写入。
 */
export type JobState =
  | 'pending' | 'queued' | 'running' | 'completed' | 'failed'
  | 'delayed' | 'canceled' | 'merged' | 'skipped'

/**
 * Why a step was skipped rather than delivered. Each value names the
 * judgment that stopped it, in the design's fixed order.
 *
 * 步骤被跳过而非投递的原因。每个取值指明按设计固定顺序生效的那次判定。
 */
export type SkipReason =
  | 'step_condition' | 'preference'
  | 'missing_email' | 'missing_phone' | 'missing_push_token' | 'missing_webhook_url'

/** The delivery result written onto a message instance. / 写入消息实例的投递结果。 */
export type MessageStatus = 'sent' | 'error' | 'warning'

/** The execution chain's lifecycle state. / 执行链的生命周期状态。 */
export type RunStatus =
  | 'pending' | 'sent' | 'errored' | 'skipped'
  | 'canceled' | 'merged' | 'delivered' | 'interacted'

/** A conversation's lifecycle state. / 会话的生命周期状态。 */
export type ConversationStatus = 'active' | 'resolved'

/**
 * A trigger's acceptance status. Only `PROCESSED` writes an execution record;
 * the rest are refusals that leave no trace behind.
 *
 * 触发的受理状态。只有 `PROCESSED` 会写执行记录，其余都是不留痕迹的拒绝。
 */
export type TriggerAcceptance =
  | 'PROCESSED' | 'NOT_ACTIVE' | 'NO_WORKFLOW_STEPS'
  | 'INVALID_RECIPIENTS' | 'TENANT_MISSING'

/**
 * The five preference layers, in merge order. Later layers override earlier
 * ones; the order is fixed and not configurable.
 *
 * 五个偏好层，按合并顺序排列。后面的层覆盖前面的层；顺序固定且不可配置。
 */
export type PreferenceLayer =
  | 'workflow_resource' | 'user' | 'subject_global' | 'subject_workflow' | 'subscription'

/** One step's content template. A missing template renders as empty text. / 步骤的内容模板；缺省模板渲染为空文本。 */
export interface StepContent {
  /** The subject line, for channels that carry one. / 标题行，适用于有标题的渠道。 */
  readonly subject?: string
  /** The body, in the channel's content format. / 正文，按渠道的内容格式。 */
  readonly body: string
}

/** One workflow step. / 一个工作流步骤。 */
export interface WorkflowStep {
  /** Stable within the workflow; execution records cite it. / 工作流内稳定；执行记录引用它。 */
  readonly stepId: string
  /** What this step does. / 该步骤做什么。 */
  readonly type: StepType
  /** Conditions gating the step; empty means "always pass". / 步骤生效的条件；为空即总是通过。 */
  readonly filters?: readonly StepFilter[]
  /** The content template, for content steps. / 内容模板，内容步骤使用。 */
  readonly content?: StepContent
  /** Timing or window parameters, for control steps. / 时序或窗口参数，控制步骤使用。 */
  readonly control?: Record<string, unknown>
  /** Whether a failure here stops the remaining steps. / 此处失败是否中止后续步骤。 */
  readonly shouldStopOnFail?: boolean
}

/** The fields a step condition reads. / 步骤条件读取的字段来源。 */
export type FilterSource = 'payload' | 'subscriber' | 'previousStep' | 'tenant'

/** One step condition. / 一条步骤条件。 */
export interface StepFilter {
  /** Where the compared value comes from. / 被比较值的来源。 */
  readonly source: FilterSource
  /** The field path within that source. / 该来源内的字段路径。 */
  readonly field: string
  /** How the values are compared. / 比较方式。 */
  readonly operator: 'equals' | 'notEquals' | 'contains' | 'exists' | 'gt' | 'lt'
  /** The value compared against; absent for `exists`. / 比较用的值；`exists` 时缺省。 */
  readonly value?: unknown
}

/** One workflow definition. / 一条工作流定义。 */
export interface WorkflowRecord {
  /** Stable identifier. / 稳定标识。 */
  readonly workflowId: WorkflowId
  /** The trigger identifier callers name; unique per environment. / 调用方使用的触发标识；环境内唯一。 */
  readonly triggerIdentifier: string
  /** Display name. / 显示名。 */
  readonly name: string
  /** Lifecycle state. / 生命周期状态。 */
  readonly status: WorkflowStatus
  /** Drafts never trigger. / 草稿不参与触发。 */
  readonly draft: boolean
  /** The ordered step chain. / 有序步骤链。 */
  readonly steps: readonly WorkflowStep[]
  /** The JSON Schema the trigger payload is validated against. / 触发载荷校验所依据的 JSON Schema。 */
  readonly payloadSchema?: Record<string, unknown>
  /** The severity this workflow delivers at. / 该工作流投递时的严重级别。 */
  readonly severity: 'low' | 'medium' | 'high' | 'critical'
  /** Whether this workflow bypasses recipient preferences. / 该工作流是否绕过收件人偏好。 */
  readonly critical: boolean
  /** Free-form labels for filtering. / 用于过滤的自由标签。 */
  readonly tags: readonly string[]
  /** When the definition was written. / 定义写入时刻。 */
  readonly updatedAt: number
}

/** One recipient profile. / 一个收件人档案。 */
export interface SubscriberRecord {
  /** The caller-defined identifier; unique per environment. / 调用方自定义标识；环境内唯一。 */
  readonly subscriberId: SubscriberId
  /** The email address, when the recipient has one. / 邮箱地址，收件人具备时存在。 */
  readonly email?: string
  /** The phone number in E.164 form. / E.164 格式手机号。 */
  readonly phone?: string
  /** Display name. / 显示名。 */
  readonly name?: string
  /** The BCP 47 locale. / BCP 47 语言标签。 */
  readonly locale?: string
  /** The IANA timezone. / IANA 时区。 */
  readonly timezone?: string
  /** Soft-delete marker; a deleted subscriber never receives anything. / 软删标记；已删收件人不再接收任何投递。 */
  readonly deleted: boolean
  /** When the profile was written. / 档案写入时刻。 */
  readonly updatedAt: number
}

/** One subscription group. / 一个订阅分组。 */
export interface TopicRecord {
  /** The immutable group key. / 不可变的分组标识。 */
  readonly topicKey: TopicKey
  /** Display name. / 显示名。 */
  readonly name: string
  /** When the group was written. / 分组写入时刻。 */
  readonly updatedAt: number
}

/** One subscriber's membership in one group. / 一个收件人在一个分组中的订阅关系。 */
export interface SubscriptionRecord {
  /** The group key. / 分组标识。 */
  readonly topicKey: TopicKey
  /** The subscriber's identifier. / 收件人标识。 */
  readonly subscriberId: SubscriberId
  /** The context keys this subscription applies under. / 该订阅生效的上下文键。 */
  readonly contextKeys: readonly string[]
}

/** One preference layer's stored shape. / 一个偏好层的存储形状。 */
export interface PreferenceRecord {
  /** Which layer this record belongs to. / 该记录所属的偏好层。 */
  readonly layer: PreferenceLayer
  /** The workflow this layer applies to, when it is workflow-scoped. / 该层所属工作流，工作流作用域时存在。 */
  readonly workflowId?: WorkflowId
  /** The subscriber this layer applies to, when it is subscriber-scoped. / 该层所属收件人，收件人作用域时存在。 */
  readonly subscriberId?: SubscriberId
  /** The group this layer applies to, when it is subscription-scoped. / 该层所属分组，订阅作用域时存在。 */
  readonly topicKey?: TopicKey
  /** The context keys this layer is partitioned under. / 该层所处的上下文键分区。 */
  readonly contextKeys: readonly string[]
  /** Whether the recipient's messages are allowed at all. / 是否允许给收件人投递。 */
  readonly enabled: boolean
  /** Whether lower layers may override this one. / 下层是否可覆盖本层。 */
  readonly readOnly: boolean
  /** Per-channel overrides; absent means "inherit". / 按渠道的覆盖；缺省即继承。 */
  readonly channels?: Readonly<Partial<Record<ChannelKind, boolean>>>
  /** The quiet hours, in the subscriber's timezone. / 静默时段，按收件人时区。 */
  readonly schedule?: PreferenceSchedule
}

/** A recipient's quiet hours. / 收件人的静默时段。 */
export interface PreferenceSchedule {
  /** The hour the quiet window opens, in the subscriber's timezone. / 静默窗口开启的小时，按收件人时区。 */
  readonly startHour: number
  /** The hour the quiet window closes, in the subscriber's timezone. / 静默窗口关闭的小时，按收件人时区。 */
  readonly endHour: number
  /** Whether the quiet window is currently in force. / 静默窗口当前是否生效。 */
  readonly enabled: boolean
}

/** One channel integration's stored shape. / 一个渠道集成的存储形状。 */
export interface IntegrationRecord {
  /** Stable identifier. / 稳定标识。 */
  readonly integrationId: string
  /** The channel this integration serves. / 该集成服务的渠道。 */
  readonly channel: ChannelKind
  /** The provider identifier, e.g. `smtp` or `http`. / 提供方标识，如 `smtp` 或 `http`。 */
  readonly providerId: string
  /** Whether this integration participates in selection. / 该集成是否参与选择。 */
  readonly active: boolean
  /** Whether this is the fallback when no rule matches. / 无规则命中时是否作为回落。 */
  readonly primary: boolean
  /** Higher wins when several integrations match. / 多个集成命中时数值高者胜出。 */
  readonly priority: number
  /** The provider configuration, masked on read. / 提供方配置，读取时掩码。 */
  readonly config: Readonly<Record<string, unknown>>
}

/** One trigger execution's chain. / 一次触发执行链。 */
export interface RunRecord {
  /** Stable identifier. / 稳定标识。 */
  readonly runId: RunId
  /** The caller's idempotency identifier, unique per environment. / 调用方的幂等标识，环境内唯一。 */
  readonly transactionId: TransactionId
  /** The workflow that was triggered. / 被触发的工作流。 */
  readonly workflowId: WorkflowId
  /** How many recipients the chain expanded to. / 执行链展开到的收件人数量。 */
  readonly recipientCount: number
  /** The chain's state. / 执行链状态。 */
  readonly status: RunStatus
  /** When the chain started. / 执行链开始时刻。 */
  readonly startedAt: number
  /** When the chain finished, once it did. / 执行链结束时刻（结束时）。 */
  readonly finishedAt?: number
  /** The host chat session the trigger came from, when the caller names one. / 触发所来自的宿主聊天会话，调用方给出时才有。 */
  readonly sourceSessionId?: string
}

/** One step instance's stored shape. / 一步实例的存储形状。 */
export interface JobRecord {
  /** Stable identifier. / 稳定标识。 */
  readonly jobId: JobId
  /** The execution chain this step belongs to. / 该步骤所属执行链。 */
  readonly runId: RunId
  /** The transaction identifier of the chain. / 执行链的事务标识。 */
  readonly transactionId: TransactionId
  /** The workflow this step came from. / 该步骤所属工作流。 */
  readonly workflowId: WorkflowId
  /** The recipient this step delivers to. / 该步骤的投递对象。 */
  readonly subscriberId: SubscriberId
  /** The step definition's identifier. / 步骤定义的标识。 */
  readonly stepId: string
  /** The step's type. / 步骤类型。 */
  readonly stepType: StepType
  /** The step's state. / 步骤状态。 */
  readonly state: JobState
  /** How many times this step has been attempted. / 该步骤已尝试次数。 */
  readonly attempts: number
  /** How many times this step was deferred by a quiet window. / 该步骤被静默窗口顺延次数。 */
  readonly deferredCount: number
  /** The business payload carried along the chain. / 沿链传递的业务载荷。 */
  readonly payload: Readonly<Record<string, unknown>>
  /** The recipient's identifier this step belongs to, used for grouping. / 该步骤所属收件人标识，用于分组。 */
  readonly channel?: ChannelKind
  /** The step's own sequence position in the chain. / 该步骤在链中的序号。 */
  readonly sequence: number
  /** The lease holder while the step is running. / 步骤运行期间的租约持有者。 */
  readonly leaseOwner?: string
  /** When the lease expires. / 租约到期时刻。 */
  readonly leaseExpiresAt?: number
  /** Why the step was skipped. / 步骤被跳过的原因。 */
  readonly skipReason?: SkipReason
  /** The message this step produced, when it produced one. / 该步骤产出的消息（若有）。 */
  readonly messageId?: MessageId
  /** When the step was created. / 步骤创建时刻。 */
  readonly createdAt: number
}

/** One delivered message's stored shape. / 一条已投递消息的存储形状。 */
export interface MessageRecord {
  /** Stable identifier. / 稳定标识。 */
  readonly messageId: MessageId
  /** The step that produced this message — one step yields at most one message. / 产出该消息的步骤；一步至多产出一条消息。 */
  readonly jobId: JobId
  /** The execution chain. / 所属执行链。 */
  readonly runId: RunId
  /** The recipient. / 收件人。 */
  readonly subscriberId: SubscriberId
  /** The channel this went out on. / 投递所用渠道。 */
  readonly channel: ChannelKind
  /** The rendered content. / 渲染后的内容。 */
  readonly content: string
  /** The subject line, when the channel carries one. / 标题行，渠道支持时存在。 */
  readonly subject?: string
  /** The provider that accepted it. / 受理它的提供方。 */
  readonly providerId: string
  /** The delivery result. / 投递结果。 */
  readonly status: MessageStatus
  /** The provider's error code, when it failed. / 提供方错误码（失败时）。 */
  readonly errorId?: string
  /** The provider's error text, when it failed. / 提供方错误描述（失败时）。 */
  readonly errorText?: string
  /** When the provider accepted it. / 提供方受理时刻。 */
  readonly deliveredAt?: number
  /** Whether the recipient has seen it. / 收件人是否已看到。 */
  readonly seen: boolean
  /** Whether the recipient has read it. / 收件人是否已读。 */
  readonly read: boolean
  /** Whether the recipient archived it. / 收件人是否已归档。 */
  readonly archived: boolean
  /** When it was snoozed until. / 稍后提醒到期时刻。 */
  readonly snoozedUntil?: number
  /** When the message was created. / 消息创建时刻。 */
  readonly createdAt: number
  /** The host chat session the trigger came from, when the caller named one. / 触发所来自的宿主聊天会话，调用方给出时才有。 */
  readonly sourceSessionId?: string
}

/** One conversation's stored shape. / 一条会话的存储形状。 */
export interface ConversationRecord {
  /** Stable identifier. / 稳定标识。 */
  readonly conversationId: ConversationId
  /** The channel the conversation lives on. / 会话所在渠道。 */
  readonly channel: ChannelKind
  /** The platform's thread identifier. / 平台线程标识。 */
  readonly threadId: string
  /** The recipient participating. / 参与的收件人。 */
  readonly subscriberId: SubscriberId
  /** The conversation's state. / 会话状态。 */
  readonly status: ConversationStatus
  /** How many messages the conversation holds. / 会话消息数。 */
  readonly messageCount: number
  /** The newest message's excerpt. / 最新消息的摘要。 */
  readonly lastMessagePreview?: string
  /** When the conversation last moved. / 会话最后活动时间。 */
  readonly lastActivityAt: number
  /** When the conversation was created. / 会话创建时刻。 */
  readonly createdAt: number
}

/** One conversation message's stored shape. / 一条会话消息的存储形状。 */
export interface ConversationEventRecord {
  /** Stable identifier. / 稳定标识。 */
  readonly eventId: string
  /** The conversation it belongs to. / 所属会话。 */
  readonly conversationId: ConversationId
  /** Which way the message went. / 消息方向。 */
  readonly direction: 'inbound' | 'outbound'
  /** The platform's message identifier; the dedupe anchor. / 平台消息标识；去重锚点。 */
  readonly platformMessageId: string
  /** The message body. / 消息正文。 */
  readonly content: string
  /** The platform's own timestamp, used for ordering. / 平台时间戳，用于排序。 */
  readonly occurredAt: number
}

/** One execution-fact row. / 一条执行事实。 */
export interface FactRecord {
  /** Stable identifier. / 稳定标识。 */
  readonly factId: string
  /** The execution chain. / 所属执行链。 */
  readonly runId: RunId
  /** The step this fact belongs to. / 该事实所属步骤。 */
  readonly jobId?: JobId
  /** The fact kind. / 事实类型。 */
  readonly kind: 'step_started' | 'step_finished' | 'message_sent' | 'message_failed' | 'step_skipped'
  /** The detail line, denormalized for querying. / 详情行，反范式化以便查询。 */
  readonly detail?: string
  /** When the fact was recorded. / 事实记录时刻。 */
  readonly occurredAt: number
}
