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
import type { NoteFields, NotePatch, NoteRecord, NotebookErrorCode, NoteSummary, NoteView, OwnerView } from './types.ts'
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
 * Validate a create call and normalize its fields.
 * @param input - caller-supplied title and body.
 * @returns the fields as stored.
 * @throws NotebookError when the title is empty or the body exceeds its limit.
 */
export function validateCreate(input: NoteFields): NoteFields {
  return { title: cleanTitle(input.title), body: cleanBody(input.body) }
}

/**
 * Validate an update call and normalize only the supplied fields.
 * @param input - caller-supplied replacement fields.
 * @returns the fields to replace; absent fields stay untouched.
 * @throws NotebookError when neither field is supplied or a field is invalid.
 */
export function validateUpdate(input: NotePatch): NotePatch {
  if (input.title === undefined && input.body === undefined) {
    throw new NotebookError('notebook/input-invalid', 'an update needs a title, a body, or both.')
  }
  return {
    ...input.title === undefined ? {} : { title: cleanTitle(input.title) },
    ...input.body === undefined ? {} : { body: cleanBody(input.body) },
  }
}

/** Normalize a title, refusing an empty one. */
function cleanTitle(value: string): string {
  const title = value.trim()
  if (title === '') throw new NotebookError('notebook/title-required', 'a note needs a title.')
  if ([...title].length > MAX_TITLE_CHARS) {
    throw new NotebookError('notebook/input-invalid', `a title is at most ${String(MAX_TITLE_CHARS)} characters.`)
  }
  return title
}

/** Normalize a body and enforce the stored limit. */
function cleanBody(value: string): string {
  const body = value.trim()
  const length = [...body].length
  if (length > MAX_BODY_CHARS) {
    throw new NotebookError(
      'notebook/body-too-long',
      `a note body is at most ${String(MAX_BODY_CHARS)} characters; this one has ${String(length)}.`,
    )
  }
  return body
}

/**
 * Build one durable note.
 * @param owner - preset id that owns the note.
 * @param fields - validated title and body.
 * @param now - ISO instant used for both timestamps.
 * @param id - note id; minted when omitted.
 * @returns the row to store.
 */
export function buildNote(owner: string, fields: NoteFields, now: string, id = mintNoteId()): NoteRecord {
  return { id, owner, title: fields.title, body: fields.body, createdAt: now, updatedAt: now }
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
 * Refuse an update based on a stale read.
 * @param record - the row as it exists now.
 * @param expected - the update time the caller last saw, when it checks.
 * @throws NotebookError `conflict` when the row moved on.
 */
export function ensureExpected(record: NoteRecord, expected: string | undefined): void {
  if (expected === undefined || expected === record.updatedAt) return
  throw new NotebookError(
    'notebook/conflict',
    `this note changed at ${record.updatedAt}; read it again before saving.`,
  )
}

/**
 * Project one stored note for the model and the panel.
 * @param record - the stored row.
 * @returns the note without its owner.
 */
export function noteView(record: NoteRecord): NoteView {
  const { id, title, body, createdAt, updatedAt } = record
  return { id, title, body, createdAt, updatedAt }
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
 * @returns that owner's notes, never another owner's.
 */
export function notesOf(table: NotebookTable<NoteRecord>, owner: string): NoteView[] {
  return recordsOf(table, owner).map(noteView)
}

/**
 * Read one owner's notes as list rows, newest update first.
 * @param table - the notes table.
 * @param owner - preset id whose notebook is listed.
 * @returns that owner's summaries, never another owner's.
 */
export function summariesOf(table: NotebookTable<NoteRecord>, owner: string): NoteSummary[] {
  return recordsOf(table, owner).map(noteSummary)
}

/** One owner's rows, newest update first. */
function recordsOf(table: NotebookTable<NoteRecord>, owner: string): NoteRecord[] {
  return table.all()
    .filter(record => record.owner === owner)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
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
