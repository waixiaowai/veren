/**
 * Notebook: one private, durable card box per agent preset — the Zettelkasten
 * contract (docs/notebook-zettelkasten-design.cn.md) on the notebook domain.
 *
 * Every card is owned by the preset id of the Agent that wrote it; the title
 * is unique per owner and is the card's link address. Bodies carry `[[title]]`
 * links; the derived `links` cache is maintained by every write and answers
 * the backlink/hub queries — the box talking back. The same record set is
 * served to people through the `notebook` Remote namespace and to models
 * through the tool builders this package exports — the builders are the one
 * model-facing implementation, and a mounter registers them; this package
 * registers nothing into `ctx.tools`. Tools never take an owner; they resolve
 * it from the live Agent on every call. The panel does take an owner because a
 * human is choosing whose notebook to read, which is the requested behaviour
 * rather than a hole. Storage failure degrades rather than throws. The
 * application layer — the only registration face — lives in the separate
 * `@veren/notebook-app` package (G2 package split), so this host injects no
 * application framework and activates wherever the host does.
 *
 * 记事本：每个 agent 预设一只私密、持久的卡片盒——落在 notebook 域上的卡片笔记
 * 法契约（docs/notebook-zettelkasten-design.cn.md）。
 *
 * 每张卡归属于写入它的 Agent 的预设 id；标题在归属内唯一，且就是卡片链接地址。
 * 正文携带 `[[标题]]` 链接；派生的 `links` 缓存随每次写入维护，应答反链/枢纽查询
 * ——这是盒在回话。同一份记录集合既经 `notebook` 远端命名空间提供给人，也经本包
 * 导出的工具构建器提供给模型——构建器是唯一的面向模型实现，注册归挂载方；本包
 * 自己不向 `ctx.tools` 注册任何东西。工具从不接受归属参数，而是在每次调用时从活着
 * 的 Agent 解析；面板接受归属，因为人本来就要选择看谁的记事本，这是需求本身，不是
 * 漏洞。存储失败只降级不抛出。应用层——唯一的注册面——住在独立的
 * `@veren/notebook-app` 包里（G2 拆包），因此本宿主不 inject 应用框架，宿主激活即
 * 服务激活。
 *
 * @module @veren/notebook
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type {
  BacklinkView, BoxGraphView, BoxStatsView, CardLinkView, HubView, LinkCountView, NoteKind, NoteSummary, NoteView,
  NotebookConfig, NotebookToolsPort, OwnerView, RiddleView,
} from './types.ts'
import { NotebookStoreHandle } from './store.ts'
import { registerNotebookGlobalTools } from './tools-global.ts'
import { NotebookError } from './notes.ts'
import { boxGraphView } from './boxgraph.ts'
import {
  backlinkViewOf, cachedBacklinks, hubView, linkCounts as countLinks, outgoingOf, staleView,
} from './graph.ts'
import { riddlePairs } from './riddles.ts'
import { boxStats } from './stats.ts'
import { applyCardCreate, applyCardRemove, applyCardUpdate } from './cards.ts'
import { applyCardArchive, applyCardCapture, applyCardPromote } from './lifecycle.ts'
import {
  exportMarkdown, findCards, noteView, notesOf, ownersOf, requireOwner, requireOwned, summariesOf,
} from './notes.ts'
// Type-only: pulls the `ctx.agentPresets` service declaration into this face.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable private card boxes, one per agent preset. */
    notebook: NotebookService
  }
}

/**
 * Config schema: the preset-wide global tool face (M1 of
 * docs/notebook-roadmap.cn.md) and the fleeting freshness window. Disable the
 * former to keep the box page-only; the window only moves visibility, never
 * deletes (docs/notebook-note-types.cn.md §2).
 * Config schema：预设全域工具面（docs/notebook-roadmap.cn.md 的 M1）与闪念保鲜
 * 窗。关掉前者盒子就回到仅页面可用；窗口只改变可见性，绝不删除
 * （docs/notebook-note-types.cn.md §2）。
 */
export const Config: z<NotebookConfig> = z.object({
  globalTools: z
    .object({ enabled: z.boolean().default(true).description('Mount the consult/write face in every session.') })
    .default({ enabled: true })
    .description('The preset-wide card-box face: consult and feed the box from any session of the preset; page sessions shadow it with the same names.'),
  freshness: z
    .object({
      fleetingWindowDays: z
        .number()
        .default(2)
        .description('Days a fleeting card stays fresh before the intake face flags it overdue; visibility only, never a timer.'),
    })
    .default({ fleetingWindowDays: 2 })
    .description('The fleeting card freshness window.'),
}).description('Notebook host-layer options.')

/** Floor of the freshness window: a window below one day is meaningless. 保鲜窗下限：小于一天没有意义。 */
const MIN_WINDOW_DAYS = 1

/** Ceiling of the freshness window: guards against a fat-fingered config. 保鲜窗上限：防手滑配置。 */
const MAX_WINDOW_DAYS = 365

/**
 * Clamp the configured window into the legal range, flooring to a whole day.
 * 把配置的窗口钳制进合法区间，向下取整到整天。
 */
export function clampWindowDays(value: number): number {
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.floor(value)))
}

/** Hubs returned per ranking; enough entry points without flooding a first screen. 每次排名返回的枢纽数；足够做入口又不淹没首屏。 */
const HUB_LIMIT = 10

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
  static inject = ['storageDomain', 'agentPresets', 'tools']
  static Config = Config

  /** The plugin's own reference to the owning Context. */
  private readonly host: Context
  /** Storage lifecycle: the open domain, its write chain, the migration rebuild. 存储生命周期：打开的域、写链与迁移重建。 */
  private readonly store: NotebookStoreHandle
  /** The configured fleeting freshness window, clamped. 已钳制的闪念保鲜窗配置。 */
  private readonly fleetingDays: number

  /**
   * @param ctx - Host services owning storage and the preset registry.
   * @param config - validated plugin configuration; `globalTools.enabled`
   *   mounts the consult/write face into every session (M1), and
   *   `freshness.fleetingWindowDays` sets the intake visibility window.
   */
  constructor(ctx: Context, config: NotebookConfig) {
    super(ctx, 'notebook', { namespace: 'notebook' })
    this.host = ctx
    this.store = new NotebookStoreHandle(ctx)
    this.fleetingDays = clampWindowDays(config.freshness?.fleetingWindowDays ?? 2)
    // 全局面：每个会话都能咨询与喂养盒子；页面会话以同名 agent 作用域注册遮蔽。
    // / The global face: every session consults and feeds the box; page sessions
    // shadow it with same-name agent-scope registrations.
    if (config.globalTools.enabled) registerNotebookGlobalTools(ctx, () => this.toolsPort())
  }

  async [Service.init](): Promise<void> {
    await this.store.settle()
  }

  /** List every preset that has a box, declared or remembered by its cards. 列出每只存在的卡片盒（声明过或被卡片记得），带卡片数与声明状态。 */
  @Remote('owners')
  async owners(request: Record<string, never>): Promise<readonly OwnerView[]> {
    void request
    return this.store.read(async domain => ownersOf(this.store.tables(domain).notes, await this.declaredPresets()))
  }

  /** Read one preset's cards, newest update first; the owner is chosen by the human. 读某个预设的全部卡片，最新更新在前；归属由人选定。 */
  @Remote('list')
  async list(request: { readonly owner: string; readonly kind?: NoteKind }): Promise<readonly NoteView[]> {
    const owner = requireOwner(request.owner)
    return this.store.read(domain => notesOf(this.store.tables(domain).notes, owner, request.kind))
  }

  /** Read one card in one preset's box. 读某只卡片盒里的一张卡。 */
  async readNote(owner: string, id: string): Promise<NoteView> {
    const preset = requireOwner(owner)
    return this.store.read(domain => noteView(requireOwned(this.store.tables(domain).notes, preset, id)))
  }

  /** Read one preset's list rows, newest update first, optionally one kind. 读某个预设的列表行，最新更新在前，可只取一类。 */
  private async listSummaries(owner: string, kind?: NoteKind): Promise<readonly NoteSummary[]> {
    const preset = requireOwner(owner)
    return this.store.read(domain => summariesOf(this.store.tables(domain).notes, preset, kind))
  }

  /** Capture one card into one preset's box; an anchor files it as a project card. 往某只卡片盒捕获一张卡；带 anchor 即项目卡。 */
  @Remote('capture')
  async capture(request: {
    readonly owner: string
    readonly body: string
    readonly title?: string
    readonly anchor?: string
  }): Promise<NoteView> {
    const owner = requireOwner(request.owner)
    return this.store.write(async (domain) => {
      const record = await applyCardCapture(
        this.store.tables(domain), owner,
        {
          body: request.body,
          ...(request.title === undefined ? {} : { title: request.title }),
          ...(request.anchor === undefined ? {} : { anchor: request.anchor }),
        },
        this.now(),
      )
      return noteView(record)
    })
  }

  /** Promote one fleeting card into a permanent card — the compounding step. 把一张闪念炼成永久卡——化合步。 */
  @Remote('promoteNote')
  async promoteNote(request: {
    readonly owner: string
    readonly id: string
    readonly title?: string
    readonly body?: string
    readonly expectedUpdatedAt?: string
  }): Promise<NoteView> {
    const owner = requireOwner(request.owner)
    return this.store.write(async (domain) => {
      const record = await applyCardPromote(this.store.tables(domain), owner, request.id, request, this.now())
      return noteView(record)
    })
  }

  /** Archive one project card with distill-back evidence. 凭蒸馏证据归档一张项目卡。 */
  @Remote('archiveNote')
  async archiveNote(request: {
    readonly owner: string
    readonly id: string
    readonly distilledInto: readonly string[]
  }): Promise<{ readonly archived: boolean }> {
    const owner = requireOwner(request.owner)
    return this.store.write(async domain => ({
      archived: await applyCardArchive(this.store.tables(domain), owner, request.id, request.distilledInto, this.now()),
    }))
  }

  /** Read one box's breathing readout: kind mix, density, intake, flywheel rates. 读某盒的呼吸读数：类别构成、密度、进料、飞轮速率。 */
  @Remote('boxStats')
  async boxStats(request: { readonly owner: string }): Promise<BoxStatsView> {
    const owner = requireOwner(request.owner)
    return this.store.read((domain) => {
      const { notes, links, ledger } = this.store.tables(domain)
      return boxStats(notes, links, ledger, owner, Date.now(), this.fleetingDays)
    })
  }

  /** Read one box's whole graph face in one call: nodes, edges, riddles, stats. 一次读出某盒的整张图面：节点、边、谜面与呼吸读数。 */
  @Remote('boxGraph')
  async boxGraph(request: { readonly owner: string }): Promise<BoxGraphView> {
    const owner = requireOwner(request.owner)
    return this.store.read((domain) => {
      const { notes, links, ledger } = this.store.tables(domain)
      return boxGraphView(notes, links, ledger, owner, Date.now(), this.fleetingDays)
    })
  }

  /** Find one preset's cards by a title fragment, newest first; a blank fragment is refused — list_notes is the everything view. 按标题片段找某预设的卡，最新在前；空白片段拒绝——要看全部用 list_notes。 */
  private async findSummaries(owner: string, query: string): Promise<readonly NoteSummary[]> {
    const preset = requireOwner(owner)
    if (query.trim() === '') {
      throw new NotebookError(
        'notebook/input-invalid',
        'a title lookup needs a non-blank fragment; list_notes shows every card.',
      )
    }
    return this.store.read(domain => findCards(this.store.tables(domain).notes, preset, query))
  }

  /** Write one card into one preset's box; returns the stored card. 往某只卡片盒写一张卡，返回存储后的卡片。 */
  @Remote('create')
  async create(request: {
    readonly owner: string
    readonly title: string
    readonly body: string
  }): Promise<NoteView> {
    const owner = requireOwner(request.owner)
    return this.store.write(async (domain) => {
      const record = await applyCardCreate(
        this.store.tables(domain), owner, { title: request.title, body: request.body }, this.now(),
      )
      return noteView(record)
    })
  }

  /** Replace fields of one card (optional optimistic guard); a rename retargets inbound links. 替换一张卡的字段（可选乐观守卫）；改名会让所有入链自动改指。 */
  @Remote('update')
  async update(request: {
    readonly owner: string
    readonly id: string
    readonly title?: string
    readonly body?: string
    readonly expectedUpdatedAt?: string
  }): Promise<NoteView> {
    const owner = requireOwner(request.owner)
    return this.store.write(async (domain) => {
      const record = await applyCardUpdate(this.store.tables(domain), owner, request.id, request, this.now())
      return noteView(record)
    })
  }

  /** Delete one card; refused while other cards still link to it. 删除一张卡；仍有卡链接它时被拒。 */
  @Remote('deleteNote')
  async deleteNote(request: { readonly owner: string; readonly id: string }): Promise<{ readonly deleted: boolean }> {
    const owner = requireOwner(request.owner)
    return this.store.write(async domain => ({
      deleted: await applyCardRemove(this.store.tables(domain), owner, request.id, this.now()),
    }))
  }

  /** Read one card's outgoing and incoming links — the box answering back. 读一张卡的出链与入链——盒在回话。 */
  @Remote('cardLinks')
  async cardLinks(request: { readonly owner: string; readonly id: string }): Promise<CardLinkView> {
    const owner = requireOwner(request.owner)
    return this.store.read((domain) => {
      const { notes, links } = this.store.tables(domain)
      const record = requireOwned(notes, owner, request.id)
      const incoming = cachedBacklinks(links, owner, record.title)
        .map(row => backlinkViewOf(notes, owner, row))
        .filter((view): view is BacklinkView => view !== undefined)
      return { outgoing: outgoingOf(notes, owner, record.body), incoming }
    })
  }

  /** List the box's most-linked cards — its entry points. 列出盒内被链接最多的卡片——它的入口。 */
  @Remote('hubs')
  async hubs(request: { readonly owner: string }): Promise<readonly HubView[]> {
    const owner = requireOwner(request.owner)
    return this.store.read((domain) => {
      const { notes, links } = this.store.tables(domain)
      return hubView(notes, links, owner, HUB_LIMIT)
    })
  }

  /** List one box's waiting-to-be-processed cards (no inbound links, past the freshness window), oldest first. 列出某盒待加工的卡（无入链且过保鲜窗），最早优先。 */
  @Remote('stale')
  async stale(request: { readonly owner: string }): Promise<readonly NoteSummary[]> {
    const owner = requireOwner(request.owner)
    return this.store.read((domain) => {
      const { notes, links } = this.store.tables(domain)
      return staleView(notes, links, owner, Date.now())
    })
  }

  /** List the box's riddles: card pairs sharing neighbors without linking each other. 列出盒的谜面：共享邻居却未互链的卡对。 */
  @Remote('riddles')
  async riddles(request: { readonly owner: string }): Promise<readonly RiddleView[]> {
    const owner = requireOwner(request.owner)
    return this.store.read((domain) => {
      const { notes, links } = this.store.tables(domain)
      return riddlePairs(notes, links, owner)
    })
  }

  /** Export one box as one portable markdown document, newest first; read-only. 把某盒导出为单份可携带 markdown，最新在前；只读。 */
  @Remote('exportAll')
  async exportAll(request: { readonly owner: string }): Promise<{ readonly count: number; readonly markdown: string }> {
    const owner = requireOwner(request.owner)
    return this.store.read(domain => exportMarkdown(this.store.tables(domain).notes, owner))
  }

  /** Count inbound links per card title, for the panel's list badges. 按标题统计入链数，供面板列表角标。 */
  @Remote('linkCounts')
  async linkCounts(request: { readonly owner: string }): Promise<readonly LinkCountView[]> {
    const owner = requireOwner(request.owner)
    return this.store.read((domain) => {
      const { notes, links } = this.store.tables(domain)
      return countLinks(notes, links, owner)
    })
  }

  /**
   * The narrow surface the model-facing tools read and write. Public by design:
   * the app layer and any other mounter of the exported builders ride this one
   * port, so every tool acts on the one table the panel reads.
   * 面向模型的工具读写的窄接口。刻意公开：应用层与任何其他挂载方走同一端口，每个工具都写在面板所读的同一张表上。
   */
  toolsPort(): NotebookToolsPort {
    return {
      list: (owner, kind) => this.listSummaries(owner, kind),
      read: (owner, id) => this.readNote(owner, id),
      create: (owner, title, body) => this.create({ owner, title, body }),
      capture: (owner, body, title, anchor) => this.capture({
        owner, body,
        ...(title === undefined ? {} : { title }),
        ...(anchor === undefined ? {} : { anchor }),
      }),
      promote: (owner, id, patch) => this.promoteNote({ owner, id, ...patch }),
      update: (owner, id, patch) => this.update({ owner, id, ...patch }),
      remove: async (owner, id) => (await this.deleteNote({ owner, id })).deleted,
      archive: (owner, id, distilledInto) => this.archiveNote({ owner, id, distilledInto }),
      backlinks: async (owner, id) => (await this.cardLinks({ owner, id })).incoming,
      hubs: owner => this.hubs({ owner }),
      cardLinks: (owner, id) => this.cardLinks({ owner, id }),
      find: (owner, query) => this.findSummaries(owner, query),
      stale: owner => this.stale({ owner }),
      riddles: owner => this.riddles({ owner }),
      stats: owner => this.boxStats({ owner }),
    }
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

  /** One ISO instant, from the one clock the service reads. */
  private now(): string {
    return new Date().toISOString()
  }
}

export {
  EXCERPT_CHARS, EXPORT_SEPARATOR, FIND_LIMIT, MAX_BODY_CHARS, MAX_TITLE_CHARS, NotebookError,
  applyUpdate, buildNote, exportMarkdown, findCards, noteKey, noteSummary, noteView, notesOf,
  ownersOf, requireOwner, requireOwned, titlesContaining,
} from './notes.ts'
export { mintFleetingTitle } from './lifecycle.ts'
export { ensureExpected, resolveLinksOrThrow, validateCapture, validateCreate, validateUpdate } from './validate.ts'
export { riddlePairs, RIDDLE_MIN_SHARED, riddleClosedByLink } from './riddles.ts'
export { staleView, STALE_DAYS } from './graph.ts'
export { boxGraphView } from './boxgraph.ts'
export { DAY_MS, FLEETING_DAYS, agingOf, expiresAtOf, intakeView, isOverdue } from './queue.ts'
export { appendLedger, ledgerSince } from './ledger.ts'
export { boxStats, RATES_WINDOW_DAYS } from './stats.ts'
export { extractLinks } from './links.ts'
export { applyCardCreate, applyCardRemove, applyCardUpdate } from './cards.ts'
export { applyCardArchive, applyCardCapture, applyCardPromote } from './lifecycle.ts'
export type { CardTables } from './cards.ts'
export { NOTEBOOK_DOMAIN_NAME, NOTEBOOK_DOMAIN_VERSION, notebookDomain } from './storage.ts'
export {
  buildNotebookDeleteDefinition, buildNotebookListDefinition, buildNotebookReadDefinition,
  buildNotebookRewriteDefinition, buildNotebookWriteDefinition,
} from './tools.ts'
export { buildNotebookCaptureDefinition } from './tools.ts'
export { buildNotebookBacklinksDefinition, buildNotebookFindDefinition, buildNotebookHubsDefinition, buildNotebookStatsDefinition } from './tools-graph.ts'
export { buildNotebookArchiveDefinition, buildNotebookPromoteDefinition } from './tools-lifecycle.ts'
export { GLOBAL_TOOL_NAMES, registerNotebookGlobalTools } from './tools-global.ts'
export type {
  BacklinkView, BoxGraphView, BoxIntakeView, BoxRateView, BoxStatsView, CanvasEdgeView, CanvasNodeView,
  CardLinkView, FleetingAging, HubView, LedgerAction, LedgerRecord,
  LinkCountView, LinkRecord, LinkTargetView, NoteKind, NoteRecord,
  NoteSummary, NoteView, NotebookConfig, NotebookErrorCode, NotebookToolsPort, OwnerView, RiddleView,
} from './types.ts'

export default NotebookService
