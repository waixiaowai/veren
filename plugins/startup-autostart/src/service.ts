/**
 * The Host service of the startup-autostart plugin: the durable startup items,
 * the startup trigger, and the Typert Remote surface the management panel
 * reads.
 *
 * The plugin has no configuration: what a start does is fixed by the items the
 * user registered, and there is no deployment-varying knob left once the
 * debounce is gone.
 *
 * 启动自启动插件的宿主服务：持久化启动项、启动触发器，以及管理面板读取的 Typert
 * Remote 表面。本插件没有配置：一次启动做什么由用户登记的启动项决定，防抖取消之后
 * 也不存在随部署而异的旋钮。
 * @module @veren/startup-autostart/service
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { createStartupItem, updateStartupItem } from './validate.ts'
import { startupItemView } from './view.ts'
import { StartupInputError } from './item.ts'
import type { StartupItemInput, StartupItemRecord, StartupOutcome } from './item.ts'
import type { StartupItemView } from './view.ts'
import { STARTUP_TABLE_NAME, startupDomain, toRecord } from './storage.ts'
import type { StoredStartupItem } from './storage.ts'
import { StartupRuntime } from './runtime.ts'
import { StartupStore } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable startup-item management and the startup trigger. */
    startupAutostart: StartupAutostartService
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One startup item was created, edited, or deleted, or one run finished.
     * Emitted only after the durable write landed, so a reader that reloads the
     * catalog from `catalog()` sees committed state.
     * @mode emit
     */
    'startup-autostart/changed'(): void
  }
}

/** The open storage-domain type this service commits into. */
type StartupDomain = Domain<typeof startupDomain>

/**
 * Host service owning the durable startup items, the startup trigger, and the
 * Typert Remote surface the management panel reads.
 *
 * The plugin has no configuration: what a start does is fixed by the items the
 * user registered, and there is no deployment-varying knob left once the
 * debounce is gone.
 */
export class StartupAutostartService extends TypertRemoteService {
  /**
   * Core services only. `sessionController` is deliberately NOT injected: it
   * exists in the Web application alone, and a hard dependency on it left this
   * plugin permanently pending in the headless, ACP, and SDK profiles. The
   * runtime reads it through `ctx.get` when it is there, and drives Sessions
   * through `ctx.agents` when it is not.
   */
  static inject = ['agents', 'sessions', 'storageDomain']

  /** Durable storage access; its open failure degrades the feature, not the boot. */
  private readonly store: StartupStore
  private readonly initialized: PromiseLike<unknown>
  private chain: Promise<unknown> = Promise.resolve()
  private runtime: StartupRuntime | undefined
  private stopping = false

  /**
   * @param ctx - Host services owning storage, Sessions, and dispatch.
   */
  constructor(ctx: Context) {
    super(ctx, 'startupAutostart', { namespace: 'startup' })
    const store = new StartupStore(ctx)
    this.store = store
    this.initialized = ctx.effect(async () => {
      const domain = await store.ready
      // A storage failure disables the feature; it never fails activation, and
      // therefore never fails the Harness boot that mounted this plugin.
      if (domain === undefined) return async () => undefined
      this.runtime = new StartupRuntime(
        ctx,
        () => store.records(domain),
        work => this.serialize(work),
        item => this.commit(domain, item),
      )
      return ctx.effect(() => async () => {
        this.stopping = true
        await this.runtime?.dispose()
        await this.chain // The chain contains failures already returned to their callers.
        await domain.close()
      })
    })
    this.armTrigger(ctx)
  }

  async [Service.init](): Promise<void> {
    // Readiness ordering only: the drive reports its own failures.
    await this.initialized.then(() => undefined, () => undefined)
  }

  /**
   * Read every stored startup item. Never activates a Session and never reads
   * Session history.
   * @returns all items ordered by creation instant, then by id.
   */
  @Remote('catalog')
  async catalog(): Promise<StartupItemView[]> {
    const domain = await this.store.require()
    return this.store.records(domain).map(item => startupItemView(item))
  }

  /**
   * Register one startup item.
   * @param request - the item's fields; `name` and `action` are required.
   * @returns the stored item as the panel and tools read it.
   * @throws StartupInputError for a rejected field, or when storage is unavailable.
   */
  @Remote('create')
  async create(request: StartupItemInput): Promise<StartupItemView> {
    return this.serialize(async () => {
      const domain = await this.store.require()
      const record = createStartupItem(request, Date.now())
      await domain.table(STARTUP_TABLE_NAME).put(record.id, record as StoredStartupItem)
      this.emitChanged()
      return startupItemView(record)
    })
  }

  /**
   * Edit one stored item in place, keeping its identity and run count. An
   * omitted field keeps its stored value.
   * @param request - the item id plus any fields to replace.
   * @returns the stored item as the panel and tools read it.
   * @throws StartupInputError for a rejected field, an unknown id, or unavailable storage.
   */
  @Remote('update')
  async update(request: StartupItemInput & { readonly id: string }): Promise<StartupItemView> {
    return this.serialize(async () => {
      const domain = await this.store.require()
      const table = domain.table(STARTUP_TABLE_NAME)
      const current = table.get(request.id)
      if (current === undefined) {
        throw new StartupInputError('item_not_found', `no startup item with id "${request.id}".`)
      }
      const record = updateStartupItem(toRecord(current), request, Date.now())
      await table.put(request.id, record as StoredStartupItem)
      this.emitChanged()
      return startupItemView(record)
    })
  }

  /**
   * Delete one startup item. A deleted item never triggers again; a delivery
   * already queued in a Session inbox is not retracted.
   * @param request - the exact item id.
   * @returns whether a stored item was removed.
   * @throws StartupInputError when storage is unavailable.
   */
  @Remote('delete')
  async delete(request: { readonly id: string }): Promise<{ readonly id: string; readonly deleted: boolean }> {
    return this.serialize(async () => {
      const domain = await this.store.require()
      const deleted = await domain.table(STARTUP_TABLE_NAME).delete(request.id)
      if (deleted) this.emitChanged()
      return { id: request.id, deleted }
    })
  }

  /**
   * Run one item immediately, without waiting for the next start and without
   * consulting the run history.
   *
   * The only gate is `enabled`: a switched-off item is refused so a manual run
   * cannot quietly undo the user's decision, and `force` is the explicit way to
   * run one anyway.
   * @param request - the item id, and whether to run a disabled item anyway.
   * @returns the retained outcome of this attempt.
   * @throws StartupInputError for an unknown id, a disabled item, or unavailable storage.
   */
  @Remote('run')
  async run(
    request: { readonly id: string; readonly force?: boolean },
  ): Promise<{ readonly id: string; readonly outcome: StartupOutcome }> {
    return this.serialize(async () => {
      const domain = await this.store.require()
      const runtime = this.runtime
      if (runtime === undefined) {
        throw new StartupInputError('storage_unavailable', 'the startup runtime is not ready yet; retry after startup finishes.')
      }
      const stored = domain.table(STARTUP_TABLE_NAME).get(request.id)
      if (stored === undefined) {
        throw new StartupInputError('item_not_found', `no startup item with id "${request.id}".`)
      }
      const record = toRecord(stored)
      if (request.force !== true && !record.enabled) {
        throw new StartupInputError(
          'item_disabled',
          `item "${record.name}" is disabled; enable it with update, or pass force to run it anyway.`,
        )
      }
      return { id: record.id, outcome: await runtime.runItem(record) }
    })
  }

  /**
   * Persist one item's run stamp and outcome, then notify observers.
   * @param domain - the open storage domain.
   * @param item - the record to write.
   */
  private async commit(domain: StartupDomain, item: StartupItemRecord): Promise<void> {
    await this.store.commit(domain, item)
    this.emitChanged()
  }

  /**
   * Wire both trigger paths.
   *
   * A launcher that provides `ctx.appReady` owns the timing: the drive runs once
   * successful startup commits, and a late subscription fires immediately, which
   * is what makes an HMR reload re-arm the trigger. A host without that signal
   * falls back to activation completion, which is the only honest "we finished
   * loading" moment it has.
   * @param ctx - the context whose launcher fact decides the trigger path.
   */
  private armTrigger(ctx: Context): void {
    ctx.effect(() => {
      const appReady = ctx.get('appReady')
      if (appReady !== undefined) return appReady.onReady(() => { this.requestDrive() })
      ctx.logger.debug('startup-autostart: no launcher appReady signal; triggering on plugin activation')
      this.requestDrive()
      return () => undefined
    }, 'startup-autostart.trigger()')
  }

  /**
   * Ask the runtime for its single drive once the service is initialized.
   *
   * Both trigger paths may arrive before the domain is open, in either order;
   * deferring to `initialized` is what lets the runtime exist first, and the
   * runtime's own latch collapses the two requests into one drive.
   */
  private requestDrive(): void {
    if (this.stopping) return
    void this.initialized.then(
      () => { this.runtime?.requestDrive() },
      () => undefined,
    )
  }

  /**
   * Dispatch one post-commit change notification, containing observer failures:
   * the durable write already landed, so a throwing listener must not reject the
   * management call that caused it.
   */
  private emitChanged(): void {
    try {
      this.ctx.emit('startup-autostart/changed')
    } catch (error: unknown) {
      this.ctx.logger.warn(`startup-autostart: startup-autostart/changed listener failed: ${String(error)}`)
    }
  }

  /** Run one management or delivery operation at a time, preserving FIFO order. */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('Startup autostart service is stopping'))
    const pending = this.chain.then(work)
    this.chain = pending.catch(() => undefined) // Preserve FIFO progress after the caller receives the failure.
    return pending
  }
}
