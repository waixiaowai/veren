/**
 * Durable storage access for the startup service: opening the storage domain,
 * reading the ordered item snapshot, and persisting one item's run stamp.
 *
 * A missing or broken storage backend must not take the Harness down with it:
 * startup items are a convenience feature, so a failed open degrades to a
 * logged, inert store whose every read raises the recorded failure instead.
 *
 * 启动服务的持久化存储访问：打开存储域、读取有序的启动项快照、持久化一次运行的盖章。
 *
 * 存储后端缺失或损坏不能拖垮 Harness：启动项是便利功能，打开失败时退化为一个已记录
 * 日志的惰性存储，之后的每次读取都抛出记录下来的失败原因。
 * @module @veren/startup-autostart/store
 */

import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { Context } from '@deepseek-ai/cordis'
import { StartupInputError } from './item.ts'
import type { StartupItemRecord } from './item.ts'
import { STARTUP_DOMAIN_NAME, STARTUP_TABLE_NAME, startupDomain, toRecord } from './storage.ts'
import type { StoredStartupItem } from './storage.ts'

/**
 * Owns the open storage domain and the ordered reads and writes over it.
 *
 * The domain opens once, in the constructor; the promise decides readiness for
 * every later operation, and a failure is reported there rather than thrown.
 */
export class StartupStore {
  /** Reason the feature is inert, set when the storage domain could not open. */
  private failure: string | undefined

  /** Resolves to the open domain, or to undefined when it could not be opened. */
  readonly ready: Promise<Domain<typeof startupDomain> | undefined>

  /**
   * @param ctx - Host services owning the storage domain registry.
   */
  constructor(ctx: Context) {
    this.ready = this.open(ctx)
  }

  /**
   * Open the storage domain, reporting rather than throwing on failure.
   * @param ctx - the context opening the domain.
   * @returns the open domain, or undefined when it could not be opened.
   */
  private async open(ctx: Context): Promise<Domain<typeof startupDomain> | undefined> {
    try {
      return await ctx.storageDomain.open(startupDomain)
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : String(error)
      ctx.logger.error(
        `startup-autostart: storage domain "${STARTUP_DOMAIN_NAME}" could not open, so startup items are disabled: `
        + this.failure,
      )
      return undefined
    }
  }

  /** Resolve the open domain, or raise the recorded storage failure. */
  async require(): Promise<Domain<typeof startupDomain>> {
    const domain = await this.ready
    if (domain !== undefined) return domain
    throw new StartupInputError(
      'storage_unavailable',
      `startup storage is unavailable${this.failure === undefined ? '' : `: ${this.failure}`}`,
    )
  }

  /** Snapshot every stored item, ordered for stable presentation. */
  records(domain: Domain<typeof startupDomain>): StartupItemRecord[] {
    return [...domain.table(STARTUP_TABLE_NAME).entries()]
      .map(([, item]) => toRecord(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  /**
   * Persist one item's run stamp and outcome.
   * @param domain - the open storage domain.
   * @param item - the record to write.
   */
  async commit(domain: Domain<typeof startupDomain>, item: StartupItemRecord): Promise<void> {
    await domain.table(STARTUP_TABLE_NAME).put(item.id, item as StoredStartupItem)
  }
}
