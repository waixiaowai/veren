/**
 * The storage lifecycle: one handle that owns the open domain, its write
 * chain, and the one-time links-cache rebuild after the v1→v2 migration.
 *
 * Storage failure degrades rather than throws — the service reports the box
 * as unavailable instead of crashing the host. The rebuild runs once per
 * medium: the domain's global `linksSyncedAt` marker starts below the current
 * domain version on every pre-2 medium (v1 media store no global at all), so
 * the first v2 open rebuilds every owner's cache rows from the bodies and
 * stamps the marker; later opens skip the rebuild.
 *
 * 存储生命周期：一个句柄持有打开的域、它的写链，以及 v1→v2 迁移后的一次性链接
 * 缓存重建。
 *
 * 存储失败只降级不抛出——服务把盒报为不可用，而不是拖垮宿主。重建每个介质只跑
 * 一次：域的全局 `linksSyncedAt` 标记在每个 v2 之前的介质上都低于当前域版本
 * （v1 介质根本没存过全局），所以首次 v2 打开会从正文重建所有归属的缓存行并盖
 * 标记；之后的打开跳过重建。
 *
 * @module @veren/notebook/store
 */

import type { Context } from '@deepseek-ai/cordis'
import { NOTEBOOK_DOMAIN_NAME, NOTEBOOK_DOMAIN_VERSION, notebookDomain, view } from './storage.ts'
import type { NotebookStore, NotebookTable } from './storage.ts'
import { syncLinks } from './graph.ts'
import { NotebookError } from './notes.ts'
import type { CardTables } from './cards.ts'
import type { LinkRecord, NoteRecord } from './types.ts'

export class NotebookStoreHandle {
  /** The plugin's own reference to the owning Context. */
  private readonly host: Context
  private storageFailure: string | undefined
  private readonly ready: Promise<NotebookStore | undefined>
  private chain: Promise<unknown> = Promise.resolve()

  /**
   * @param host - the context owning storage; its effect disposes the open
   *   domain when the plugin unloads.
   */
  constructor(host: Context) {
    this.host = host
    this.ready = this.open()
  }

  /** Await the open (and the one-time rebuild), for `Service.init`. 等待打开（与一次性重建）完成，供 `Service.init` 使用。 */
  async settle(): Promise<void> {
    await this.ready
  }

  /** The recorded failure, when the domain could not open. 域打不开时的既录失败说明。 */
  get failureMessage(): string | undefined {
    return this.storageFailure
  }

  /**
   * Raise the recorded failure when the domain is not available.
   * @returns the open domain.
   * @throws NotebookError `storage-unavailable` carrying the failure.
   */
  async require(): Promise<NotebookStore> {
    const domain = await this.ready
    if (domain !== undefined) return domain
    throw new NotebookError(
      'notebook/storage-unavailable',
      `notebook storage is unavailable${this.storageFailure === undefined ? '' : `: ${this.storageFailure}`}`,
    )
  }

  /**
   * Project both tables of one open domain.
   * @param domain - the open notebook domain.
   * @returns the notes and links views one write moves together.
   */
  tables(domain: NotebookStore): CardTables {
    return { notes: this.notesTable(domain), links: this.linksTable(domain) }
  }

  /**
   * Run one read against the open domain.
   * @param work - the read itself.
   * @returns whatever the read produced.
   */
  async read<T>(work: (domain: NotebookStore) => T | Promise<T>): Promise<T> {
    return work(await this.require())
  }

  /**
   * Run one mutation at a time, preserving FIFO order.
   * @param work - the mutation itself.
   * @returns whatever the mutation produced.
   */
  write<T>(work: (domain: NotebookStore) => Promise<T>): Promise<T> {
    const pending = this.chain.then(async () => work(await this.require()))
    this.chain = pending.catch(() => undefined)
    return pending
  }

  /** Open the domain, rebuild a stale links cache once, and report rather than throw on failure. 打开域，必要时一次性重建过期链接缓存；失败时上报而非抛出。 */
  private async open(): Promise<NotebookStore | undefined> {
    // A live reinstall can leave the previous activation's domain open under the
    // same name. Close that handle first, which frees the name for a fresh open;
    // a real restart finds nothing here and takes the same open path below.
    const stale = this.host.storageDomain.get(NOTEBOOK_DOMAIN_NAME)
    if (stale !== undefined) {
      try {
        await stale.close()
        this.host.logger.warn('notebook: closed the storage domain left open by a previous activation')
      } catch (error: unknown) {
        this.host.logger.warn(`notebook: the previous storage domain could not close: ${String(error)}`)
      }
    }
    try {
      const domain = await this.host.storageDomain.open(notebookDomain)
      await this.syncLinksCache(domain)
      // The caller owns the handle: close it when this plugin unloads so the
      // next activation starts from a free name.
      this.host.effect(() => () => domain.close(), 'notebook:storage')
      return domain
    } catch (error: unknown) {
      this.storageFailure = error instanceof Error ? error.message : String(error)
      this.host.logger.error(
        `notebook: storage domain "${NOTEBOOK_DOMAIN_NAME}" could not open, so notebooks are disabled: `
        + this.storageFailure,
      )
      return undefined
    }
  }

  /** Rebuild the links cache when the medium has not been synced at this domain version. 介质尚未在当前域版本同步过时重建链接缓存。 */
  private async syncLinksCache(domain: NotebookStore): Promise<void> {
    const marker = domain.global.get()
    if (marker.linksSyncedAt >= NOTEBOOK_DOMAIN_VERSION) return
    const tables = this.tables(domain)
    for (const record of tables.notes.all()) {
      await syncLinks(tables.links, record.owner, record.id, record.body)
    }
    await domain.global.set({ linksSyncedAt: NOTEBOOK_DOMAIN_VERSION })
  }

  /** Project the notes table onto the four-method view. 把笔记表投影成四方法视图。 */
  private notesTable(domain: NotebookStore): NotebookTable<NoteRecord> {
    return view(domain.table('notes'))
  }

  /** Project the links table onto the four-method view. 把链接表投影成四方法视图。 */
  private linksTable(domain: NotebookStore): NotebookTable<LinkRecord> {
    return view(domain.table('links'))
  }
}
