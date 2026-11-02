/**
 * The write-time rules: field validation, title uniqueness, link resolution,
 * and the delete guard.
 *
 * Every refusal is a stable `notebook/*` code with a model-facing account, and
 * every check runs before the first row is written — a card that would violate
 * the box's invariants never reaches storage. Uniqueness and resolution need
 * the tables, so callers run these inside one write transaction (the domain's
 * write chain), never against a stale snapshot.
 *
 * 写入时规则：字段校验、标题唯一性、链接解析与删除守卫。
 *
 * 每次拒绝都是稳定的 `notebook/*` 码加一份面向模型的说明；每项检查都跑在第一行
 * 落库之前——会违反盒不变量的卡片根本到不了存储。唯一性与解析需要表，因此调用方
 * 把它们放在同一次写事务（域的写链）里跑，绝不对着过期快照跑。
 *
 * @module @veren/notebook/validate
 */

import { MAX_BODY_CHARS, MAX_TITLE_CHARS, NotebookError, noteKey, requireOwned } from './notes.ts'
import { cachedBacklinks, distinctTargets, resolveTitle } from './graph.ts'
import type { NotebookTable } from './storage.ts'
import type { LinkRecord, NoteFields, NotePatch, NoteRecord } from './types.ts'

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
    `this card changed at ${record.updatedAt}; read it again before saving.`,
  )
}

/**
 * Refuse a title another owner card already carries — titles are link
 * addresses, so they must stay unique inside one box.
 * @param notes - the notes table.
 * @param owner - preset id whose box is written.
 * @param title - the title being claimed.
 * @param excludeId - the card being updated, whose own title may repeat.
 * @throws NotebookError `title-conflict` naming the card that holds the title.
 */
export function ensureTitleAvailable(notes: NotebookTable<NoteRecord>, owner: string, title: string, excludeId?: string): void {
  const clash = notes.all().find(row => row.owner === owner && row.title === title && row.id !== excludeId)
  if (clash !== undefined) {
    throw new NotebookError(
      'notebook/title-conflict',
      `a card titled "${title}" already exists (id ${clash.id}). Titles are link addresses and must stay unique`
        + ' inside one notebook; pick a more specific phrase or extend the existing card instead.',
    )
  }
}

/**
 * Refuse a body whose `[[links]]` do not all resolve inside the owner's box —
 * a dangling link must never reach storage (invariant I3).
 * @param notes - the notes table.
 * @param owner - preset id whose box is written.
 * @param body - the body being written.
 * @throws NotebookError `link-unresolved` listing the missing targets and the
 *   closest existing titles, so the writer can self-correct.
 */
export function resolveLinksOrThrow(notes: NotebookTable<NoteRecord>, owner: string, body: string): void {
  const missing = distinctTargets(body).filter(title => resolveTitle(notes, owner, title) === undefined)
  if (missing.length === 0) return
  const listed = missing.map(title => `[[${title}]]`).join('、')
  const first = missing[0]
  const hints = first === undefined ? [] : suggestions(notes, owner, first)
  const hint = hints.length === 0
    ? 'No similar title exists yet — write the target card first.'
    : `Existing titles containing the text: ${hints.join(' ｜ ')}.`
  throw new NotebookError(
    'notebook/link-unresolved',
    `these link targets have no card in this notebook: ${listed}. ${hint} `
      + 'To write a literal double bracket instead, escape it as \\[[.',
  )
}

/**
 * Refuse deleting a card that other cards still link to — deleting it would
 * manufacture the dangling links invariant I3 forbids.
 * @param links - the links cache table.
 * @param notes - the notes table (the referrers' titles come from here).
 * @param owner - preset id whose box is written.
 * @param id - the card being deleted.
 * @throws NotebookError `card-referenced` naming the referrers.
 */
export function ensureUnreferenced(links: NotebookTable<LinkRecord>, notes: NotebookTable<NoteRecord>, owner: string, id: string): void {
  const record = requireOwned(notes, owner, id)
  const referrers = cachedBacklinks(links, owner, record.title)
  if (referrers.length === 0) return
  const names = referrers
    .map(row => notes.get(noteKey(owner, row.sourceId)))
    .filter(row => row !== undefined)
    .map(row => `「${row.title}」(${row.id})`)
    .slice(0, 5)
    .join('、')
  throw new NotebookError(
    'notebook/card-referenced',
    `this card is still linked to by ${String(referrers.length)} card(s): ${names}. `
      + `Remove those [[${record.title}]] links first, then delete.`,
  )
}

/** Normalize a title, refusing an empty one. 归一标题，拒绝空标题。 */
function cleanTitle(value: string): string {
  const title = value.trim()
  if (title === '') throw new NotebookError('notebook/title-required', 'a card needs a title.')
  if ([...title].length > MAX_TITLE_CHARS) {
    throw new NotebookError('notebook/input-invalid', `a title is at most ${String(MAX_TITLE_CHARS)} characters.`)
  }
  return title
}

/** Normalize a body and enforce the stored limit. 归一正文并执行存储上限。 */
function cleanBody(value: string): string {
  const body = value.trim()
  const length = [...body].length
  if (length > MAX_BODY_CHARS) {
    throw new NotebookError(
      'notebook/body-too-long',
      `a card body is at most ${String(MAX_BODY_CHARS)} characters; this one has ${String(length)}.`,
    )
  }
  return body
}

/** Up to five existing owner titles containing the sought text. 最多五条含该文本的既有归属内标题。 */
function suggestions(notes: NotebookTable<NoteRecord>, owner: string, text: string): string[] {
  const needle = text.trim().slice(0, 20)
  if (needle === '') return []
  return notes.all()
    .filter(row => row.owner === owner && row.title.includes(needle))
    .map(row => `「${row.title}」`)
    .slice(0, 5)
}
