/**
 * Storage access of the task center: opening the durable domain, the FIFO
 * write chain every mutation runs on, and the shared time/id helpers.
 *
 * Every mutation runs on one FIFO write chain (§4.4: 每次迁移都在一个串行写链里完成).
 * Expiry and lease recycling are lazy — evaluated from `expiresAt` / `leaseUntil`
 * at the head of every operation; there is no background timer.
 *
 * 任务中心的存储访问：打开持久化域、所有迁移共用的 FIFO 写链，以及共享的时间/id 助手。
 *
 * 所有迁移都在一条 FIFO 串行写链上完成（§4.4）。过期与租约回收是懒判定——每次操作开头按
 * `expiresAt` / `leaseUntil` 现算，没有后台定时器。
 *
 * @module @veren/task-center/service-storage
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Domain, DomainSpec } from '@deepseek-ai/dsh-storage-domain'
import { TASK_CENTER_DOMAIN_NAME, taskCenterDomain } from './storage.ts'
import type { TaskCenterStore } from './storage.ts'
import { TASK_CENTER_EFFECTS_DOMAIN_NAME, taskCenterEffectsDomain } from './service-pump.ts'
import type { TaskEffectsStore } from './service-pump.ts'
import { TaskError } from './tree.ts'
import { TaskErrorCode } from './types.ts'
import type { TaskId } from './types.ts'

/** Whether one ISO instant has already passed `now`. */
export function isPast(instant: string | undefined, now: number): boolean {
  if (instant === undefined) return false
  const at = Date.parse(instant)
  return !Number.isNaN(at) && at <= now
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 新任务 id（brand 收敛在一处）/ a fresh task id (the brand narrowing lives here only) */
export function newTaskId(): TaskId {
  return newId('task') as TaskId
}

/**
 * The durable domain plus the write chain. The domain opens once per service
 * instance; a storage failure is reported on every later write instead of
 * being thrown at construction time.
 * 持久化域与写链。域在每个服务实例里只打开一次；存储失败会在后续每次写入时报出，而不是在
 * 构造时抛出。
 */
export class TaskStorage {
  /** The domain-open promise; `Service.init` awaits it. */
  readonly ready: Promise<TaskCenterStore | undefined>
  /** The pump domain-open promise; the delivery pump awaits it. */
  readonly effects: Promise<TaskEffectsStore | undefined>
  private storageFailure: string | undefined
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly host: Context) {
    this.ready = this.openTaskDomain()
    this.effects = this.openEffectsDomain()
  }

  /** Run one mutation at a time, preserving FIFO order (§4.4). */
  write<T>(work: (domain: TaskCenterStore) => Promise<T>): Promise<T> {
    const pending = this.chain.then(async () => work(await this.requireDomain()))
    this.chain = pending.catch(() => undefined)
    return pending
  }

  private async requireDomain(): Promise<TaskCenterStore> {
    const domain = await this.ready
    if (domain !== undefined) return domain
    throw new TaskError(
      TaskErrorCode.StorageUnavailable,
      `task storage is unavailable${this.storageFailure === undefined ? '' : `: ${this.storageFailure}`}`,
    )
  }

  /** Open the storage domain, reporting rather than throwing on failure. */
  private async openTaskDomain(): Promise<TaskCenterStore | undefined> {
    return this.openNamed(taskCenterDomain, TASK_CENTER_DOMAIN_NAME, 'taskCenter:storage', message => {
      this.storageFailure = message
      this.host.logger.error(`taskCenter: storage domain "${TASK_CENTER_DOMAIN_NAME}" could not open: ${message}`)
    })
  }

  /** Open the pump's effects domain, degrading the pump (not the service) on failure. */
  private async openEffectsDomain(): Promise<TaskEffectsStore | undefined> {
    return this.openNamed(taskCenterEffectsDomain, TASK_CENTER_EFFECTS_DOMAIN_NAME, 'taskCenter:effects-storage', message => {
      this.host.logger.error(`taskCenter: effects domain "${TASK_CENTER_EFFECTS_DOMAIN_NAME}" could not open: ${message}`)
    })
  }

  /**
   * One open sequence shared by both domains. A live reinstall can leave the
   * previous activation's domain open under the same name; close that handle
   * first (same pattern as notebook/forum).
   * / 两个域共用的打开序列。热重装会在同名下留下上一个激活的域；先关掉那个句柄
   * （与 notebook/forum 同一模式）。
   */
  private async openNamed<S extends DomainSpec>(
    spec: S,
    name: string,
    label: string,
    onError: (message: string) => void,
  ): Promise<Domain<S> | undefined> {
    const stale = this.host.storageDomain.get(name)
    if (stale !== undefined) {
      try {
        await stale.close()
        this.host.logger.warn(`taskCenter: closed the storage domain left open by a previous activation (${name})`)
      } catch (error: unknown) {
        this.host.logger.warn(`taskCenter: the previous storage domain could not close: ${String(error)}`)
      }
    }
    try {
      const domain = await this.host.storageDomain.open(spec)
      this.host.effect(() => () => domain.close(), label)
      return domain
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : String(error))
      return undefined
    }
  }
}
