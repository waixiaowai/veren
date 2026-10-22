/**
 * Notebook: one private, durable notebook per agent preset.
 *
 * Every note is owned by the preset id of the Agent that wrote it. The same
 * record set is served to people through the `notebook` Remote namespace and
 * to models through the tool builders this package exports — the builders are
 * the one model-facing implementation, and a mounter registers them; this
 * package registers nothing into `ctx.tools`. Tools never take an owner; they
 * resolve it from the live Agent on every call. The panel does take an owner
 * because a human is choosing whose notebook to read, which is the requested
 * behaviour rather than a hole. Storage failure degrades rather than throws.
 * The application layer — the only registration face, where the builders are
 * defined into the app catalog and mounted into page sessions — lives in the
 * separate `@veren/notebook-app` package (G2 package split), so this host
 * injects no application framework and activates wherever the host does.
 *
 * 记事本：每个 agent 预设一本私密、持久的记事本。
 *
 * 每条笔记归属于写入它的 Agent 的预设 id。同一份记录集合既经 `notebook` 远端命名空间提供给人，
 * 也经本包导出的工具构建器提供给模型——构建器是唯一的面向模型实现，注册归挂载方；本包自己
 * 不向 `ctx.tools` 注册任何东西。工具从不接受归属参数，而是在每次调用时从活着的 Agent 解析；
 * 面板接受归属，因为人本来就要选择看谁的记事本，这是需求本身，不是漏洞。存储失败只降级不
 * 抛出。应用层——唯一的注册面，构建器在那里 define 进应用目录并挂进页面会话——住在独立的
 * `@veren/notebook-app` 包里（G2 拆包），因此本宿主不 inject 应用框架，宿主激活即服务激活。
 *
 * @module @veren/notebook
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type { NoteRecord, NoteSummary, NoteView, NotebookConfig, NotebookToolsPort, OwnerView } from './types.ts'
import { NOTEBOOK_DOMAIN_NAME, notebookDomain, view } from './storage.ts'
import type { NotebookStore, NotebookTable } from './storage.ts'
import {
  NotebookError, applyUpdate, buildNote, ensureExpected, noteKey, noteView, notesOf, ownersOf,
  requireOwner, requireOwned, summariesOf, validateCreate, validateUpdate,
} from './notes.ts'
// Type-only: pulls the `ctx.agentPresets` service declaration into this face.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable private notebooks, one per agent preset. */
    notebook: NotebookService
  }
}

/**
 * Config schema: empty today, kept so the plugin manager shows an (empty) form
 * rather than erroring on a missing schema.
 * Config schema：当前为空；保留它让插件管理器以（空）表单展示本插件，而不是因缺 schema 报错。
 */
export const Config = z.object({}).description('Reserved; no host-layer options yet.')

/**
 * Notebook service: the plugin's whole host surface — the domain over storage,
 * with the tool builders and the app layer one import away.
 *
 * `sessionController` is deliberately not injected. It exists only in the Web
 * application, and a hard dependency on it would leave this plugin pending
 * forever in headless, ACP, and SDK profiles; the panel is reached through the
 * Remote namespace instead, and every owner-scoped read is a plain table query.
 */
export class NotebookService extends TypertRemoteService {
  // The application framework (`apps`) is deliberately NOT here (G2): the app
  // face lives in the separate `@veren/notebook-app` package. The `tools`
  // registry is likewise not injected any more — registration belongs to the
  // mounter of the exported builders.
  // 应用框架（`apps`）刻意不在其中（G2）：应用面住在独立的 `@veren/notebook-app` 包里。
  // `tools` 注册表也不再 inject——注册归导出构建器的挂载方。
  static inject = ['storageDomain', 'agentPresets']
  static Config = Config

  /** The plugin's own reference to the owning Context. */
  private readonly host: Context
  private storageFailure: string | undefined
  private readonly ready: Promise<NotebookStore | undefined>
  private chain: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - Host services owning storage and the preset registry.
   * @param _config - validated plugin configuration; nothing to configure at
   *   the host layer today.
   */
  constructor(ctx: Context, _config: NotebookConfig) {
    super(ctx, 'notebook', { namespace: 'notebook' })
    this.host = ctx
    this.ready = this.openDomain()
  }

  async [Service.init](): Promise<void> {
    await this.ready
  }

  /** List every preset that has a notebook, declared or remembered by its notes. 列出每本存在的记事本（声明过或被笔记记得），带笔记数与声明状态。 */
  @Remote('owners')
  async owners(request: Record<string, never>): Promise<readonly OwnerView[]> {
    void request
    return this.readDomain(async domain => ownersOf(this.table(domain), await this.declaredPresets()))
  }

  /** Read one preset's notes, newest update first; the owner is chosen by the human. 读某个预设的全部笔记，最新更新在前；归属由人选定。 */
  @Remote('list')
  async list(request: { readonly owner: string }): Promise<readonly NoteView[]> {
    const owner = requireOwner(request.owner)
    return this.readDomain(domain => notesOf(this.table(domain), owner))
  }

  /** Read one note in one preset's notebook. 读某本记事本里的一条笔记。 */
  async readNote(owner: string, id: string): Promise<NoteView> {
    const preset = requireOwner(owner)
    return this.readDomain(domain => noteView(requireOwned(this.table(domain), preset, id)))
  }

  /** Read one preset's list rows, newest update first. 读某个预设的列表行，最新更新在前。 */
  private async listSummaries(owner: string): Promise<readonly NoteSummary[]> {
    const preset = requireOwner(owner)
    return this.readDomain(domain => summariesOf(this.table(domain), preset))
  }

  /** Write one note into one preset's notebook; returns the stored note. 往某本记事本写一条笔记，返回存储后的笔记。 */
  @Remote('create')
  async create(request: {
    readonly owner: string
    readonly title: string
    readonly body: string
  }): Promise<NoteView> {
    const owner = requireOwner(request.owner)
    const fields = validateCreate(request)
    return this.writeDomain(async (domain) => {
      const record = buildNote(owner, fields, this.now())
      await this.table(domain).put(noteKey(owner, record.id), record)
      return noteView(record)
    })
  }

  /** Replace fields of one note (optional optimistic guard); returns the stored note. 替换一条笔记的字段（可选乐观守卫），返回存储后的笔记。 */
  @Remote('update')
  async update(request: {
    readonly owner: string
    readonly id: string
    readonly title?: string
    readonly body?: string
    readonly expectedUpdatedAt?: string
  }): Promise<NoteView> {
    const owner = requireOwner(request.owner)
    const fields = validateUpdate(request)
    return this.writeDomain(async (domain) => {
      const table = this.table(domain)
      const record = requireOwned(table, owner, request.id)
      ensureExpected(record, request.expectedUpdatedAt)
      const next = applyUpdate(record, fields, this.now())
      await table.put(noteKey(owner, next.id), next)
      return noteView(next)
    })
  }

  /** Delete one note from one preset's notebook; resolves to whether it existed. 从某本记事本删除一条笔记，返回它是否存在过。 */
  @Remote('deleteNote')
  async deleteNote(request: { readonly owner: string; readonly id: string }): Promise<{ readonly deleted: boolean }> {
    const owner = requireOwner(request.owner)
    return this.writeDomain(async (domain) => {
      const table = this.table(domain)
      const record = requireOwned(table, owner, request.id)
      await table.del(noteKey(owner, record.id))
      return { deleted: true }
    })
  }

  /** Open the storage domain, reporting rather than throwing on failure. */
  private async openDomain(): Promise<NotebookStore | undefined> {
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

  /** Resolve the open domain, or raise the recorded storage failure. */
  private async requireDomain(): Promise<NotebookStore> {
    const domain = await this.ready
    if (domain !== undefined) return domain
    throw new NotebookError(
      'notebook/storage-unavailable',
      `notebook storage is unavailable${this.storageFailure === undefined ? '' : `: ${this.storageFailure}`}`,
    )
  }

  /** Project the notes table for one operation. */
  private table(domain: NotebookStore): NotebookTable<NoteRecord> {
    return view(domain.table('notes'))
  }

  /** Run one read against the open domain. */
  private async readDomain<T>(work: (domain: NotebookStore) => T | Promise<T>): Promise<T> {
    return work(await this.requireDomain())
  }

  /** Run one mutation at a time, preserving FIFO order. */
  private writeDomain<T>(work: (domain: NotebookStore) => Promise<T>): Promise<T> {
    const pending = this.chain.then(async () => work(await this.requireDomain()))
    this.chain = pending.catch(() => undefined)
    return pending
  }

  /** Every preset the deployment currently declares. */
  private async declaredPresets(): Promise<readonly string[]> {
    try {
      return (await this.host.agentPresets.list()).map(preset => preset.id)
    } catch (error: unknown) {
      this.host.logger.warn(`notebook: the preset registry could not be listed: ${String(error)}`)
      return []
    }
  }

  /**
   * The narrow surface the model-facing tools read and write. Public by design:
   * the app layer and any other mounter of the exported builders ride this one
   * port, so every tool acts on the one table the panel reads.
   * 面向模型的工具读写的窄接口。刻意公开：应用层与任何其他挂载方走同一端口，每个工具都写在面板所读的同一张表上。
   */
  toolsPort(): NotebookToolsPort {
    return {
      list: owner => this.listSummaries(owner),
      read: (owner, id) => this.readNote(owner, id),
      create: (owner, title, body) => this.create({ owner, title, body }),
      update: (owner, id, patch) => this.update({
        owner,
        id,
        ...patch.title === undefined ? {} : { title: patch.title },
        ...patch.body === undefined ? {} : { body: patch.body },
        ...patch.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: patch.expectedUpdatedAt },
      }),
      remove: async (owner, id) => (await this.deleteNote({ owner, id })).deleted,
    }
  }

  /** One ISO instant, from the one clock the service reads. */
  private now(): string {
    return new Date().toISOString()
  }
}

export {
  EXCERPT_CHARS, MAX_BODY_CHARS, MAX_TITLE_CHARS, NotebookError, applyUpdate, buildNote, ensureExpected,
  noteKey, noteSummary, noteView, notesOf, ownersOf, requireOwner, requireOwned, validateCreate, validateUpdate,
} from './notes.ts'
export { NOTEBOOK_DOMAIN_NAME, notebookDomain } from './storage.ts'
// The five tool builders: the single model-facing implementation of the
// notebook operations. Registration belongs to the mounter — the application
// layer (`@veren/notebook-app`) defines them into its catalog and mounts them
// into page sessions; nothing registers globally any more.
// 五个工具构建器：记事本操作唯一的面向模型实现。注册归挂载方——应用层
// （`@veren/notebook-app`）把它们 define 进应用目录并挂进页面会话；不再有任何全局注册。
export {
  buildNotebookDeleteDefinition, buildNotebookListDefinition, buildNotebookReadDefinition,
  buildNotebookRewriteDefinition, buildNotebookWriteDefinition,
} from './tools.ts'
export type {
  NoteRecord, NoteSummary, NoteView, NotebookConfig, NotebookErrorCode, NotebookToolsPort, OwnerView,
} from './types.ts'

export default NotebookService
