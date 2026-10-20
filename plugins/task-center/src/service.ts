/**
 * TaskCenterService: the host-level persistent work queue + personal inbox.
 *
 * Every mutation runs on one FIFO write chain (§4.4: 每次迁移都在一个串行写链里完成).
 * Expiry and lease recycling are lazy — evaluated from `expiresAt` / `leaseUntil`
 * at the head of every operation; there is no background timer. Completion and
 * failure are idempotent: a task already terminal returns its first outcome
 * unchanged. Task targets store the canonical URL only; session attribution is
 * the page runtime's job (session C).
 *
 * 任务中心：宿主级持久工作队列 + 个人收件箱。
 *
 * 所有迁移都在一条 FIFO 串行写链上完成（§4.4）。过期与租约回收是懒判定——每次操作开头按
 * `expiresAt` / `leaseUntil` 现算，没有后台定时器。complete/fail 幂等：任务已到终态时原样
 * 返回首次结果。任务目标只存规范 URL；会话归属由页面运行时（会话 C）解析。
 *
 * @module @veren/task-center/service
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TASK_CENTER_DOMAIN_NAME, taskCenterDomain, view } from './storage.ts'
import type { DeliveryRecord, InboxNotice, TaskCenterStore } from './storage.ts'
import { registerTaskTools } from './tools.ts'
import { TaskErrorCode } from './types.ts'
import type {
  TaskCenterContract, TaskDraft, TaskFailure, TaskId, TaskQuery, TaskRecord, TaskResult,
} from './types.ts'

/** 服务名（ctx.taskCenter / inject 'taskCenter'）/ service name */
export const TASK_CENTER_NAME = 'taskCenter'

/** Title limit (§4.2) / 标题长度上限 */
export const MAX_TITLE_CHARS = 200
/** Body limit; the full body belongs to the app's own storage. / 正文上限；完整正文放应用自己的存储 */
export const MAX_BODY_CHARS = 4000

/**
 * App facts the task center needs, resolved lazily so this package never
 * imports session A's implementation.
 * 任务中心需要的应用事实，惰性解析，本包绝不 import 会话 A 的实现。
 */
export interface AppSnapshot {
  readonly state: 'active' | 'disabled' | 'broken'
  readonly version: string
  readonly pageRevision?: number
}

/** Delayed app lookup; the host (or session A) wires it via {@link setAppResolver}. */
export type AppResolver = (appId: string) => Promise<AppSnapshot | undefined>

/** One structured refusal: a stable code plus a readable account. */
export class TaskError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'TaskError'
  }
}

/** Config schema (AGENTS: 插件必须用 schemastery 定义 config). */
export type TaskCenterConfig = { tools: { enabled: boolean } }
export const Config: z<TaskCenterConfig> = z.object({
  tools: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
})

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A task durably changed state (sent, taken, renewed, released, expired…). @mode emit */
    'task-center/changed'(payload: { taskId: TaskId; action: string }): void
    /** A task reached `done`; apps subscribe to report back. @mode emit */
    'task-center/completed'(payload: {
      taskId: TaskId
      appId: string
      result: TaskResult
      sessionId?: string
    }): void
  }
}

const TERMINAL: ReadonlySet<TaskRecord['status']>
  = new Set(['done', 'failed', 'expired', 'cancelled', 'orphaned'])

function isPast(instant: string | undefined, now: number): boolean {
  if (instant === undefined) return false
  const at = Date.parse(instant)
  return !Number.isNaN(at) && at <= now
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export class TaskCenterService extends Service implements TaskCenterContract {
  static inject = ['storageDomain', 'tools']
  static Config = Config

  private readonly host: Context
  private readonly ready: Promise<TaskCenterStore | undefined>
  private storageFailure: string | undefined
  private chain: Promise<unknown> = Promise.resolve()
  private resolver: AppResolver | undefined

  constructor(ctx: Context, config: TaskCenterConfig = { tools: { enabled: true } }) {
    super(ctx, TASK_CENTER_NAME)
    this.host = ctx
    this.ready = this.openDomain()
    if (config.tools.enabled) registerTaskTools(ctx, () => this)
  }

  async [Service.init](): Promise<void> {
    await this.ready
  }

  /** Wire the app registry explicitly — app-host does this at assembly time.
   *  Unset, send degrades to warn-and-pass and no orphan sweep runs. */
  setAppResolver(resolver: AppResolver | undefined): void {
    this.resolver = resolver
  }

  async send(draft: TaskDraft): Promise<TaskRecord> {
    return this.write(async (domain) => {
      await this.sweep(domain)
      const tasks = view(domain.table('tasks'))
      this.validateDraft(draft)
      if (draft.idempotencyKey !== undefined) {
        const seen = tasks.all().find(row =>
          row.appId === draft.target.appId && row.idempotencyKey === draft.idempotencyKey)
        if (seen !== undefined) return seen
      }
      await this.checkSender(draft.target.appId)
      const snapshot = await this.resolver?.(draft.target.appId)
      const now = new Date().toISOString()
      const record: TaskRecord = {
        id: newId('task') as TaskId,
        appId: draft.target.appId,
        kind: draft.kind,
        title: draft.title.trim(),
        ...(draft.body === undefined ? {} : { body: draft.body }),
        target: draft.target,
        appVersion: snapshot?.version ?? 'unknown',
        pageRevision: snapshot?.pageRevision ?? 0,
        assignee: 'local',
        status: 'open',
        revision: 1,
        createdAt: now,
        updatedAt: now,
        ...(draft.dueAt === undefined ? {} : { dueAt: draft.dueAt }),
        ...(draft.expiresAt === undefined ? {} : { expiresAt: draft.expiresAt }),
        ...(draft.origin === undefined ? {} : { origin: draft.origin }),
        ...(draft.idempotencyKey === undefined ? {} : { idempotencyKey: draft.idempotencyKey }),
        schemaVersion: 1,
      }
      await tasks.put(record.id, record)
      const delivery: DeliveryRecord = {
        id: newId('notice'),
        taskId: record.id,
        recipient: 'local',
        mode: 'inbox',
        state: 'pending',
        attempts: 0,
        createdAt: now,
      }
      await view(domain.table('deliveries')).put(delivery.id, delivery)
      this.host.emit('task-center/changed', { taskId: record.id, action: 'sent' })
      return record
    })
  }

  async list(query: TaskQuery): Promise<readonly TaskRecord[]> {
    return this.write(async (domain) => {
      await this.sweep(domain)
      return view(domain.table('tasks')).all().filter(row =>
        (query.appId === undefined || row.appId === query.appId)
        && (query.status === undefined || row.status === query.status)
        && (query.assignee === undefined || row.assignee === query.assignee))
    })
  }

  async get(id: TaskId): Promise<TaskRecord | undefined> {
    return this.write(async (domain) => {
      await this.sweep(domain)
      return view(domain.table('tasks')).get(id)
    })
  }

  async take(id: TaskId, claim: Parameters<TaskCenterContract['take']>[1]): Promise<TaskRecord> {
    return this.write(async (domain) => {
      await this.sweep(domain)
      const record = this.require(view(domain.table('tasks')).get(id))
      const sameClaimant = record.status === 'taken' && record.claimedBy !== undefined
        && record.claimedBy.actor === claim.actor && record.claimedBy.sessionId === claim.sessionId
      if (record.status === 'taken' && !sameClaimant && !isPast(record.claimedBy?.leaseUntil, Date.now())) {
        throw new TaskError(TaskErrorCode.AlreadyTaken, `task ${id} is taken until ${record.claimedBy?.leaseUntil}`)
      }
      if (record.status === 'orphaned') {
        throw new TaskError('task/orphaned', `task ${id} belongs to an uninstalled app`)
      }
      // 已被懒过期判定翻成 expired 的任务不可接取 / a lazily expired task is not claimable
      if (record.status === 'expired') {
        throw new TaskError(TaskErrorCode.Expired, `task ${id} expired at ${record.expiresAt}`)
      }
      // 续租（同一接取者幂等续约）或首次接取；其余状态不可接取 / renew (idempotent) or first take
      if (record.status !== 'open' && !sameClaimant) {
        throw new TaskError('task/invalid-state', `task ${id} is ${record.status}, not claimable`)
      }
      if (!sameClaimant && claim.sessionId !== undefined) this.assertNoActiveOnUrl(domain, record, claim.sessionId)
      const next: TaskRecord = {
        ...record,
        status: 'taken',
        revision: record.revision + 1,
        updatedAt: new Date().toISOString(),
        claimedBy: { sessionId: claim.sessionId, actor: claim.actor, leaseUntil: claim.leaseUntil },
      }
      await view(domain.table('tasks')).put(id, next)
      this.host.emit('task-center/changed', { taskId: id, action: sameClaimant ? 'renewed' : 'taken' })
      return next
    })
  }

  async release(id: TaskId, reason: string): Promise<TaskRecord> {
    return this.write(async (domain) => {
      await this.sweep(domain)
      const tasks = view(domain.table('tasks'))
      const record = this.require(tasks.get(id))
      if (record.status !== 'taken') {
        throw new TaskError('task/invalid-state', `task ${id} is ${record.status}; only taken tasks can be released`)
      }
      // claimedBy 是 readonly：用解构摘除该键，不用 as 断言 / destructure to drop the key, no cast
      const { claimedBy: _dropped, ...kept } = record
      const next: TaskRecord = {
        ...kept,
        status: 'open',
        revision: record.revision + 1,
        updatedAt: new Date().toISOString(),
      }
      await tasks.put(id, next)
      this.host.emit('task-center/changed', { taskId: id, action: `released:${reason}` })
      return next
    })
  }

  async complete(id: TaskId, result: TaskResult): Promise<TaskRecord> {
    return this.write(async (domain) => {
      await this.sweep(domain)
      const tasks = view(domain.table('tasks'))
      const record = this.require(tasks.get(id))
      if (record.status === 'done') return record
      if (record.status !== 'taken') {
        throw new TaskError('task/invalid-state', `task ${id} is ${record.status}; only taken tasks can complete`)
      }
      if (result.summary.trim().length === 0) {
        throw new TaskError(TaskErrorCode.DraftInvalid, 'result.summary is required')
      }
      const sessionId = record.claimedBy?.sessionId
      const next: TaskRecord = {
        ...record,
        status: 'done',
        result: {
          summary: result.summary,
          ...(result.artifacts === undefined ? {} : { artifacts: result.artifacts }),
        },
        revision: record.revision + 1,
        updatedAt: new Date().toISOString(),
      }
      await tasks.put(id, next)
      this.host.emit('task-center/completed', { taskId: id, appId: record.appId, result: next.result!, sessionId })
      return next
    })
  }

  async fail(id: TaskId, failure: TaskFailure): Promise<TaskRecord> {
    return this.write(async (domain) => {
      await this.sweep(domain)
      const tasks = view(domain.table('tasks'))
      const record = this.require(tasks.get(id))
      if (record.status === 'failed') return record
      if (record.status !== 'taken') {
        throw new TaskError('task/invalid-state', `task ${id} is ${record.status}; only taken tasks can fail`)
      }
      const next: TaskRecord = {
        ...record,
        status: 'failed',
        failure,
        revision: record.revision + 1,
        updatedAt: new Date().toISOString(),
      }
      await tasks.put(id, next)
      this.host.emit('task-center/changed', { taskId: id, action: `failed:${failure.code}` })
      return next
    })
  }

  async cancel(id: TaskId, reason: string): Promise<TaskRecord> {
    return this.write(async (domain) => {
      await this.sweep(domain)
      const tasks = view(domain.table('tasks'))
      const record = this.require(tasks.get(id))
      if (TERMINAL.has(record.status)) {
        throw new TaskError('task/invalid-state', `task ${id} is already ${record.status}`)
      }
      if (record.status === 'taken') {
        throw new TaskError('task/invalid-state', `task ${id} is taken; release it before cancelling`)
      }
      const next: TaskRecord = {
        ...record,
        status: 'cancelled',
        revision: record.revision + 1,
        updatedAt: new Date().toISOString(),
      }
      await tasks.put(id, next)
      this.host.emit('task-center/changed', { taskId: id, action: `cancelled:${reason}` })
      return next
    })
  }

  /**
   * 投递接缝（会话 C 调这里）/ Delivery seam for session C.
   *
   * Returns every `pending` inbox notice whose task is still deliverable
   * (`open`/`taken`), each with the rendered inbox text to inject as a user
   * message on session start or the next pre-step. Notices whose task reached
   * `done`/`cancelled`/`expired` are flipped to `read` here (§4.5); `orphaned`
   * tasks stay `pending` but are no longer returned (不再投递).
   * 返回所有可投递的 pending 收件箱通知（含渲染好的注入文本），供 C 在会话启动或下一轮
   * pre-step 时作为用户消息注入。终态任务的通知在此翻成 `read`；`orphaned` 的保持 pending
   * 但不再返回。
   */
  async pendingDeliveries(): Promise<readonly InboxNotice[]> {
    return this.write(async (domain) => {
      await this.sweep(domain)
      const tasks = view(domain.table('tasks'))
      const deliveries = view(domain.table('deliveries'))
      const notices: InboxNotice[] = []
      for (const row of deliveries.all()) {
        if (row.state !== 'pending') continue
        const task = tasks.get(row.taskId)
        if (task === undefined) continue
        if (task.status === 'done' || task.status === 'cancelled' || task.status === 'expired') {
          await deliveries.put(row.id, { ...row, state: 'read', lastAt: new Date().toISOString() })
          continue
        }
        if (task.status !== 'open' && task.status !== 'taken') continue
        notices.push({ deliveryId: row.id, task, text: noticeText(task) })
      }
      return notices
    })
  }

  /**
   * Session C reports the outcome of one delivery attempt: success flips the
   * row to `delivered`; a failure keeps it `pending` with attempts + 1
   * (§4.5: 投递失败不等于任务失败).
   * 会话 C 回报一次投递的结果：成功翻 `delivered`；失败保持 `pending` 并把 attempts + 1。
   */
  async markDelivered(deliveryId: string, error?: string): Promise<DeliveryRecord | undefined> {
    return this.write(async (domain) => {
      const deliveries = view(domain.table('deliveries'))
      const row = deliveries.get(deliveryId)
      if (row === undefined) return undefined
      const now = new Date().toISOString()
      const next: DeliveryRecord = error === undefined
        ? { ...row, state: 'delivered', attempts: row.attempts + 1, lastAt: now }
        : { ...row, attempts: row.attempts + 1, lastAt: now, lastError: error }
      await deliveries.put(deliveryId, next)
      return next
    })
  }

  /**
   * Uninstall semantics (§7.4): mark every open/taken task of `appId`
   * `orphaned` — records are kept, never deleted. Disable needs no storage
   * action: `send` is refused via the resolver and leases recycle lazily.
   * 卸载语义（§7.4）：该应用的 open/taken 任务全部标 `orphaned`——只保留，不删除。禁用不需要
   * 存储动作：send 走 resolver 拒绝，租约懒回收。
   */
  async markAppOrphaned(appId: string, reason: string): Promise<readonly TaskRecord[]> {
    return this.write(async (domain) => {
      const tasks = view(domain.table('tasks'))
      const now = new Date().toISOString()
      const changed: TaskRecord[] = []
      for (const row of tasks.all()) {
        if (row.appId !== appId || (row.status !== 'open' && row.status !== 'taken')) continue
        // claimedBy 是 readonly：用解构摘除该键，不用 as 断言 / destructure to drop the key, no cast
        const { claimedBy: _dropped, ...kept } = row
        const next: TaskRecord = { ...kept, status: 'orphaned', revision: row.revision + 1, updatedAt: now }
        await tasks.put(row.id, next)
        changed.push(next)
      }
      this.host.emit('task-center/changed', {
        taskId: (changed[0]?.id ?? '') as TaskId,
        action: `orphaned:${reason}`,
      })
      return changed
    })
  }

  // ---- internals ----

  private validateDraft(draft: TaskDraft): void {
    const title = draft.title.trim()
    if (title.length === 0 || title.length > MAX_TITLE_CHARS) {
      throw new TaskError(TaskErrorCode.DraftInvalid, `title must be 1..${MAX_TITLE_CHARS} chars`)
    }
    if (draft.body !== undefined && draft.body.length > MAX_BODY_CHARS) {
      throw new TaskError(TaskErrorCode.DraftInvalid, `body exceeds ${MAX_BODY_CHARS} chars`)
    }
    const { url, appId, page } = draft.target
    if (url.length === 0 || appId.length === 0 || page.length === 0) {
      throw new TaskError(TaskErrorCode.DraftInvalid, 'target.url/appId/page are required')
    }
    for (const key of ['expiresAt', 'dueAt'] as const) {
      const value = draft[key]
      if (value === undefined) continue
      if (Number.isNaN(Date.parse(value))) {
        throw new TaskError(TaskErrorCode.DraftInvalid, `${key} is not a valid ISO instant`)
      }
    }
    if (draft.expiresAt !== undefined && Date.parse(draft.expiresAt) <= Date.now()) {
      throw new TaskError(TaskErrorCode.DraftInvalid, 'expiresAt must be in the future')
    }
  }

  /** Sender check via the lazily wired resolver; without a resolver we only warn. */
  private async checkSender(appId: string): Promise<void> {
    const resolver = this.resolver
    if (resolver === undefined) {
      this.host.logger.warn(`taskCenter: no app resolver wired; sender "${appId}" accepted without registry check`)
      return
    }
    const snapshot = await resolver(appId)
    if (snapshot === undefined) {
      throw new TaskError(TaskErrorCode.SendForbidden, `app "${appId}" is not registered`)
    }
    if (snapshot.state !== 'active') {
      throw new TaskError(TaskErrorCode.SendForbidden, `app "${appId}" is ${snapshot.state}`)
    }
  }

  private assertNoActiveOnUrl(domain: TaskCenterStore, record: TaskRecord, sessionId: string): void {
    const clash = view(domain.table('tasks')).all().find(row =>
      row.id !== record.id && row.target.url === record.target.url && row.status === 'taken'
      && row.claimedBy?.sessionId === sessionId)
    if (clash !== undefined) {
      throw new TaskError(
        TaskErrorCode.AnotherActive,
        `session already holds active task ${clash.id} on ${record.target.url}`,
      )
    }
  }

  /**
   * Lazy sweep: expire past-deadline opens, recycle past-lease takens (§4.4,
   * §7.5), and mark open/taken tasks of an unregistered app `orphaned` (§7.4
   * 卸载语义，懒执行：注册表里已经查不到的应用在下次操作时被判孤儿——进程
   * 关停时 fiber 销毁不会误伤，重启后应用重新注册即自动愈合).
   */
  private async sweep(domain: TaskCenterStore): Promise<void> {
    const tasks = view(domain.table('tasks'))
    const resolver = this.resolver
    const now = Date.now()
    for (const row of tasks.all()) {
      if ((row.status === 'open' || row.status === 'taken') && resolver !== undefined) {
        if (await resolver(row.appId) === undefined) {
          const next: TaskRecord = { ...row, status: 'orphaned', revision: row.revision + 1, updatedAt: new Date().toISOString() }
          delete (next as { claimedBy?: unknown }).claimedBy
          await tasks.put(row.id, next)
          this.host.emit('task-center/changed', { taskId: row.id, action: 'orphaned' })
          continue
        }
      }
      if (row.status === 'open' && isPast(row.expiresAt, now)) {
        await tasks.put(row.id, {
          ...row, status: 'expired', revision: row.revision + 1, updatedAt: new Date().toISOString(),
        })
        this.host.emit('task-center/changed', { taskId: row.id, action: 'expired' })
      } else if (row.status === 'taken' && isPast(row.claimedBy?.leaseUntil, now)) {
        // claimedBy 是 readonly：用解构摘除该键，不用 as 断言 / destructure to drop the key, no cast
        const { claimedBy: _dropped, ...kept } = row
        const next: TaskRecord = {
          ...kept, status: 'open', revision: row.revision + 1, updatedAt: new Date().toISOString(),
        }
        await tasks.put(row.id, next)
        this.host.emit('task-center/changed', { taskId: row.id, action: 'lease-expired' })
      }
    }
  }

  private require(record: TaskRecord | undefined): TaskRecord {
    if (record === undefined) throw new TaskError(TaskErrorCode.NotFound, 'task not found')
    return record
  }

  /** Run one mutation at a time, preserving FIFO order (§4.4). */
  private write<T>(work: (domain: TaskCenterStore) => Promise<T>): Promise<T> {
    const pending = this.chain.then(async () => work(await this.requireDomain()))
    this.chain = pending.catch(() => undefined)
    return pending
  }

  private async requireDomain(): Promise<TaskCenterStore> {
    const domain = await this.ready
    if (domain !== undefined) return domain
    throw new TaskError(
      'task-center/storage-unavailable',
      `task storage is unavailable${this.storageFailure === undefined ? '' : `: ${this.storageFailure}`}`,
    )
  }

  /** Open the storage domain, reporting rather than throwing on failure. */
  private async openDomain(): Promise<TaskCenterStore | undefined> {
    // A live reinstall can leave the previous activation's domain open under
    // the same name; close that handle first (same pattern as notebook/forum).
    const stale = this.host.storageDomain.get(TASK_CENTER_DOMAIN_NAME)
    if (stale !== undefined) {
      try {
        await stale.close()
        this.host.logger.warn('taskCenter: closed the storage domain left open by a previous activation')
      } catch (error: unknown) {
        this.host.logger.warn(`taskCenter: the previous storage domain could not close: ${String(error)}`)
      }
    }
    try {
      const domain = await this.host.storageDomain.open(taskCenterDomain)
      this.host.effect(() => () => domain.close(), 'taskCenter:storage')
      return domain
    } catch (error: unknown) {
      this.storageFailure = error instanceof Error ? error.message : String(error)
      this.host.logger.error(
        `taskCenter: storage domain "${TASK_CENTER_DOMAIN_NAME}" could not open: ${this.storageFailure}`,
      )
      return undefined
    }
  }
}

/** Render the model-facing inbox text for one task (§5.1 template). */
export function noticeText(task: TaskRecord): string {  const lines = [
    `[task-center] ${task.title}`,
    `来源：${task.appId} · kind ${task.kind}`,
    `页面：${task.target.url}`,
    `参数：${JSON.stringify(task.target.params)}`,
    '要求：调用 app_open 打开该 URL；完成后调用 task_complete，失败调用 task_fail。',
  ]
  if (task.dueAt !== undefined) lines.push(`期限：${task.dueAt}`)
  if (task.body !== undefined) lines.push(`说明：${task.body.slice(0, MAX_BODY_CHARS)}`)
  return lines.join('\n')
}
