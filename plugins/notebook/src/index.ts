/**
 * Notebook: one private, durable notebook per agent preset.
 *
 * Every note is owned by the preset id of the Agent that wrote it. The same
 * record set is exposed to the model as `notebook_*` tools and to the Web panel
 * over the `notebook` Remote namespace, so both surfaces always act on one
 * table. The tools never take an owner; they resolve it from the live Agent on
 * every call. The panel does take an owner because a human is choosing whose
 * notebook to read, which is the requested behaviour rather than a hole.
 *
 * Storage failure degrades rather than throws. The application layer requires
 * the app framework as a declared hard inject (`apps`): where the framework is
 * absent the whole plugin stays pending — the tools-only isolation that used to
 * be a runtime probe was never real on a live host (G13) and belongs to G2's
 * package split.
 *
 * 记事本：每个 agent 预设一本私密、持久的记事本。
 *
 * 每条笔记归属于写入它的 Agent 的预设 id。同一份记录集合既作为 `notebook_*` 工具提供给模型，
 * 又通过 `notebook` 远端命名空间提供给 Web 面板，因此两个界面永远操作同一张表。工具从不接受
 * 归属参数，而是在每次调用时从活着的 Agent 解析；面板接受归属，因为人本来就要选择看谁的记事本，
 * 这是需求本身，不是漏洞。
 *
 * 存储失败只降级不抛出。应用层把应用框架声明为硬 inject（`apps`）：框架缺席时整个插件
 * 保持 pending——过去"运行期探测 apps 缺席则只跑工具"的降级在真实宿主上从未生效（G13），
 * 真正的隔离属 G2 的拆包工作。
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
import { registerNotebookApp } from './app.ts'
import { registerNotebookTools } from './tools.ts'
// Type-only: pulls the `ctx.agentPresets` service declaration into this face.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable private notebooks, one per agent preset. */
    notebook: NotebookService
  }
}

/**
 * Config schema.
 *
 * The only deployment-varying choice is whether presets receive the tools.
 * Notes themselves never belong to a workspace, so there is nothing else to
 * configure. Every field resolves a default here so the plugin manager shows the
 * value that will actually apply.
 */
export const Config = z.object({
  tools: z.object({
    enabled: z.boolean().default(true),
  }).default({ enabled: true }),
  app: z.object({
    enabled: z.boolean().default(true),
  }).default({ enabled: true }),
})

/**
 * Notebook service: the plugin's whole host surface.
 *
 * `sessionController` is deliberately not injected. It exists only in the Web
 * application, and a hard dependency on it would leave this plugin pending
 * forever in headless, ACP, and SDK profiles; the panel is reached through the
 * Remote namespace instead, and every owner-scoped read is a plain table query.
 */
export class NotebookService extends TypertRemoteService {
  // `apps` is the application registry: the notebook exposes itself as an app
  // (pages + app-scoped tools) and therefore requires the app framework as a
  // hard inject (G13) — no runtime probing, no absent-degrade branch.
  // `apps` 是应用注册表：记事本把自己暴露为一个应用（页面 + 应用级工具），
  // 因此把应用框架声明为硬 inject（G13）——不做运行期探测，没有缺席降级分支。
  static inject = ['storageDomain', 'tools', 'agentPresets', 'apps']
  static Config = Config

  /** The plugin's own reference to the owning Context. */
  private readonly host: Context
  private storageFailure: string | undefined
  private readonly ready: Promise<NotebookStore | undefined>
  private chain: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - Host services owning storage, tools, and the preset registry.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, config: NotebookConfig) {
    super(ctx, 'notebook', { namespace: 'notebook' })
    this.host = ctx
    this.ready = this.openDomain()
    if (config.tools.enabled) registerNotebookTools(ctx, () => this.toolsPort())
    // The app face requires the framework: `apps` is a declared hard inject, so
    // this line only runs where the framework is present.
    // 应用面依赖应用框架：`apps` 是声明的硬 inject，因此这一行只在框架在场时执行。
    if (config.app.enabled) registerNotebookApp(ctx, () => this.toolsPort())
  }

  async [Service.init](): Promise<void> {
    await this.ready
  }

  /**
   * List every preset that has a notebook, declared or remembered by its notes.
   * @param request - no fields; the parameter keeps the Remote call uniform.
   * @returns owners with their note counts and declaration state.
   */
  @Remote('owners')
  async owners(request: Record<string, never>): Promise<readonly OwnerView[]> {
    void request
    return this.readDomain(async domain => ownersOf(this.table(domain), await this.declaredPresets()))
  }

  /**
   * Read one preset's notes, newest update first.
   * @param request - the notebook owner chosen by the human.
   * @returns that owner's notes, with full bodies.
   */
  @Remote('list')
  async list(request: { readonly owner: string }): Promise<readonly NoteView[]> {
    const owner = requireOwner(request.owner)
    return this.readDomain(domain => notesOf(this.table(domain), owner))
  }

  /**
   * Read one note in one preset's notebook.
   * @param owner - preset id that owns the notebook.
   * @param id - note id inside that notebook.
   * @returns the whole note.
   */
  async readNote(owner: string, id: string): Promise<NoteView> {
    const preset = requireOwner(owner)
    return this.readDomain(domain => noteView(requireOwned(this.table(domain), preset, id)))
  }

  /**
   * Read one preset's list rows, newest update first.
   * @param owner - preset id whose notebook is listed.
   * @returns that owner's summaries.
   */
  private async listSummaries(owner: string): Promise<readonly NoteSummary[]> {
    const preset = requireOwner(owner)
    return this.readDomain(domain => summariesOf(this.table(domain), preset))
  }

  /**
   * Write one note into one preset's notebook.
   * @param request - owner, title, and body.
   * @returns the stored note.
   */
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

  /**
   * Replace fields of one note in one preset's notebook.
   * @param request - owner, note id, replacement fields, and an optional guard.
   * @returns the stored note after the write.
   */
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

  /**
   * Delete one note from one preset's notebook.
   * @param request - owner and note id.
   * @returns whether the note existed.
   */
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

  /** The narrow surface the model-facing tools read and write. */
  private toolsPort(): NotebookToolsPort {
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
export { APP_DEFINITION, APP_ID, createAppTools, listPage, notePage } from './app.ts'
export type {
  NoteRecord, NoteSummary, NoteView, NotebookAppConfig, NotebookConfig, NotebookErrorCode, NotebookToolConfig, NotebookToolsPort, OwnerView,
} from './types.ts'

export default NotebookService
