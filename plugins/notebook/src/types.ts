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

/** One durable note row. `owner` is the preset id that owns it. */
export interface NoteRecord {
  readonly id: string
  readonly owner: string
  readonly title: string
  readonly body: string
  readonly createdAt: string
  readonly updatedAt: string
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
}

/** One note as a list row renders it. */
export interface NoteSummary {
  readonly id: string
  readonly title: string
  readonly excerpt: string
  readonly createdAt: string
  readonly updatedAt: string
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
 * Notebook plugin configuration. Empty today — the global-tools switch retired
 * with the global registration; the field set stays reserved.
 * 记事本插件配置。当前为空——全局注册退役时其开关一并删除；字段集保留备用。
 */
export interface NotebookConfig {
  /** Mount the consult/write tool face into every session of every preset. 把咨询/写入工具面挂进每个预设的任意会话。 */
  readonly globalTools: { readonly enabled: boolean }
}

/**
 * The narrow surface the model-facing tools read and write.
 * 面向模型的工具读写的窄接口。
 */
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
}
