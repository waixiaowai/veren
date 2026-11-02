/**
 * Types shared by the notebook service, its tools, and the Web panel.
 *
 * A note's owner is always the preset id, never a session, a workspace, or a
 * human account. The owner is part of the storage key, so a caller that names
 * another preset's note id reaches a different row rather than that note.
 *
 * 记事本服务、工具与 Web 面板共享的类型。
 *
 * 笔记的归属永远是预设 id，不是会话、不是工作区、也不是人类账号。归属是存储键的一部分，因此
 * 拿着别人笔记 id 的调用者只会落在一个不同的行上，而不是那条笔记。
 *
 * @module @veren/notebook/types
 */

import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The notebook storage domain could not be opened. */
    'notebook/storage-unavailable': Record<string, never>
    /** A field failed validation before any row was written. */
    'notebook/input-invalid': Record<string, never>
    /** A note needs a non-empty title. */
    'notebook/title-required': Record<string, never>
    /** A note body is longer than the stored limit. */
    'notebook/body-too-long': Record<string, never>
    /** No note exists for this owner with that id. */
    'notebook/note-not-found': Record<string, never>
    /** The note changed after the caller read it. */
    'notebook/conflict': Record<string, never>
    /** Another card of this owner already carries the title. */
    'notebook/title-conflict': Record<string, never>
    /** A `[[link]]` in the body targets a title no card carries. */
    'notebook/link-unresolved': Record<string, never>
    /** The card is still linked to by other cards, so deleting it is refused. */
    'notebook/card-referenced': Record<string, never>
    /** The lifecycle action does not apply to this card's type. */
    'notebook/kind-mismatch': Record<string, never>
    /** An archive's distill-back evidence is missing or points at non-permanent cards. */
    'notebook/archive-undistilled': Record<string, never>
  }
}

/** Stable error codes a notebook operation can refuse with. */
export type NotebookErrorCode =
  | 'notebook/storage-unavailable'
  | 'notebook/input-invalid'
  | 'notebook/title-required'
  | 'notebook/body-too-long'
  | 'notebook/note-not-found'
  | 'notebook/conflict'
  | 'notebook/title-conflict'
  | 'notebook/link-unresolved'
  | 'notebook/card-referenced'
  | 'notebook/kind-mismatch'
  | 'notebook/archive-undistilled'

/**
 * The three lifecycle states of one card (Ahrens): `fleeting` is raw intake —
 * fast capture, links may dangle, invisible to the link graph; `permanent` is
 * the compounded product — one idea, resolved links, the graph's only citizen
 * that never retires; `project` is work in progress anchored to a real task
 * (a task-workbench taskId), closed by archiving with distill-back evidence.
 *
 * 卡片的三种生命周期状态（Ahrens）：`fleeting` 是原始进料——快收、链接可悬空、
 * 对链接图不可见；`permanent` 是化合产物——一卡一想法、链接已解析、图中唯一
 * 永不退役的公民；`project` 是在制品，锚在真实任务（task-workbench taskId）上，
 * 结项时凭蒸馏证据归档。
 */
export type NoteKind = 'fleeting' | 'permanent' | 'project'

/** One durable note row. `owner` is the preset id that owns it. */
export interface NoteRecord {
  readonly id: string
  readonly owner: string
  readonly title: string
  readonly body: string
  readonly createdAt: string
  readonly updatedAt: string
  /** The lifecycle state; storage defaults pre-kind v1 rows to `permanent`. */
  readonly kind: NoteKind
  /** Project anchor: the task-workbench taskId this card serves; fleeting cards carry none. */
  readonly anchor?: string | undefined
}

/**
 * One cached link row of the derived `links` table — never a source of truth.
 * `linkKey(owner, sourceId, targetTitle)` composes its key.
 * 派生 `links` 表的一条缓存行——绝不是事实源。键由 `linkKey(owner, sourceId, targetTitle)` 拼装。
 */
export interface LinkRecord {
  readonly owner: string
  readonly sourceId: string
  readonly targetTitle: string
}

/** One note as the panel and the model read it; the owner stays implicit. */
export interface NoteView {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly kind: NoteKind
  readonly anchor?: string | undefined
}

/** One note as a list row renders it. */
export interface NoteSummary {
  readonly id: string
  readonly title: string
  readonly excerpt: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly kind: NoteKind
}

/** One preset that owns a notebook, declared or only remembered by its notes. */
export interface OwnerView {
  readonly id: string
  /** Whether the preset registry still declares this preset. */
  readonly declared: boolean
  readonly noteCount: number
}

/** One card that links to the queried card, as a view row renders it. 链到被查卡片的某张卡，视图行的形状。 */
export interface BacklinkView {
  readonly sourceId: string
  readonly sourceTitle: string
  readonly excerpt: string
}

/** One card the queried card links to, resolved to its id. 被查卡片链向的某张卡，已解析到 id。 */
export interface LinkTargetView {
  readonly targetId: string
  readonly targetTitle: string
}

/** One card's two link directions in one read. 一次读出的某张卡两个链接方向。 */
export interface CardLinkView {
  readonly outgoing: readonly LinkTargetView[]
  readonly incoming: readonly BacklinkView[]
}

/** One hub: a card ranked by inbound links. 一张枢纽卡：按入链数排名的卡片。 */
export interface HubView {
  readonly id: string
  readonly title: string
  readonly inboundCount: number
}

/** Inbound-link count of one card title, for the panel's list badges. 某一标题的入链数，供面板列表角标。 */
export interface LinkCountView {
  readonly title: string
  readonly count: number
}

/** Fields one create call stores. */
export interface NoteFields {
  readonly title: string
  readonly body: string
}

/** Fields one update call may replace. */
export interface NotePatch {
  readonly title?: string
  readonly body?: string
}

/**
 * Notebook plugin configuration.
 * 记事本插件配置。
 */
export interface NotebookConfig {
  /** Mount the consult/write tool face into every session of every preset. 把咨询/写入工具面挂进每个预设的任意会话。 */
  readonly globalTools: { readonly enabled: boolean }
  /** The fleeting card's freshness window, in days; optional — the service clamps and defaults it to 2. 闪念卡的保鲜窗（天）；可省——服务端钳制并默认取 2。 */
  readonly freshness?: { readonly fleetingWindowDays: number }
}
export interface RiddleView {
  readonly aId: string
  readonly aTitle: string
  readonly bId: string
  readonly bTitle: string
  /** How many neighbors the two cards share. 两卡共享的邻居数。 */
  readonly shared: number
}

/** The lifecycle actions one ledger row records. 账表一行所记录的生命周期动作。 */
export type LedgerAction = 'captured' | 'promoted' | 'trashed' | 'archived' | 'riddle_closed'

/** One append-only lifecycle ledger row — the fact base of the breathing readout. 一行追加式生命周期账——呼吸读数的事实基底。 */
export interface LedgerRecord {
  /** The row's storage key (a minted uuid). 行的存储键（铸出的 uuid）。 */
  readonly key: string
  readonly owner: string
  /** The card the action touched; for `riddle_closed`, the card whose write closed it. 动作触及的卡；`riddle_closed` 时是闭合谜面的那张卡的写入者。 */
  readonly cardId: string
  readonly action: LedgerAction
  /** ISO instant of the action. 动作发生的 ISO 时刻。 */
  readonly at: string
}

/**
 * The intake face of one box: its fleeting cards and the overdue ones — the
 * feedstock queue the flywheel is fed through.
 * 某盒的进料面：闪念卡与其中过期的那些——喂养飞轮的进料队列。
 */
export interface BoxIntakeView {
  /** Every fleeting card, oldest first. 全部闪念卡，最早优先。 */
  readonly fleet: readonly NoteSummary[]
  /** Fleeting cards past the freshness window, oldest first. 过保鲜窗的闪念卡，最早优先。 */
  readonly overdue: readonly NoteSummary[]
}

/** One windowed action count of the box's ledger. 账表在某窗口内的一种动作计数。 */
export interface BoxRateView {
  /** How many days the window spans. 窗口天数。 */
  readonly days: number
  /** Fleeting captures in the window. 窗口内的闪念捕获数。 */
  readonly captured: number
  /** Fleeting→permanent promotions in the window. 窗口内的炼成数。 */
  readonly promoted: number
  /** Card deletions in the window. 窗口内的删除数。 */
  readonly trashed: number
  /** Project archives in the window. 窗口内的归档数。 */
  readonly archived: number
  /** Riddles closed by a new direct link in the window. 窗口内被新直链闭合的谜面数。 */
  readonly riddlesClosed: number
}

/**
 * The box's breathing readout: kind mix, graph density, intake depth, and the
 * windowed flywheel rates — the numbers that say whether the box compounds,
 * replacing self-report with measurement.
 * 盒的呼吸读数：类别构成、图密度、进料深度、窗口飞轮速率——这些数字说明盒在不在
 * 复利，用测量替代自辩。
 */
export interface BoxStatsView {
  /** Card count per kind. 按类别的卡片数。 */
  readonly cards: { readonly fleeting: number; readonly permanent: number; readonly project: number }
  /** Cached link rows of the box. 盒的链接缓存行数。 */
  readonly links: number
  /** Links per graph citizen (permanent + project), two decimals. 每张图内卡片的平均链接数，两位小数。 */
  readonly density: number
  /** The intake face. 进料面。 */
  readonly intake: BoxIntakeView
  /** The windowed ledger rates. 窗口内的账表速率。 */
  readonly rates: BoxRateView
}

/** One fleeting card's aging state, derived from the freshness window at read time. 由保鲜窗在读取时派生的闪念老化态。 */
export type FleetingAging = 'fresh' | 'overdue'

/** One card as the canvas face reads it: a list summary plus its two resolved link counts and, for fleeting cards, the derived aging. 画布面读到的一张卡：列表摘要加两个已解析的链接计数；闪念卡另带派生老化。 */
export interface CanvasNodeView {
  readonly id: string
  readonly title: string
  readonly excerpt: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly kind: NoteKind
  /** Resolved inbound-link count; fleeting cards are never targets, so theirs is always 0. 已解析的入链数；闪念永不是目标，恒为 0。 */
  readonly inbound: number
  /** Resolved outbound-link count; fleeting bodies never join the graph, so theirs is always 0. 已解析的出链数；闪念正文不入图，恒为 0。 */
  readonly outbound: number
  /** Fleeting cards only: the derived aging state. 仅闪念卡：派生老化态。 */
  readonly aging?: FleetingAging
  /** Fleeting cards only: the derived deadline (updatedAt + window), ISO. 仅闪念卡：派生到期时刻（updatedAt + 窗口），ISO。 */
  readonly expiresAt?: string
}

/** One resolved graph edge between two card ids; self-edges and dangling targets never surface. 两张卡之间的一条已解析边；自环与悬空目标绝不出现。 */
export interface CanvasEdgeView {
  readonly sourceId: string
  readonly targetId: string
}

/** One box's whole graph face in one read: nodes, resolved edges, riddles, and the breathing readout. 一次读出的某盒整张图面：节点、已解析边、谜面与呼吸读数。 */
export interface BoxGraphView {
  readonly nodes: readonly CanvasNodeView[]
  readonly edges: readonly CanvasEdgeView[]
  readonly riddles: readonly RiddleView[]
  readonly stats: BoxStatsView
}

/**
 * The narrow surface the model-facing tools read and write.
 * 面向模型的工具读写的窄接口。
 */
export interface NotebookToolsPort {
  /** Read one owner's list rows, optionally one kind only. */
  readonly list: (owner: string, kind?: NoteKind) => Promise<readonly NoteSummary[]>
  /** Read one owner's whole note. */
  readonly read: (owner: string, id: string) => Promise<NoteView>
  /** Write one owner's permanent card. */
  readonly create: (owner: string, title: string, body: string) => Promise<NoteView>
  /** Capture one owner's card; the title is minted from the body when omitted; an anchor files it as a project card. 捕获一张卡；标题省略时从正文首行铸出；带 anchor 即归档为项目卡。 */
  readonly capture: (owner: string, body: string, title?: string, anchor?: string) => Promise<NoteView>
  /** Promote one fleeting card into a permanent card under the full write-time discipline. 按完整写入纪律把一张闪念炼成永久卡。 */
  readonly promote: (
    owner: string,
    id: string,
    patch: { readonly title?: string; readonly body?: string; readonly expectedUpdatedAt?: string },
  ) => Promise<NoteView>
  /** Replace fields of one owner's note. */
  readonly update: (
    owner: string,
    id: string,
    patch: { readonly title?: string; readonly body?: string; readonly expectedUpdatedAt?: string },
  ) => Promise<NoteView>
  /** Delete one owner's note; resolves to whether it existed. */
  readonly remove: (owner: string, id: string) => Promise<boolean>
  /** Archive one project card after distill-back; refused while evidence is missing. 蒸馏回流后归档一张项目卡；证据缺失时被拒。 */
  readonly archive: (owner: string, id: string, distilledInto: readonly string[]) => Promise<{ readonly archived: boolean }>
  /** Read one owner's cards that link to the queried card. 读链到被查卡片的那些卡。 */
  readonly backlinks: (owner: string, id: string) => Promise<readonly BacklinkView[]>
  /** Read one owner's most-linked cards — the box's entry points. 读某归属被链接最多的卡片——盒的入口。 */
  readonly hubs: (owner: string) => Promise<readonly HubView[]>
  /** Read one card's outgoing and incoming links in one call. 一次读出某卡的出链与入链。 */
  readonly cardLinks: (owner: string, id: string) => Promise<CardLinkView>
  /** Find one owner's cards by a title fragment — the title-address lookup. 按标题片段找卡——标题寻址查询。 */
  readonly find: (owner: string, query: string) => Promise<readonly NoteSummary[]>
  /** List one owner's waiting-to-be-processed cards (no inbound links, past the freshness window), oldest first. 列出某盒待加工的卡（无入链且过保鲜窗），最早优先。 */
  readonly stale: (owner: string) => Promise<readonly NoteSummary[]>
  /** List one owner's riddles: pairs sharing neighbors without linking. 列出盒的谜面：共享邻居却未互链的卡对。 */
  readonly riddles: (owner: string) => Promise<readonly RiddleView[]>
  /** Read one owner's intake face and flywheel rates. 读某盒的进料面与飞轮速率。 */
  readonly stats: (owner: string) => Promise<BoxStatsView>
}
