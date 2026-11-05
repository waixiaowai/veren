/**
 * The mail service: the one façade every other package talks to.
 *
 * It owns the chain end to end — accept a trigger, expand it into per-
 * recipient step chains, run those steps, and expose the facts the panel
 * reads. The chain runs on a small internal queue rather than a timer: a
 * trigger is accepted synchronously and the steps advance as the queue
 * drains, which is what "accepted, not delivered" means in practice.
 *
 * 邮件服务：其他包与之对话的唯一门面。
 *
 * 它端到端地拥有这条链——受理一次触发、展开为按收件人的步骤链、运行这些步骤，并暴露面板读取的
 * 事实。链跑在一个小型内部队列上而非定时器上：触发被同步受理，步骤随队列排空而推进，这正是
 * 「已受理，未投递」在实践中的含义。
 *
 * @module @veren/mail/service
 */

import { randomUUID } from 'node:crypto'
import { defineToken } from '@veren/core'
import { evaluateConditions } from './conditions.ts'
import {
  buildJobs,
  cancelRun,
  chainJobs,
  claimJob,
  commitJob,
  isChainComplete,
  mayRetry,
  nextJob,
  terminalRunStatus,
} from './dispatch.ts'
import { deliverStep, type ChannelProvider, type DeliveryOutcome } from './deliver.ts'
import { asMailError } from './errors.ts'
import type { MailStore } from './store.ts'
import {
  assertTransactionUnused,
  buildRun,
  findWorkflow,
  resolveRecipients,
  validatePayload,
  workflowAcceptance,
  type TriggerRequest,
  type TriggerResult,
} from './trigger.ts'
import type {
  ChannelKind,
  JobRecord,
  MessageRecord,
  RunRecord,
  TransactionId,
  WorkflowRecord,
} from './types.ts'

/** The service token other packages inject. / 其他包注入的服务令牌。 */
export const MailServiceToken = defineToken<MailService>('mailService')

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The mail service. / 邮件服务。 */
    mailService: MailService
  }
}

/** What the panel reads about one message. / 面板读取的关于一条消息的视图。 */
export interface MessageView {
  /** The message's identifier. / 消息标识。 */
  readonly messageId: string
  /** The recipient. / 收件人。 */
  readonly subscriberId: string
  /** The channel it went out on. / 投递所用渠道。 */
  readonly channel: ChannelKind
  /** The subject line. / 标题行。 */
  readonly subject?: string
  /** The rendered body. / 渲染后的正文。 */
  readonly content: string
  /** The delivery result. / 投递结果。 */
  readonly status: MessageRecord['status']
  /** Whether the recipient has seen it. / 收件人是否已看到。 */
  readonly seen: boolean
  /** Whether the recipient has read it. / 收件人是否已读。 */
  readonly read: boolean
  /** Whether the recipient archived it. / 收件人是否已归档。 */
  readonly archived: boolean
  /** When it was created. / 创建时刻。 */
  readonly createdAt: number
}

/** What the panel reads about one step. / 面板读取的关于一个步骤的视图。 */
export interface StepView {
  /** The step's identifier. / 步骤标识。 */
  readonly jobId: string
  /** The recipient the step belongs to. / 该步骤所属的收件人。 */
  readonly subscriberId: string
  /** The step definition's identifier. / 步骤定义的标识。 */
  readonly stepId: string
  /** The step's state. / 步骤状态。 */
  readonly state: JobRecord['state']
  /** Why the step was skipped, when it was. / 步骤被跳过的原因（若被跳过）。 */
  readonly skipReason?: string
}

/** What the panel reads about one execution chain. / 面板读取的关于一条执行链的视图。 */
export interface RunView {
  /** The chain's identifier. / 执行链标识。 */
  readonly runId: string
  /** The transaction identifier. / 事务标识。 */
  readonly transactionId: string
  /** The workflow's name. / 工作流名称。 */
  readonly workflowName: string
  /** The chain's state. / 执行链状态。 */
  readonly status: RunRecord['status']
  /** How many recipients it covers. / 覆盖的收件人数量。 */
  readonly recipientCount: number
  /** When it started. / 开始时刻。 */
  readonly startedAt: number
  /** When it finished. / 结束时刻。 */
  readonly finishedAt?: number
  /** The step outcomes, in order. / 按序的步骤结果。 */
  readonly steps: readonly StepView[]
}

/**
 * The mail service: accepts triggers, runs the chain, and serves the facts.
 *
 * 邮件服务：受理触发、运行链路、并提供事实。
 */
export class MailService {
  /** The durable store. / 持久化存储。 */
  readonly store: MailStore
  /** The channel providers, keyed by the channel they serve. / 按所服务渠道归集的提供方。 */
  readonly providers: Map<ChannelKind, ChannelProvider>

  private readonly queue: string[] = []
  private draining: Promise<void> | undefined

  /**
   * @param store - the durable store / 持久化存储
   * @param providers - the channel providers / 渠道提供方
   */
  constructor(store: MailStore, providers: ReadonlyMap<ChannelKind, ChannelProvider>) {
    this.store = store
    this.providers = new Map(providers)
  }

  /**
   * Accept one trigger: validate it, expand it into per-recipient chains, and
   * start the chain.
   *
   * 受理一次触发：校验、展开为按收件人的执行链、并启动这条链。
   *
   * @param request - the trigger request / 触发请求
   * @returns what the trigger was accepted as / 触发被受理的结果
   */
  async trigger(request: TriggerRequest): Promise<TriggerResult> {
    const workflow = findWorkflow(this.store, request.name)
    const transactionId = request.transactionId ?? randomUUID()
    assertTransactionUnused(this.store, transactionId)
    const acceptance = workflowAcceptance(workflow)
    if (acceptance !== 'PROCESSED') {
      return { transactionId, acceptance, recipientCount: 0 }
    }
    const payload = validatePayload(workflow, request.payload)
    const { subscribers } = resolveRecipients(this.store, request)
    if (subscribers.length === 0) {
      return { transactionId, acceptance: 'INVALID_RECIPIENTS', recipientCount: 0 }
    }
    const now = Date.now()
    const runId = randomUUID()
    await this.store.putRun(buildRun(transactionId as TransactionId, workflow, subscribers.length, runId, now))
    await this.expand(workflow, runId, transactionId as TransactionId, subscribers.map((s) => s.subscriberId), payload, now)
    await this.drain()
    return { transactionId, acceptance: 'PROCESSED', recipientCount: subscribers.length }
  }

  /**
   * Write one chain of steps per recipient and queue the first one.
   *
   * 为每个收件人写下一条步骤链，并把第一个步骤入队。
   *
   * @param workflow - the workflow being delivered / 被投递的工作流
   * @param runId - the execution chain / 执行链
   * @param transactionId - the chain's transaction identifier / 执行链的事务标识
   * @param subscriberIds - the recipients / 收件人
   * @param payload - the business payload / 业务载荷
   * @param now - the current time / 当前时刻
   */
  private async expand(
    workflow: WorkflowRecord,
    runId: string,
    transactionId: TransactionId,
    subscriberIds: readonly string[],
    payload: Readonly<Record<string, unknown>>,
    now: number,
  ): Promise<void> {
    for (const subscriberId of subscriberIds) {
      const jobs = buildJobs(
        workflow, runId, transactionId, subscriberId as JobRecord['subscriberId'],
        payload, randomUUID, now,
      )
      for (const job of jobs) {
        await this.store.putJob(job)
      }
      const first = jobs[0]
      if (first !== undefined) {
        await this.store.putJob({ ...first, state: 'queued' })
        this.queue.push(first.jobId)
      }
    }
  }

  /**
   * Run the queued steps until the queue is empty.
   *
   * The drain is awaited by the trigger that filled the queue, so a caller
   * that has just been accepted can read the chain's outcome without racing
   * the worker. The design's "accepted, not delivered" distinction still
   * holds: the acceptance status says the trigger was taken, and the chain's
   * facts say what happened afterwards.
   *
   * 运行队列中的步骤，直至队列排空。
   *
   * 排空由填充队列的那次触发等待，因此刚被受理的调用方可以读取链路结果而不与执行者赛跑。
   * 设计的「已受理，未投递」区分依然成立：受理状态说明触发已被接收，而链路事实说明其后发生了什么。
   */
  private async drain(): Promise<void> {
    if (this.draining !== undefined) {
      await this.draining
      return
    }
    const running = this.drainQueue()
    this.draining = running
    try {
      await running
    } finally {
      this.draining = undefined
    }
  }

  /**
   * The drain loop itself: take one queued step at a time until none is left.
   *
   * 排空循环本身：每次取一个排队的步骤，直至队列为空。
   */
  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const jobId = this.queue.shift()
      if (jobId === undefined) break
      await this.runStep(jobId)
    }
  }

  /**
   * Run one step: claim it, judge it, deliver it, and advance the chain.
   *
   * 运行一个步骤：领取、判定、投递、并推进执行链。
   *
   * @param jobId - the step to run / 待运行的步骤
   */
  private async runStep(jobId: string): Promise<void> {
    const workerId = randomUUID()
    const claimed = await claimJob(this.store, jobId, workerId, Date.now())
    if (claimed === undefined) return
    const workflow = this.store.workflows().find((candidate) => candidate.workflowId === claimed.workflowId)
    if (workflow === undefined) return
    try {
      const outcome = await this.deliver(claimed, workflow)
      await this.finishStep(claimed, outcome)
    } catch (error: unknown) {
      await this.failStep(claimed, asMailError(error))
    }
  }

  /**
   * Judge one step's conditions and hand it to the delivery layer.
   *
   * 判定一个步骤的条件，并把它交给投递层。
   *
   * @param job - the claimed step / 已领取的步骤
   * @param workflow - the workflow it came from / 它所属的工作流
   * @returns the delivery outcome / 投递结论
   */
  private async deliver(job: JobRecord, workflow: WorkflowRecord): Promise<DeliveryOutcome> {
    const conditions = evaluateConditions(
      workflow.steps.find((step) => step.stepId === job.stepId)?.filters,
      { payload: job.payload },
    )
    return deliverStep({
      job,
      workflow,
      store: this.store,
      providers: this.providers,
      newMessageId: randomUUID,
      now: Date.now(),
    }, conditions)
  }

  /**
   * Commit a step's delivery outcome and advance its chain.
   *
   * 提交步骤的投递结果并推进其执行链。
   *
   * @param job - the claimed step / 已领取的步骤
   * @param outcome - what the delivery concluded / 投递结论
   */
  private async finishStep(job: JobRecord, outcome: DeliveryOutcome): Promise<void> {
    const state = outcome.outcome === 'sent'
      ? 'completed'
      : outcome.outcome === 'skipped' ? 'skipped' : 'failed'
    const committed = await commitJob(this.store, job, {
      jobId: job.jobId,
      state,
      retryable: outcome.outcome === 'failed' ? outcome.retryable : false,
      ...(outcome.outcome === 'skipped' ? { skipReason: outcome.reason } : {}),
    })
    if (state === 'failed' && outcome.outcome === 'failed' && outcome.retryable && mayRetry(committed)) {
      this.queue.push(committed.jobId)
      return
    }
    await this.advance(committed)
  }

  /**
   * Mark a step failed after an unexpected error.
   *
   * 在意外错误后把步骤标记为失败。
   *
   * @param job - the claimed step / 已领取的步骤
   * @param error - the failure / 失败
   */
  private async failStep(job: JobRecord, error: ReturnType<typeof asMailError>): Promise<void> {
    await commitJob(this.store, job, {
      jobId: job.jobId,
      state: 'failed',
      retryable: error.retryable,
    })
  }

  /**
   * Advance a chain past a finished step: enqueue the next step, or close the
   * chain when there is none.
   *
   * 把执行链推进过已结束的步骤：入队下一步骤，没有则关闭该链。
   *
   * @param job - the finished step / 已结束的步骤
   */
  private async advance(job: JobRecord): Promise<void> {
    const following = nextJob(this.store, job)
    if (following !== undefined) {
      await this.store.putJob({ ...following, state: 'queued' })
      this.queue.push(following.jobId)
      return
    }
    const run = this.store.getRun(job.runId)
    if (run === undefined) return
    if (!isChainComplete(this.store, run)) return
    await this.store.putRun({ ...run, status: terminalRunStatus(this.store, run), finishedAt: Date.now() })
  }

  /**
   * Cancel one execution chain.
   *
   * 取消一条执行链。
   *
   * @param transactionId - the chain's transaction identifier / 执行链的事务标识
   * @returns how many steps were cancelled / 被取消的步骤数
   */
  async cancel(transactionId: string): Promise<{ readonly canceledJobs: number }> {
    const run = this.store.runs().find((candidate) => candidate.transactionId === transactionId)
    if (run === undefined) return { canceledJobs: 0 }
    return { canceledJobs: await cancelRun(this.store, run.runId) }
  }

  /** Every message, newest first. / 全部消息，最新在前。 */
  listMessages(): MessageView[] {
    return this.store.messages()
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((message) => this.toMessageView(message))
  }

  /** Every execution chain, newest first, with its steps. / 全部执行链，最新在前，附带其步骤。 */
  listRuns(): RunView[] {
    return this.store.runs()
      .sort((left, right) => right.startedAt - left.startedAt)
      .map((run) => this.toRunView(run))
  }

  /**
   * Project one execution chain into the panel's view.
   *
   * 把一条执行链投影成面板的视图。
   *
   * @param run - the execution chain / 执行链
   * @returns the panel's view / 面板的视图
   */
  private toRunView(run: RunRecord): RunView {
    const workflow = this.store.workflows().find((candidate) => candidate.workflowId === run.workflowId)
    const steps = this.store.jobs()
      .filter((job) => job.runId === run.runId)
      .sort((left, right) => left.sequence - right.sequence)
      .map((job) => ({
        jobId: job.jobId,
        subscriberId: job.subscriberId,
        stepId: job.stepId,
        state: job.state,
        ...(job.skipReason === undefined ? {} : { skipReason: job.skipReason }),
      }))
    return {
      runId: run.runId,
      transactionId: run.transactionId,
      workflowName: workflow?.name ?? run.workflowId,
      status: run.status,
      recipientCount: run.recipientCount,
      startedAt: run.startedAt,
      ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
      steps,
    }
  }

  /**
   * The steps of one recipient's chain.
   *
   * 某收件人执行链的步骤。
   *
   * @param runId - the execution chain / 执行链
   * @param subscriberId - the recipient / 收件人
   * @returns the chain's steps / 该链的步骤
   */
  stepsOf(runId: string, subscriberId: string): JobRecord[] {
    return chainJobs(this.store, runId, subscriberId)
  }

  /**
   * Change one message's visible state.
   *
   * `seen` and `read` are independent flags: a message that was seen but not
   * read still counts as unread, and marking one does not mark the other.
   * The operation is per-item and idempotent — a message already in the
   * target state is left as it is.
   *
   * 改变一条消息的可见状态。
   *
   * `seen` 与 `read` 是彼此独立的标志：已看到但未读的消息仍算未读，标记其一不影响另一个。
   * 该操作逐条且幂等——已处于目标状态的消息保持原样。
   *
   * @param messageId - the message / 消息
   * @param action - what to change / 要改变什么
   * @returns the updated view, when the message exists / 更新后的视图（消息存在时）
   */
  async markMessage(
    messageId: string,
    action: 'read' | 'unread' | 'archive' | 'unarchive',
  ): Promise<MessageView | undefined> {
    const message = this.store.getMessage(messageId)
    if (message === undefined) return undefined
    const updated: MessageRecord = {
      ...message,
      seen: action === 'read' ? true : message.seen,
      read: action === 'read' ? true : action === 'unread' ? false : message.read,
      archived: action === 'archive' ? true : action === 'unarchive' ? false : message.archived,
    }
    await this.store.putMessage(updated)
    return this.toMessageView(updated)
  }

  /**
   * Project one stored message into the panel's view.
   *
   * 把一条已存储消息投影成面板的视图。
   *
   * @param message - the stored message / 已存储的消息
   * @returns the panel's view / 面板的视图
   */
  private toMessageView(message: MessageRecord): MessageView {
    return {
      messageId: message.messageId,
      subscriberId: message.subscriberId,
      channel: message.channel,
      ...(message.subject === undefined ? {} : { subject: message.subject }),
      content: message.content,
      status: message.status,
      seen: message.seen,
      read: message.read,
      archived: message.archived,
      createdAt: message.createdAt,
    }
  }
}
