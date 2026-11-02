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

import { MAX_BODY_CHARS, MAX_TITLE_CHARS, NotebookError, noteKey, requireOwned, titlesContaining } from './notes.ts'
import { cachedBacklinks, distinctTargets, resolveLinkTarget } from './graph.ts'
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
 * Validate a capture call and normalize its fields — the fleeting intake runs
 * on purpose with the title rules relaxed: the title is optional (the first
 * body line mints one) and the body may carry dangling `[[links]]`, because a
 * fleeting card is a reminder, not yet a link address.
 * 校验一次捕获并归一字段——闪念进料有意放宽标题规则：标题可省（首行铸出），
 * 正文可携带悬空 `[[链接]]`，因为闪念是提醒物，还不是链接地址。
 * @param input - caller-supplied optional title and body.
 * @returns the fields as stored; the title stays absent for minting.
 * @throws NotebookError when a supplied title is empty or the body exceeds its limit.
 */
export function validateCapture(input: { readonly title?: string; readonly body: string }): { readonly title?: string; readonly body: string } {
  const body = cleanBody(input.body)
  // 正文即闪念的全部内容：一张空闪念是噪声，落笔前拒绝。
  // / The body is all a fleeting card is: an empty one is noise, refused before it lands.
  if (body === '') throw new NotebookError('notebook/input-invalid', 'a fleeting card needs a body — it is the reminder.')
  return {
    ...(input.title === undefined ? {} : { title: cleanTitle(input.title) }),
    body,
  }
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
 * Refuse a title another link-target card already carries — titles are link
 * addresses, so they must stay unique among the cards a link can resolve to
 * (the non-fleeting ones). Fleeting cards are not addresses, so two of them
 * may share a title without ambiguity (invariant I2, lifecycle revision).
 * 拒绝与另一张链接目标卡重名的标题——标题是链接地址，必须在链接可解析到的卡
 * （非闪念）之间保持唯一。闪念不是地址，两张闪念同题不产生歧义（不变式 I2 的
 * 生命周期修订）。
 * @param notes - the notes table.
 * @param owner - preset id whose box is written.
 * @param title - the title being claimed.
 * @param excludeId - the card being updated, whose own title may repeat.
 * @throws NotebookError `title-conflict` naming the card that holds the title.
 */
export function ensureTitleAvailable(notes: NotebookTable<NoteRecord>, owner: string, title: string, excludeId?: string): void {
  const clash = notes.all()
    .find(row => row.owner === owner && row.kind !== 'fleeting' && row.title === title && row.id !== excludeId)
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
 * a dangling link must never reach storage (invariant I3). Fleeting cards are
 * not link targets, so a link aimed at one refuses exactly like a missing one.
 * 拒绝正文里 `[[链接]]` 未在归属盒内全部解析的写入——悬空链接绝不能进存储
 * （不变式 I3）。闪念卡不是链接目标，指向闪念的链接与指向不存在的链接同样被拒。
 * @param notes - the notes table.
 * @param owner - preset id whose box is written.
 * @param body - the body being written.
 * @throws NotebookError `link-unresolved` listing the missing targets and the
 *   closest existing titles, so the writer can self-correct.
 */
export function resolveLinksOrThrow(notes: NotebookTable<NoteRecord>, owner: string, body: string): void {
  const missing = distinctTargets(body).filter(title => resolveLinkTarget(notes, owner, title) === undefined)
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

/** Up to five existing owner titles containing the sought text — the same matcher find_cards answers through, so a refusal's hints and the lookup can never drift apart. 最多五条含该文本的既有归属内标题——与 find_cards 共用同一匹配器，拒绝提示与寻卡工具永远不会分叉。 */
function suggestions(notes: NotebookTable<NoteRecord>, owner: string, text: string): string[] {
  return titlesContaining(notes, owner, text.trim().slice(0, 20))
    .map(row => `「${row.title}」`)
    .slice(0, 5)
}
