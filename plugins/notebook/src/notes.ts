/**
 * Note rules that carry no Host: keys, validation, ownership, and projections.
 *
 * Every lookup goes through {@link noteKey}, which embeds the owner. That is the
 * structural half of notebook privacy: a preset that passes another preset's
 * note id still composes a key under its own owner, so the row it reaches is a
 * miss, not the other preset's note. The service never accepts an owner from a
 * model-facing tool.
 *
 * 不依赖宿主的笔记规则：键、校验、归属与投影。
 *
 * 每次查找都经过 {@link noteKey}，而键里带着归属。这就是记事本隐私的结构性一半：预设即使传了
 * 另一个预设的笔记 id，也只会按自己的归属拼出键，因此命中的是「不存在」，而不是别人的笔记。
 * 服务也从不接受面向模型的工具传来的归属。
 *
 * @module @veren/notebook/notes
 */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { NoteFields, NoteKind, NotePatch, NoteRecord, NotebookErrorCode, NoteSummary, NoteView, OwnerView } from './types.ts'
import type { NotebookTable } from './storage.ts'

/** Longest title accepted, in characters. */
export const MAX_TITLE_CHARS = 200

/** Longest body accepted, in characters. */
export const MAX_BODY_CHARS = 100_000

/** Characters of the body a list row shows. */
export const EXCERPT_CHARS = 160

/** One structured notebook refusal, carried across the Remote wire as a code. */
export class NotebookError extends RemoteError<NotebookErrorCode> {
  /**
   * @param code - stable machine-readable reason.
   * @param message - human-readable account of the refusal.
   */
  constructor(code: NotebookErrorCode, message: string) {
    super(code, message, {})
  }
}

/**
 * Compose the storage key for one owner's note.
 * @param owner - preset id that owns the note.
 * @param id - note id inside that owner's notebook.
 * @returns the owner-scoped storage key.
 */
export function noteKey(owner: string, id: string): string {
  return `${encodeURIComponent(owner)}/${id}`
}

/** Mint one note id. */
export function mintNoteId(): string {
  return crypto.randomUUID()
}

/**
 * Refuse an empty owner before it reaches a storage key.
 * @param value - the owner a caller named.
 * @returns the trimmed preset id.
 * @throws NotebookError when the owner is empty.
 */
export function requireOwner(value: string): string {
  const owner = value.trim()
  if (owner === '') {
    throw new NotebookError('notebook/input-invalid', 'a notebook is always read for one preset owner.')
  }
  return owner
}

/**
 * Build one durable note.
 * @param owner - preset id that owns the note.
 * @param fields - validated title and body.
 * @param now - ISO instant used for both timestamps.
 * @param id - note id; minted when omitted.
 * @param kind - the lifecycle state; a plain write is a permanent card.
 * @param anchor - the project anchor (taskId), when the card is a project card.
 * @returns the row to store.
 */
export function buildNote(owner: string, fields: NoteFields, now: string, id = mintNoteId(), kind: NoteKind = 'permanent', anchor?: string): NoteRecord {
  return {
    id, owner, title: fields.title, body: fields.body, createdAt: now, updatedAt: now, kind,
    ...(anchor === undefined ? {} : { anchor }),
  }
}

/**
 * Apply one validated patch to a stored note.
 * @param record - the existing row.
 * @param patch - fields to replace.
 * @param now - ISO instant recorded as the new update time.
 * @returns the row to store.
 */
export function applyUpdate(record: NoteRecord, patch: NotePatch, now: string): NoteRecord {
  return {
    ...record,
    ...patch.title === undefined ? {} : { title: patch.title },
    ...patch.body === undefined ? {} : { body: patch.body },
    updatedAt: now,
  }
}

/**
 * Project one stored note for the model and the panel.
 * @param record - the stored row.
 * @returns the note without its owner.
 */
export function noteView(record: NoteRecord): NoteView {
  const { id, title, body, createdAt, updatedAt, kind } = record
  return { id, title, body, createdAt, updatedAt, kind, ...(record.anchor === undefined ? {} : { anchor: record.anchor }) }
}

/**
 * Project one stored note as a list row.
 * @param record - the stored row.
 * @returns the title, timestamps, and an elided body excerpt.
 */
export function noteSummary(record: NoteRecord): NoteSummary {
  return {
    id: record.id,
    title: record.title,
    excerpt: excerptOf(record.body),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    kind: record.kind,
  }
}

/** One body's opening characters, flattened to a single line. */
function excerptOf(body: string): string {
  const flat = body.replaceAll(/\s+/g, ' ').trim()
  const characters = [...flat]
  return characters.length <= EXCERPT_CHARS ? flat : `${characters.slice(0, EXCERPT_CHARS).join('')}…`
}

/**
 * Read one owner's notes, newest update first.
 * @param table - the notes table.
 * @param owner - preset id whose notebook is read.
 * @param kind - optional lifecycle filter; absent means every kind.
 * @returns that owner's notes, never another owner's.
 */
export function notesOf(table: NotebookTable<NoteRecord>, owner: string, kind?: NoteKind): NoteView[] {
  return recordsOf(table, owner, kind).map(noteView)
}

/**
 * Read one owner's notes as list rows, newest update first.
 * @param table - the notes table.
 * @param owner - preset id whose notebook is listed.
 * @param kind - optional lifecycle filter; absent means every kind.
 * @returns that owner's summaries, never another owner's.
 */
export function summariesOf(table: NotebookTable<NoteRecord>, owner: string, kind?: NoteKind): NoteSummary[] {
  return recordsOf(table, owner, kind).map(noteSummary)
}

/** One owner's rows, newest update first, optionally one kind only. 某归属的行，最新在前，可选只取一类。 */
function recordsOf(table: NotebookTable<NoteRecord>, owner: string, kind?: NoteKind): NoteRecord[] {
  return table.all()
    .filter(record => record.owner === owner && (kind === undefined || record.kind === kind))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
}

/**
 * One owner's cards whose title contains the fragment, newest first — the one
 * matcher behind `find_cards` and the refusal suggestions, so both faces always
 * share the same title semantics. Titles are exact addresses: matching is
 * case- and normalization-sensitive, never fuzzy, exactly like the link parser
 * resolves them.
 *
 * 标题含某片段的归属内卡片，最新在前——`find_cards` 与拒绝建议共用的唯一匹配器，
 * 两个面永远共享同一套标题语义。标题是精确地址：匹配区分大小写、不做归一、
 * 绝不模糊，与链接解析器的语义一致。
 * @param table - the notes table.
 * @param owner - preset id whose box is searched.
 * @param needle - the title fragment; trimmed here, empty yields nothing.
 * @returns the matching records, newest update first.
 */
export function titlesContaining(table: NotebookTable<NoteRecord>, owner: string, needle: string): NoteRecord[] {
  const fragment = needle.trim()
  if (fragment === '') return []
  return recordsOf(table, owner).filter(record => record.title.includes(fragment))
}

/** The row cap one find_cards call returns. 单次 find_cards 调用返回的行数上限。 */
export const FIND_LIMIT = 20

/**
 * The title-address lookup behind find_cards: one owner's cards whose title
 * contains the fragment, newest first, capped at {@link FIND_LIMIT}. Locating
 * an older card by its address and checking for a near-duplicate title before
 * writing are the same cheap query.
 *
 * find_cards 背后的标题寻址查询：标题含片段的归属内卡片，最新在前，上限
 * {@link FIND_LIMIT}。按地址找旧卡与写前查重，是同一个廉价查询。
 * @param table - the notes table.
 * @param owner - preset id whose box is searched.
 * @param query - the caller's title fragment.
 * @returns the matching summaries, newest first.
 */
export function findCards(table: NotebookTable<NoteRecord>, owner: string, query: string): NoteSummary[] {
  return titlesContaining(table, owner, query).slice(0, FIND_LIMIT).map(noteSummary)
}

/**
 * List every preset that has a notebook.
 * @param table - the notes table.
 * @param declared - preset ids the registry still declares.
 * @returns declared presets plus owners remembered only by their notes.
 */
export function ownersOf(table: NotebookTable<NoteRecord>, declared: readonly string[]): OwnerView[] {
  const counts = new Map<string, number>()
  for (const record of table.all()) counts.set(record.owner, (counts.get(record.owner) ?? 0) + 1)
  const names = new Set<string>(declared)
  for (const owner of counts.keys()) names.add(owner)
  const declaredSet = new Set(declared)
  return [...names]
    .sort((left, right) => left.localeCompare(right))
    .map(id => ({ id, declared: declaredSet.has(id), noteCount: counts.get(id) ?? 0 }))
}

/**
 * Resolve one owner's note or refuse.
 * @param table - the notes table.
 * @param owner - preset id that must own the note.
 * @param id - note id inside that owner's notebook.
 * @returns the stored row.
 * @throws NotebookError `note-not-found` when the owner does not hold that id.
 */
export function requireOwned(table: NotebookTable<NoteRecord>, owner: string, id: string): NoteRecord {
  const record = table.get(noteKey(owner, id))
  if (record === undefined || record.owner !== owner) {
    throw new NotebookError('notebook/note-not-found', `no note with id "${id}" in this notebook.`)
  }
  return record
}

/** The section separator inside one exported markdown document. 导出文档内的分节分隔线。 */
export const EXPORT_SEPARATOR = '\n\n---\n\n'

/**
 * Render one owner's whole box as a single portable markdown document, newest
 * first — the escape hatch (Ahrens 10: organize development, not output; the
 * box must be able to leave). Read-only: nothing is written anywhere. Each
 * card is a `# title` section with its body verbatim ([[links]] stay links)
 * and an id/date footer; sections separate on a horizontal rule.
 * @param table - the notes table.
 * @param owner - preset id whose box is exported.
 * @returns the card count and the document (empty string when the box is empty).
 *
 * 把某归属整只盒渲染成单份可携带 markdown 文档，最新在前——逃生门（Ahrens 10：
 * 组织的是发展不是产出；盒必须能离开）。只读：不写任何地方。每张卡是一个
 * `# 标题` 小节，正文原样（[[链接]]保持链接）带 id/日期脚注；小节间以水平线分隔。
 */
export function exportMarkdown(table: NotebookTable<NoteRecord>, owner: string): { count: number; markdown: string } {
  const records = recordsOf(table, owner)
  const nl = String.fromCharCode(10)
  const markdown = records
    .map(record => [
      `# ${record.title}`,
      '',
      record.body,
      '',
      `- id: ${record.id}`,
      `- created: ${record.createdAt}`,
      `- updated: ${record.updatedAt}`,
    ].join(nl))
    .join(EXPORT_SEPARATOR)
  return { count: records.length, markdown }
}
