/**
 * The trigger: the entry point that turns one business event into an
 * execution chain.
 *
 * The design's order is fixed and each step is a refusal that leaves no
 * trace behind: validate the workflow, validate the payload, resolve the
 * recipients, and only then solidify the execution record. A rejected trigger
 * produces no record at all — an orphaned execution that later duplicates a
 * delivery is worse than a refusal.
 *
 * Idempotency has one source of truth: the `transactionId`. A repeated
 * transaction is a conflict, not a second delivery, and the design says so
 * explicitly — the caller needs to know this attempt was not accepted.
 *
 * 触发：把一次业务事件变成一条执行链的入口。
 *
 * 设计的顺序是固定的，每一步都是不留痕迹的拒绝：校验工作流、校验载荷、解析收件人，
 * 然后才固化执行记录。被拒的触发不产生任何记录——一条日后重复投递的孤儿执行，比一次拒绝更糟。
 *
 * 幂等只有一个真相来源：`transactionId`。重复的事务是冲突而非二次投递，设计明说如此——
 * 调用方需要知道这次尝试未被受理。
 *
 * @module @veren/mail/trigger
 */

import Ajv, { type ValidateFunction } from 'ajv'
import { mailError } from './errors.ts'
import type { MailStore } from './store.ts'
import type {
  RunRecord,
  SubscriberRecord,
  TransactionId,
  TriggerAcceptance,
  WorkflowRecord,
} from './types.ts'

/** A recipient named directly, or a group to fan out to. / 直接指名的收件人，或要扇出的分组。 */
export type TriggerRecipient =
  | { readonly kind: 'subscriber'; readonly subscriberId: string }
  | { readonly kind: 'topic'; readonly topicKey: string; readonly exclude?: readonly string[] }

/** One trigger request. / 一次触发请求。 */
export interface TriggerRequest {
  /** The workflow's trigger identifier. / 工作流的触发标识。 */
  readonly name: string
  /** The business payload. / 业务载荷。 */
  readonly payload: Readonly<Record<string, unknown>>
  /** Who should receive it. / 接收方。 */
  readonly to: readonly TriggerRecipient[]
  /** The caller's idempotency identifier. / 调用方的幂等标识。 */
  readonly transactionId?: string
  /** The recipient who triggered it; excluded from fan-out. / 触发者；扇出时被排除。 */
  readonly actor?: string
  /** The context keys the delivery runs under. / 投递所处的上下文键。 */
  readonly contextKeys?: readonly string[]
  /** The host chat session the trigger came from, for "open the source" navigation. / 触发所来自的宿主聊天会话，用于「打开来源」导航。 */
  readonly sourceSessionId?: string
}

/** What a trigger returned. / 触发的返回结果。 */
export interface TriggerResult {
  /** The transaction identifier, generated when the caller gave none. / 事务标识；调用方未给时生成。 */
  readonly transactionId: string
  /** How the trigger was received. / 触发的受理状态。 */
  readonly acceptance: TriggerAcceptance
  /** How many recipients the chain covers. / 执行链覆盖的收件人数量。 */
  readonly recipientCount: number
}

/** The identifier generator the trigger uses. / 触发使用的标识生成器。 */
export type IdFactory = () => string

/**
 * Validate a payload against a workflow's JSON Schema, and fill the
 * schema's defaults into the payload that comes back.
 *
 * 按工作流的 JSON Schema 校验载荷，并把 schema 的默认值补进返回的载荷。
 *
 * @param workflow - the workflow being triggered / 被触发的工作流
 * @param payload - the caller's payload / 调用方的载荷
 * @returns the validated payload with defaults applied / 补齐默认值后的载荷
 */
export function validatePayload(
  workflow: WorkflowRecord,
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const schema = workflow.payloadSchema
  if (schema === undefined) return { ...payload }
  const validate = compileSchema(schema)
  if (validate(payload)) return { ...payload }
  const details = (validate.errors ?? []).map((error) => ({
    path: error.instancePath === '' ? (error.params as { missingProperty?: string }).missingProperty ?? '' : error.instancePath,
    message: error.message ?? 'invalid',
  }))
  throw mailError('MAIL_TRIGGER_PAYLOAD_INVALID', 'mail: the trigger payload does not match the workflow schema', { details })
}

/** The compiled validators, keyed by the schema they were built from. / 已编译的校验器，按其 schema 归集。 */
const validators = new Map<string, ValidateFunction>()

/**
 * Compile one schema, reusing the compiled validator when the same schema
 * comes round again.
 *
 * 编译一个 schema；同一 schema 再次出现时复用已编译的校验器。
 *
 * @param schema - the JSON Schema / JSON Schema
 * @returns the compiled validator / 已编译的校验器
 */
function compileSchema(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema)
  const cached = validators.get(key)
  if (cached !== undefined) return cached
  const compiled = new Ajv({ allErrors: true, strict: false }).compile(schema)
  validators.set(key, compiled)
  return compiled
}

/**
 * Resolve the recipients a trigger names.
 *
 * A named recipient that does not exist is refused outright — an invalid
 * recipient is a caller mistake, not a silent drop. A group that does not
 * exist only warns: the other groups in the same trigger still deliver, and
 * one bad group must not sink the rest.
 *
 * 解析触发所指定的收件人。
 *
 * 指名却不存在的收件人被直接拒绝——无效收件人是调用方错误，不是静默丢弃。不存在的分组只告警：
 * 同一次触发里的其他分组仍要投递，一个坏分组不该拖垮其余。
 *
 * @param store - the durable store / 持久化存储
 * @param request - the trigger request / 触发请求
 * @returns the resolved recipients and any group warnings / 解析出的收件人与分组告警
 */
export function resolveRecipients(
  store: MailStore,
  request: TriggerRequest,
): { readonly subscribers: readonly SubscriberRecord[]; readonly warnings: readonly string[] } {
  const subscribers: SubscriberRecord[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const recipient of request.to) {
    if (recipient.kind === 'subscriber') {
      const found = store.getSubscriber(recipient.subscriberId)
      if (found === undefined || found.deleted) {
        throw mailError(
          'MAIL_TRIGGER_RECIPIENT_INVALID',
          `mail: the recipient '${recipient.subscriberId}' does not exist`,
          { subscriberId: recipient.subscriberId },
        )
      }
      addIfNew(subscribers, seen, found, request.actor)
      continue
    }
    const topic = store.getTopic(recipient.topicKey)
    if (topic === undefined) {
      warnings.push(recipient.topicKey)
      continue
    }
    for (const subscription of store.subscriptions()) {
      if (subscription.topicKey !== recipient.topicKey) continue
      if (recipient.exclude?.includes(subscription.subscriberId) === true) continue
      const found = store.getSubscriber(subscription.subscriberId)
      if (found === undefined || found.deleted) continue
      addIfNew(subscribers, seen, found, request.actor)
    }
  }
  return { subscribers, warnings }
}

/**
 * Add one recipient to the list, unless it is already there or is the actor.
 * The first occurrence wins: a recipient named twice receives one message.
 *
 * 把一个收件人加入列表，除非它已在其中或它就是触发者。首次出现者胜出：被指名两次的收件人
 * 只收到一条消息。
 *
 * @param subscribers - the list being built / 正在构建的列表
 * @param seen - the identifiers already added / 已加入的标识
 * @param subscriber - the candidate / 候选收件人
 * @param actor - the triggering recipient, excluded from fan-out / 触发者，扇出时被排除
 */
function addIfNew(
  subscribers: SubscriberRecord[],
  seen: Set<string>,
  subscriber: SubscriberRecord,
  actor: string | undefined,
): void {
  if (actor !== undefined && subscriber.subscriberId === actor) return
  if (seen.has(subscriber.subscriberId)) return
  seen.add(subscriber.subscriberId)
  subscribers.push(subscriber)
}

/**
 * Check whether a transaction identifier was already used. A repeat is a
 * conflict: the caller must learn that this attempt was not accepted.
 *
 * 检查事务标识是否已被使用。重复即冲突：调用方必须知道这次尝试未被受理。
 *
 * @param store - the durable store / 持久化存储
 * @param transactionId - the transaction identifier / 事务标识
 */
export function assertTransactionUnused(store: MailStore, transactionId: string): void {
  const used = store.runs().some((run) => run.transactionId === transactionId)
  if (used) {
    throw mailError(
      'MAIL_TRIGGER_TRANSACTION_CONFLICT',
      `mail: the transaction '${transactionId}' was already accepted`,
      { transactionId },
    )
  }
}

/**
 * The workflow a trigger names, or the refusal that says there is none.
 *
 * 触发所指名的��作流，或说明不存在的拒绝。
 *
 * @param store - the durable store / 持久化存储
 * @param name - the trigger identifier / 触发标识
 * @returns the workflow definition / 工作流定义
 */
export function findWorkflow(store: MailStore, name: string): WorkflowRecord {
  const found = store.workflows().find((workflow) => workflow.triggerIdentifier === name)
  if (found === undefined) {
    throw mailError('MAIL_TRIGGER_WORKFLOW_NOT_FOUND', `mail: no workflow is triggered by '${name}'`, { name })
  }
  return found
}

/**
 * Whether a workflow may be triggered at all. A draft or non-active workflow
 * is not an error — it is a refusal that reports how many steps it has.
 *
 * 该工作流是否可被触发。草稿或未启用的工作流不算错误——它是一次拒绝，并报告其步骤数。
 *
 * @param workflow - the workflow definition / 工作流定义
 * @returns the acceptance status / 受理状态
 */
export function workflowAcceptance(workflow: WorkflowRecord): TriggerAcceptance {
  if (workflow.draft || workflow.status !== 'ACTIVE') return 'NOT_ACTIVE'
  if (workflow.steps.length === 0) return 'NO_WORKFLOW_STEPS'
  return 'PROCESSED'
}

/**
 * Build the execution-chain record a accepted trigger produces.
 *
 * 构造一次被受理的触发所产生的执行链记录。
 *
 * @param transactionId - the transaction identifier / 事务标识
 * @param workflow - the workflow being triggered / 被触发的工作流
 * @param recipientCount - how many recipients the chain covers / 执行链覆盖的收件人数量
 * @param runId - the chain's identifier / 执行链标识
 * @param now - the current time / 当前时刻
 * @returns the execution-chain record / 执行链记录
 */
export function buildRun(
  transactionId: TransactionId,
  workflow: WorkflowRecord,
  recipientCount: number,
  runId: string,
  now: number,
  sourceSessionId?: string,
): RunRecord {
  return {
    runId: runId as RunRecord['runId'],
    transactionId,
    workflowId: workflow.workflowId,
    recipientCount,
    status: 'pending',
    startedAt: now,
    ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
  }
}
