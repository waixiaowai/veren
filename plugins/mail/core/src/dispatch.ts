/**
 * The dispatcher: it guarantees each recipient walks exactly the steps they
 * are due, no more and no fewer.
 *
 * Two rules carry the whole module:
 *
 * - **Claiming is ownership.** A step moves from `queued` to `running` by a
 *   compare-and-set. The loser of the race abandons the step rather than
 *   fighting for it — a re-delivered queue entry must not run the same step
 *   twice. A lease bounds the winner's ownership: a step whose lease expired
 *   is no longer that worker's to finish.
 * - **Advancement is unique.** Only this module decides what runs next.
 *   Another module holding a step identifier still may not enqueue the
 *   following step.
 *
 * The state machine the design fixes:
 *
 * ```
 * pending → queued → running → completed | failed | skipped
 *                       ├──→ delayed → queued
 *                       └──→ merged
 * ```
 *
 * 编排层：保证每个收件人恰好走完该走的步骤，不多不少。
 *
 * 两条规则承载整个模块：
 *
 * - **领取即所有权。** 步骤由比较并交换从 `queued` 转为 `running`。竞态的败方放弃该步骤而不
 *   争抢——被重投的排队单元绝不能让同一步骤跑两次。租约为胜方划定所有权边界：租约过期的步骤
 *   已不属于该执行者。
 * - **推进权唯一。** 只有本模块决定下一个跑什么。别的模块即便持有步骤标识也不得入队下一步。
 *
 * @module @veren/mail/dispatch
 */

import { mailError } from './errors.ts'
import type { MailStore } from './store.ts'
import type {
  JobRecord,
  JobState,
  RunRecord,
  SkipReason,
  TransactionId,
  WorkflowRecord,
  WorkflowStep,
} from './types.ts'

/** How long a claimed step may run before the lease expires. / 被领取步骤在租约过期前可运行的时长。 */
export const LEASE_MS = 30_000

/** How many times one step may be attempted. / 一个步骤最多尝试次数。 */
export const MAX_ATTEMPTS = 3

/** The backoff base for a retry, in milliseconds. / 重试的退避基数（毫秒）。 */
export const RETRY_BACKOFF_MS = 1_000

/**
 * The outcome of one step's execution.
 *
 * 一个步骤执行的结果。
 */
export interface StepOutcome {
  /** The step that ran. / 执行了的步骤。 */
  readonly jobId: string
  /** Where the step ended up. / 步骤的最终状态。 */
  readonly state: Extract<JobState, 'completed' | 'failed' | 'skipped' | 'delayed' | 'merged' | 'canceled'>
  /** Why the step was skipped, when it was. / 步骤被跳过的原因（若被跳过）。 */
  readonly skipReason?: SkipReason
  /** Whether the caller should try the step again. / 调用方是否应重试该步骤。 */
  readonly retryable: boolean
}

/**
 * The step instances one recipient's chain holds, in order.
 *
 * 一个收件人执行链所持有的步骤实例，按顺序排列。
 *
 * @param workflow - the workflow being delivered / 被投递的工作流
 * @param runId - the execution chain / 执行链
 * @param transactionId - the chain's transaction identifier / 执行链的事务标识
 * @param subscriberId - the recipient / 收件人
 * @param payload - the business payload / 业务载荷
 * @param jobId - the identifier generator / 标识生成器
 * @param now - the current time / 当前时刻
 * @returns the step instances, all pending / 全部处于 pending 的步骤实例
 */
export function buildJobs(
  workflow: WorkflowRecord,
  runId: string,
  transactionId: TransactionId,
  subscriberId: string,
  payload: Readonly<Record<string, unknown>>,
  jobId: () => string,
  now: number,
): JobRecord[] {
  return workflow.steps.map((step, index) => ({
    jobId: jobId() as JobRecord['jobId'],
    runId: runId as JobRecord['runId'],
    transactionId,
    workflowId: workflow.workflowId,
    subscriberId: subscriberId as JobRecord['subscriberId'],
    stepId: step.stepId,
    stepType: step.type,
    state: 'pending' as const,
    attempts: 0,
    deferredCount: 0,
    payload,
    sequence: index,
    createdAt: now,
  }))
}

/**
 * Claim one step for a worker.
 *
 * The claim is a compare-and-set on the stored state: the worker that
 * observes `queued` moves it to `running` and takes the lease. A worker that
 * observes anything else — already running, already finished — gets nothing
 * and abandons the step, because the step is somebody else's now.
 *
 * 领取一个步骤。
 *
 * 领取是对已存状态的一次比较并交换：观察到 `queued` 的执行者把它转为 `running` 并取得租约。
 * 观察到其他状态——已在运行、已结束——的执行者什么也得不到并放弃该步骤，因为该步骤已属于别人。
 *
 * @param store - the durable store / 持久化存储
 * @param jobId - the step to claim / 待领取的步骤
 * @param workerId - the claiming worker / 领取的执行者
 * @param now - the current time / 当前时刻
 * @returns the claimed step, or undefined when the claim was lost / 已领取的步骤；领取失败时为 undefined
 */
export async function claimJob(
  store: MailStore,
  jobId: string,
  workerId: string,
  now: number,
): Promise<JobRecord | undefined> {
  const job = store.getJob(jobId)
  if (job === undefined) return undefined
  if (job.state !== 'queued' && job.state !== 'pending') return undefined
  if (job.leaseExpiresAt !== undefined && job.leaseExpiresAt > now && job.leaseOwner !== workerId) {
    return undefined
  }
  const claimed: JobRecord = {
    ...job,
    state: 'running',
    attempts: job.attempts + 1,
    leaseOwner: workerId,
    leaseExpiresAt: now + LEASE_MS,
  }
  await store.putJob(claimed)
  const stored = store.getJob(jobId)
  if (stored === undefined || stored.leaseOwner !== workerId) return undefined
  return stored
}

/**
 * Commit a step's outcome, and report what the chain should do next.
 *
 * The write is the only place a step's terminal state is set. The caller
 * then advances the chain — this module, and only this module, decides that.
 *
 * 提交步骤的执行结果，并报告执行链下一步该做什么。
 *
 * 这次写入是步骤终态的唯一设定处。随后由调用方推进执行链——只有本模块、且仅本模块决定推进。
 *
 * @param store - the durable store / 持久化存储
 * @param job - the step being committed / 被提交的步骤
 * @param outcome - what happened / 执行结果
 * @returns the committed step / 已提交的步骤
 */
export async function commitJob(
  store: MailStore,
  job: JobRecord,
  outcome: StepOutcome,
): Promise<JobRecord> {
  const committed: JobRecord = {
    ...job,
    state: outcome.state,
    ...(outcome.skipReason === undefined ? {} : { skipReason: outcome.skipReason }),
    ...(outcome.state === 'completed' || outcome.state === 'failed'
      ? { leaseOwner: undefined, leaseExpiresAt: undefined }
      : {}),
  }
  await store.putJob(committed)
  return committed
}

/**
 * The step that follows the given one in its recipient's chain.
 *
 * 给定步骤之后、同一收件人执行链中的下一步骤。
 *
 * @param store - the durable store / 持久化存储
 * @param job - the step that just finished / 刚结束的步骤
 * @returns the next step, or undefined when the chain is done / 下一步骤；链已走完时为 undefined
 */
export function nextJob(store: MailStore, job: JobRecord): JobRecord | undefined {
  return store.jobs()
    .filter((candidate) => candidate.runId === job.runId && candidate.subscriberId === job.subscriberId)
    .filter((candidate) => candidate.sequence === job.sequence + 1)
    .sort((left, right) => left.sequence - right.sequence)[0]
}

/**
 * Every step of one recipient's chain, in order.
 *
 * 某收件人执行链的全部步骤，按顺序排列。
 *
 * @param store - the durable store / 持久化存储
 * @param runId - the execution chain / 执行链
 * @param subscriberId - the recipient / 收件人
 * @returns the chain's steps / 该链的步骤
 */
export function chainJobs(
  store: MailStore,
  runId: string,
  subscriberId: string,
): JobRecord[] {
  return store.jobs()
    .filter((job) => job.runId === runId && job.subscriberId === subscriberId)
    .sort((left, right) => left.sequence - right.sequence)
}

/**
 * Whether a chain has finished: every one of its steps reached a terminal
 * state, and no step is still waiting to run.
 *
 * 执行链是否已结束：全部步骤都到达终态，且没有步骤仍在等待运行。
 *
 * @param store - the durable store / 持久化存储
 * @param run - the execution chain / 执行链
 * @returns whether the chain is done / 该链是否已结束
 */
export function isChainComplete(store: MailStore, run: RunRecord): boolean {
  const jobs = store.jobs().filter((job) => job.runId === run.runId)
  if (jobs.length === 0) return true
  return jobs.every((job) => TERMINAL_STATES.has(job.state))
}

/** The states a step never leaves. / 步骤永不离开的状态。 */
const TERMINAL_STATES: ReadonlySet<JobState> = new Set<JobState>([
  'completed', 'failed', 'skipped', 'canceled', 'merged',
])

/**
 * The run status a finished chain takes on: an error if any step failed, a
 * skip if every step was skipped, a delivery otherwise.
 *
 * 已结束执行链的运行状态：任一步骤失败即错误，全部跳过即跳过，否则为已投递。
 *
 * @param store - the durable store / 持久化存储
 * @param run - the execution chain / 执行链
 * @returns the chain's terminal status / 该链的终态
 */
export function terminalRunStatus(store: MailStore, run: RunRecord): RunRecord['status'] {
  const jobs = store.jobs().filter((job) => job.runId === run.runId)
  if (jobs.some((job) => job.state === 'failed')) return 'errored'
  if (jobs.length > 0 && jobs.every((job) => job.state === 'skipped' || job.state === 'canceled')) {
    return 'skipped'
  }
  return 'delivered'
}

/**
 * The delay before a failed step is retried: exponential in the attempt
 * count, with a jitter so a batch of failures does not retry in lockstep.
 *
 * 失败步骤重试前的延迟：随尝试次数指数增长，并带抖动，使一批失败不会齐步重试。
 *
 * @param attempts - how many attempts have been made / 已尝试次数
 * @param jitter - a random value in [0,1) / [0,1) 区间内的随机值
 * @returns the delay in milliseconds / 延迟（毫秒）
 */
export function retryDelayMs(attempts: number, jitter: number): number {
  const backoff = RETRY_BACKOFF_MS * 2 ** Math.max(0, attempts - 1)
  return Math.round(backoff * (1 + jitter))
}

/**
 * Whether a failed step may be attempted again. The budget is per step, not
 * per recipient: three tries, then the step is terminal.
 *
 * 失败步骤是否还可再试。预算按步骤计而非按收件人累加：三次之后该步骤即入终态。
 *
 * @param job - the failed step / 失败的步骤
 * @returns whether another attempt is allowed / 是否允许再试
 */
export function mayRetry(job: JobRecord): boolean {
  return job.attempts < MAX_ATTEMPTS
}

/**
 * Cancel every step of one execution chain that has not yet run.
 *
 * Cancelling is idempotent: a second cancel of the same chain cancels nothing
 * and reports zero, rather than failing.
 *
 * 取消一条执行链中尚未运行的全部步骤。
 *
 * 取消是幂等的：同一条链第二次取消不取消任何东西并报告零，而不是失败。
 *
 * @param store - the durable store / 持久化存储
 * @param runId - the execution chain / 执行链
 * @returns how many steps were cancelled / 被取消的步骤数
 */
export async function cancelRun(store: MailStore, runId: string): Promise<number> {
  let cancelled = 0
  for (const job of store.jobs()) {
    if (job.runId !== runId) continue
    if (TERMINAL_STATES.has(job.state)) continue
    await store.putJob({ ...job, state: 'canceled', leaseOwner: undefined, leaseExpiresAt: undefined })
    cancelled += 1
  }
  return cancelled
}

/**
 * The step definition a step instance came from.
 *
 * 步骤实例所来自的步骤定义。
 *
 * @param workflow - the workflow / 工作流
 * @param job - the step instance / 步骤实例
 * @returns the step definition / 步骤定义
 */
export function stepOf(workflow: WorkflowRecord, job: JobRecord): WorkflowStep | undefined {
  return workflow.steps.find((step) => step.stepId === job.stepId)
}

/**
 * Raise a structured error for a chain whose next step cannot be found. A
 * broken chain is a server-side fault, not a caller mistake, so it is
 * retryable.
 *
 * 为找不到下一步骤的执行链抛出结构化错误。链断裂是服务端故障而非调用方失误，因此可重试。
 *
 * @param job - the step that finished / 刚结束的步骤
 * @returns never; the call always throws / 永不返回；调用必定抛出
 */
export function chainBroken(job: JobRecord): never {
  throw mailError(
    'MAIL_DISPATCH_CHAIN_BROKEN',
    `mail: the chain of step '${job.jobId}' has no following step to advance to`,
    { jobId: job.jobId, runId: job.runId },
  )
}
