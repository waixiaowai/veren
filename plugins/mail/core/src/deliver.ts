/**
 * The delivery layer: it turns one step into a message that really exists on
 * a channel.
 *
 * Three rules carry the module:
 *
 * - **The judgment order is fixed**: step condition, then channel preference,
 *   then channel address. A step that fails the first check never reaches the
 *   second, so a skipped step names the judgment that actually stopped it.
 * - **The message is written before the call**: the record exists before the
 *   provider is contacted. A user who received a message but whose system
 *   believes otherwise is the failure this ordering prevents.
 * - **One step yields at most one message**: the step identifier is the
 *   idempotency anchor, so a repeated dispatch returns the existing result
 *   instead of sending again.
 *
 * 投递层：把一步变成渠道上真实存在的消息。
 *
 * 三条规则承载本模块：
 *
 * - **判定顺序固定**：步骤条件 → 渠道偏好 → 渠道地址。第一道检查未过的步骤不会走到第二道，
 *   因此被跳过的步骤总能指出真正拦下它的那次判定。
 * - **先落库后外呼**：记录在联系提供方之前就已存在。「用户收到了消息而系统认为没发」正是这个
 *   顺序要防的失败。
 * - **一步至多产出一条消息**：步骤标识即幂等锚点，重复派发返回既有结果而不再次发送。
 *
 * @module @veren/mail/deliver
 */

import { renderContent } from './content.ts'
import { mergePreferences, toLayerInput } from './preference.ts'
import type { MailStore } from './store.ts'
import type {
  ChannelKind,
  JobRecord,
  MessageRecord,
  SkipReason,
  WorkflowRecord,
} from './types.ts'

/** What one delivery attempt concluded. / 一次投递尝试的结论。 */
export type DeliveryOutcome =
  | { readonly outcome: 'sent'; readonly messageId: string; readonly providerId: string }
  | { readonly outcome: 'skipped'; readonly reason: SkipReason }
  | { readonly outcome: 'failed'; readonly messageId: string; readonly errorId: string; readonly retryable: boolean }

/**
 * A channel provider: the thing that actually puts a message somewhere.
 *
 * 渠道提供方：真正把消息送到某处的东西。
 */
export interface ChannelProvider {
  /** The provider's identifier, recorded on the message. / 提供方标识，记录在消息上。 */
  readonly providerId: string
  /** The channels this provider serves. / 该提供方服务的渠道。 */
  readonly channels: readonly ChannelKind[]
  /**
   * Send one message.
   *
   * @param request - the address, the rendered content, and the message id / 地址、渲染内容与消息标识
   * @returns the provider's receipt / 提供方的回执
   */
  send(request: DeliveryRequest): Promise<DeliveryReceipt>
}

/** One outbound message handed to a provider. / 交给提供方的一条出站消息。 */
export interface DeliveryRequest {
  /** Where the message goes. / 消息送往何处。 */
  readonly address: string
  /** The rendered body. / 渲染后的正文。 */
  readonly content: string
  /** The subject line, when the channel carries one. / 标题行，渠道支持时存在。 */
  readonly subject?: string
  /** The message's identifier, so the provider can echo it. / 消息标识，供提供方回显。 */
  readonly messageId: string
}

/** What a provider reports back. / 提供方回报的内容。 */
export interface DeliveryReceipt {
  /** Whether the provider accepted the message. / 提供方是否受理了消息。 */
  readonly accepted: boolean
  /** Whether the provider flagged the message. / 提供方是否标记了消息。 */
  readonly warning?: boolean
  /** The provider's error code, when it refused. / 提供方错误码（拒绝时）。 */
  readonly errorId?: string
  /** The provider's error text, when it refused. / 提供方错误描述（拒绝时）。 */
  readonly errorText?: string
  /** Whether the failure may be retried. / 该失败是否可重试。 */
  readonly retryable?: boolean
}

/** The context one delivery needs. / 一次投递所需的上下文。 */
export interface DeliveryContext {
  /** The step being delivered. / 被投递的步骤。 */
  readonly job: JobRecord
  /** The workflow it came from. / 它所属的工作流。 */
  readonly workflow: WorkflowRecord
  /** The durable store. / 持久化存储。 */
  readonly store: MailStore
  /** The provider registry, keyed by channel. / 按渠道归集的提供方注册表。 */
  readonly providers: ReadonlyMap<ChannelKind, ChannelProvider>
  /** The identifier generator. / 标识生成器。 */
  readonly newMessageId: () => string
  /** The current time. / 当前时刻。 */
  readonly now: number
}

/**
 * Deliver one step.
 *
 * @param context - the delivery context / 投递上下文
 * @param conditions - whether the step's conditions pass / 步骤条件是否通过
 * @returns what the attempt concluded / 尝试的结论
 */
export async function deliverStep(
  context: DeliveryContext,
  conditions: boolean,
): Promise<DeliveryOutcome> {
  const { job, store } = context
  const existing = store.messages().find((message) => message.jobId === job.jobId)
  if (existing !== undefined) {
    return { outcome: 'sent', messageId: existing.messageId, providerId: existing.providerId }
  }
  if (!conditions) return { outcome: 'skipped', reason: 'step_condition' }
  const channel = channelOf(job)
  const decision = decideChannel(context)
  if (!decision.send) return { outcome: 'skipped', reason: 'preference' }
  if (!decision.channels.includes(channel)) return { outcome: 'skipped', reason: 'preference' }
  const address = addressFor(store, job, channel)
  if (address === undefined) return { outcome: 'skipped', reason: missingAddressReason(channel) }
  const provider = context.providers.get(channel)
  if (provider === undefined) {
    return {
      outcome: 'failed',
      messageId: '',
      errorId: 'MAIL_DELIVER_INTEGRATION_MISSING',
      retryable: false,
    }
  }
  return callProvider(context, provider, address, channel)
}

/**
 * Call the provider, after the message has been written.
 *
 * @param context - the delivery context / 投递上下文
 * @param provider - the chosen provider / 选定的提供方
 * @param address - where the message goes / 消息送往何处
 * @param channel - the channel / 渠道
 * @returns what the attempt concluded / 尝试的结论
 */
async function callProvider(
  context: DeliveryContext,
  provider: ChannelProvider,
  address: string,
  channel: ChannelKind,
): Promise<DeliveryOutcome> {
  const { job, workflow, store } = context
  const step = workflow.steps.find((candidate) => candidate.stepId === job.stepId)
  const content = step?.content ?? { body: '' }
  const rendered = await renderContent(content, job.payload)
  const messageId = context.newMessageId()
  const written = writeMessage(context, messageId, provider.providerId, channel, rendered.body, rendered.subject)
  await store.putMessage(written)
  const receipt = await providerReceipt(provider, {
    address,
    content: rendered.body,
    ...(rendered.subject === undefined ? {} : { subject: rendered.subject }),
    messageId,
  })
  return writeReceipt(context, written, messageId, provider.providerId, receipt)
}

/**
 * Ask one provider to send, turning a thrown error into a rejection receipt.
 *
 * 让提供方发送，并把抛出的错误转成拒绝回执。
 *
 * @param provider - the chosen provider / 选定的提供方
 * @param request - the outbound message / 出站消息
 * @returns the provider's receipt / 提供方的回执
 */
async function providerReceipt(
  provider: ChannelProvider,
  request: DeliveryRequest,
): Promise<DeliveryReceipt> {
  try {
    return await provider.send(request)
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    return { accepted: false, errorId: 'MAIL_DELIVER_PROVIDER_REJECTED', errorText: detail }
  }
}

/**
 * Write the receipt back onto the message, and report the outcome.
 *
 * 把回执写回消息，并报告结果。
 *
 * @param context - the delivery context / 投递上下文
 * @param written - the message written before the call / 外呼前写入的消息
 * @param messageId - the message's identifier / 消息标识
 * @param providerId - the provider that carried it / 承载它的提供方
 * @param receipt - what the provider reported / 提供方的回报
 * @returns what the attempt concluded / 尝试的结论
 */
async function writeReceipt(
  context: DeliveryContext,
  written: MessageRecord,
  messageId: string,
  providerId: string,
  receipt: DeliveryReceipt,
): Promise<DeliveryOutcome> {
  const { store } = context
  if (!receipt.accepted) {
    await store.putMessage({
      ...written,
      status: 'error',
      ...(receipt.errorId === undefined ? {} : { errorId: receipt.errorId }),
      ...(receipt.errorText === undefined ? {} : { errorText: receipt.errorText }),
    })
    return {
      outcome: 'failed',
      messageId,
      errorId: receipt.errorId ?? 'MAIL_DELIVER_PROVIDER_REJECTED',
      retryable: receipt.retryable ?? false,
    }
  }
  await store.putMessage({
    ...written,
    status: receipt.warning === true ? 'warning' : 'sent',
    deliveredAt: context.now,
  })
  return { outcome: 'sent', messageId, providerId }
}

/**
 * Write the message record that precedes the provider call.
 *
 * @param context - the delivery context / 投递上下文
 * @param messageId - the message's identifier / 消息标识
 * @param providerId - the provider that will carry it / 承载它的提供方
 * @param channel - the channel / 渠道
 * @param content - the rendered body / 渲染后的正文
 * @param subject - the subject line / 标题行
 * @returns the message record / 消息记录
 */
function writeMessage(
  context: DeliveryContext,
  messageId: string,
  providerId: string,
  channel: ChannelKind,
  content: string,
  subject: string | undefined,
): MessageRecord {
  return {
    messageId: messageId as MessageRecord['messageId'],
    jobId: context.job.jobId,
    runId: context.job.runId,
    subscriberId: context.job.subscriberId,
    channel,
    content,
    ...(subject === undefined ? {} : { subject }),
    providerId,
    status: 'sent',
    seen: false,
    read: false,
    archived: false,
    createdAt: context.now,
  }
}

/**
 * The channel a step delivers on. A control step carries no channel, and the
 * station inbox is the one that always exists.
 *
 * 步骤投递所用的渠道。控制步骤不带渠道，而站内收件箱是唯一始终存在的渠道。
 *
 * @param job - the step / 步骤
 * @returns the channel / 渠道
 */
function channelOf(job: JobRecord): ChannelKind {
  return job.channel ?? 'in_app'
}

/**
 * Where on this channel the recipient can be reached.
 *
 * 收件人在该渠道上的可达地址。
 *
 * @param store - the durable store / 持久化存储
 * @param job - the step / 步骤
 * @param channel - the channel / 渠道
 * @returns the address, when the recipient has one / 收件人具备时返回地址
 */
function addressFor(
  store: MailStore,
  job: JobRecord,
  channel: ChannelKind,
): string | undefined {
  const subscriber = store.getSubscriber(job.subscriberId)
  if (subscriber === undefined) return undefined
  if (channel === 'email') return subscriber.email
  if (channel === 'sms') return subscriber.phone
  if (channel === 'in_app') return subscriber.subscriberId
  return undefined
}

/**
 * The reason a step was skipped for having no address on its channel.
 *
 * 步骤因该渠道上无地址而被跳过的原因。
 *
 * @param channel - the channel / 渠道
 * @returns the skip reason / 跳过原因
 */
function missingAddressReason(channel: ChannelKind): SkipReason {
  if (channel === 'email') return 'missing_email'
  if (channel === 'sms') return 'missing_phone'
  return 'missing_webhook_url'
}

/**
 * The merged preference decision for this delivery.
 *
 * 本次投递的合并偏好判定。
 *
 * @param context - the delivery context / 投递上下文
 * @returns the merged decision / 合并后的判定
 */
function decideChannel(
  context: DeliveryContext,
): { readonly send: boolean; readonly channels: readonly ChannelKind[] } {
  const { job, workflow, store } = context
  const topicKeys = store.subscriptions()
    .filter((subscription) => subscription.subscriberId === job.subscriberId)
    .map((subscription) => subscription.topicKey)
  const layers = store.preferences()
    .filter((record) => record.subscriberId === undefined || record.subscriberId === job.subscriberId)
    .map(toLayerInput)
  return mergePreferences({
    workflowId: workflow.workflowId,
    subject: { subscriberId: job.subscriberId, topicKeys },
    contextKeys: [],
    ...(topicKeys.length === 1 ? { topicKey: topicKeys[0] } : {}),
    critical: workflow.critical,
  }, layers)
}
