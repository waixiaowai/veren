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
 * Storage failure degrades rather than throws: a notebook that cannot open its
 * domain reports a stable error and leaves the rest of the Harness untouched.
 *
 * 记事本：每个 agent 预设一本私密、持久的记事本。
 *
 * 每条笔记归属于写入它的 Agent 的预设 id。同一份记录集合既作为 `notebook_*` 工具提供给模型，
 * 又通过 `notebook` 远端命名空间提供给 Web 面板，因此两个界面永远操作同一张表。工具从不接受
 * 归属参数，而是在每次调用时从活着的 Agent 解析；面板接受归属，因为人本来就要选择看谁的记事本，
 * 这是需求本身，不是漏洞。
 *
 * 存储失败只降级不抛出：打不开域的记事本返回稳定错误，不牵动 Harness 的其余部分。
 *
 * @module @veren/notebook
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type { NoteSummary, NoteView, OwnerView } from './types.ts'
import { NOTEBOOK_DOMAIN_NAME, notebookDomain, view } from './storage.ts'
import type { NotebookStore, NotebookTable } from './storage.ts'
import {
  NotebookError, applyUpdate, buildNote, ensureExpected, noteKey, noteView, notesOf, ownersOf,
  requireOwned, summariesOf, validateCreate, validateUpdate,
} from './notes.ts'
import type { NoteRecord } from './types.ts'
import { registerNotebookTools } from './tools.ts'
// Type-only: pulls the `ctx.agentPresets` service declaration into this face.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable private notebooks, one per agent preset. */
    notebook: NotebookService
  }
}

/** Model-facing tool registration. */
export interface NotebookToolConfig {
  /** Register `notebook_*` tools for every agent. */
  enabled: boolean
}

/** Notebook plugin configuration. */
export interface NotebookConfig {
  /** Model-facing tools. */
  tools: NotebookToolConfig
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
})

/** The narrow surface the model-facing tools read and write. */
export interface NotebookToolsPort {
  /** Read one owner's list rows. */
  readonly list: (owner: string) => Promise<readonly NoteSummary[]>
  /** Read one owner's whole note. */
  readonly read: (owner: string, id: string) => Promise<NoteView>
  /** Write one owner's note. */
  readonly create: (owner: string, title: string, body: string) => Promise<NoteView>
  /** Replace fields of one owner's note. */
  readonly update: (
    owner: string,
    id: string,
    patch: { readonly title?: string; readonly body?: string; readonly expectedUpdatedAt?: string },
  ) => Promise<NoteView>
  /** Delete one owner's note; resolves to whether it existed. */
  readonly remove: (owner: string, id: string) => Promise<boolean>
}

/**
 * Notebook service: the plugin's whole host surface.
 *
 * `sessionController` is deliberately not injected. It exists only in the Web
 * application, and a hard dependency on it would leave this plugin pending
 * forever in headless, ACP, and SDK profiles; the panel is reached through the
 * Remote namespace instead, and every owner-scoped read is a plain table query.
 */
export class NotebookService extends TypertRemoteService {
  static inject = ['storageDomain', 'tools', 'agentPresets']
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
  }

  async [Service.init](): Promise<void> {
    await this.ready
  }

  /**
   * List every preset that has a notebook, declared or remembered by its notes.
   * @param _request - no fields; the parameter keeps the Remote call uniform.
   * @returns owners with their note counts and declaration state.
   */
  @Remote('owners')
  async owners(_request: Record<string, never>): Promise<readonly OwnerView[]> {
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
  @Remote('remove')
  async remove(request: { readonly owner: string; readonly id: string }): Promise<{ readonly deleted: boolean }> {
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
    try {
      return await this.host.storageDomain.open(notebookDomain)
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
      remove: async (owner, id) => (await this.remove({ owner, id })).deleted,
    }
  }

  /** One ISO instant, from the one clock the service reads. */
  private now(): string {
    return new Date().toISOString()
  }
}

/** Refuse an empty owner before it reaches a storage key. */
function requireOwner(value: string): string {
  const owner = value.trim()
  if (owner === '') {
    throw new NotebookError('notebook/input-invalid', 'a notebook is always read for one preset owner.')
  }
  return owner
}

export { NotebookError } from './notes.ts'
export {
  EXCERPT_CHARS, MAX_BODY_CHARS, MAX_TITLE_CHARS, applyUpdate, buildNote, ensureExpected, noteKey,
  noteSummary, noteView, notesOf, ownersOf, requireOwned, validateCreate, validateUpdate,
} from './notes.ts'
export { NOTEBOOK_DOMAIN_NAME, notebookDomain } from './storage.ts'
export type { NoteRecord, NoteSummary, NoteView, NotebookErrorCode, OwnerView } from './types.ts'

export default NotebookService
