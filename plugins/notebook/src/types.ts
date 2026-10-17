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

/** One durable note row. `owner` is the preset id that owns it. */
export interface NoteRecord {
  readonly id: string
  readonly owner: string
  readonly title: string
  readonly body: string
  readonly createdAt: string
  readonly updatedAt: string
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
