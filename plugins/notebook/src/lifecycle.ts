/**
 * The lifecycle transitions: capture (into fleeting), promote (fleeting →
 * permanent), archive (project → gone, with distill-back evidence). Each one
 * runs its checks first, then moves the row, the cache rows, and the ledger —
 * inside the caller's single write transaction, exactly like the card write
 * paths these sit beside.
 *
 * The flywheel reading: capture is the intake valve (fast, loose, off-graph),
 * promote is the compounding step (the full write-time discipline applied at
 * processing time — Ahrens's fleeting note "thrown away after processing"),
 * archive is a project's honest ending (value either migrated to permanent
 * cards first or the refusal says so).
 *
 * 生命周期转移：capture（进闪念）、promote（闪念 → 永久）、archive（项目 → 消失，
 * 凭蒸馏证据）。每个都先跑检查，再动行、缓存行与账表——都在调用方的单次写事务
 * 里，与它们比邻的卡片写路径完全同款。
 *
 * 飞轮读法：capture 是进料阀（快、松、不入图），promote 是化合步（完整写入纪律
 * 在加工时刻补上——Ahrens 的闪念"加工完后扔掉"），archive 是项目体面的终点
 * （价值要么先迁入永久卡，要么拒绝直接说明）。
 *
 * @module @veren/notebook/lifecycle
 */

import { requireOwned } from './notes.ts'
import { ensureExpected, ensureTitleAvailable, ensureUnreferenced, resolveLinksOrThrow, validateCapture, validateCreate } from './validate.ts'
import { deleteSourceLinks, syncRecordLinks } from './graph.ts'
import { appendLedger } from './ledger.ts'
import { MAX_TITLE_CHARS, NotebookError, buildNote, noteKey } from './notes.ts'
import type { CardTables } from './cards.ts'
import type { NoteRecord } from './types.ts'

/** Refuse a lifecycle action that does not fit the card's kind. 拒绝与卡的类别不匹配的生命周期动作。 */
function kindMismatch(record: NoteRecord, expected: string): NotebookError {
  return new NotebookError(
    'notebook/kind-mismatch',
    `card "${record.title}" (${record.id}) is a ${record.kind} card; this action applies to ${expected} cards.`,
  )
}

/**
 * Mint a fleeting card's title from its first non-blank line — flattened,
 * capped, never empty, so the intake valve needs no title from the caller.
 * 从正文第一个非空行铸闪念标题——压平、截断、绝不为空，进料阀因此不需要调用方
 * 给标题。
 */
export function mintFleetingTitle(body: string): string {
  for (const line of body.split('\n')) {
    const flat = line.replaceAll(/\s+/g, ' ').trim()
    if (flat === '') continue
    const characters = [...flat]
    return characters.length <= MAX_TITLE_CHARS ? flat : characters.slice(0, MAX_TITLE_CHARS).join('')
  }
  return '未命名闪念'
}

/**
 * Capture one fleeting card: relaxed rules on purpose — the title may be
 * omitted (minted from the first line), the body may carry dangling
 * `[[links]]`, the card never joins the link graph. Ledger: `captured`.
 * @param tables - the notes, links, and ledger tables of the open domain.
 * @param owner - preset id whose box takes the capture.
 * @param input - the body, and an optional title (minted when absent).
 * @param now - ISO instant recorded as both timestamps.
 * @param id - the card id; minted when omitted.
 * @returns the stored fleeting card.
 * @throws NotebookError on a bad body, a bad explicit title, or a title a
 *   link-target card already holds.
 */
export async function applyCardCapture(
  tables: CardTables,
  owner: string,
  input: { readonly title?: string; readonly body: string },
  now: string,
  id?: string,
): Promise<NoteRecord> {
  const clean = validateCapture(input)
  const title = clean.title ?? mintFleetingTitle(clean.body)
  ensureTitleAvailable(tables.notes, owner, title)
  const record = buildNote(owner, { title, body: clean.body }, now, id, 'fleeting')
  await tables.notes.put(noteKey(owner, record.id), record)
  await appendLedger(tables.ledger, owner, record.id, 'captured', now)
  return record
}

/**
 * Promote one fleeting card into a permanent card — the compounding step. The
 * full write-time discipline applies here, at processing time: a real phrase
 * title (kept when the patch omits one), a body whose `[[links]]` must all
 * resolve, and the card joins the graph. Ledger: `promoted`.
 * @param tables - the notes, links, and ledger tables of the open domain.
 * @param owner - preset id whose card is promoted.
 * @param id - the fleeting card.
 * @param patch - replacement fields, with the optional optimistic guard.
 * @param now - ISO instant recorded as the new update time.
 * @returns the stored permanent card.
 * @throws NotebookError on unknown id, `kind-mismatch` (not fleeting), stale
 *   guard, title conflict, or unresolved links.
 */
export async function applyCardPromote(
  tables: CardTables,
  owner: string,
  id: string,
  patch: { readonly title?: string; readonly body?: string; readonly expectedUpdatedAt?: string },
  now: string,
): Promise<NoteRecord> {
  const record = requireOwned(tables.notes, owner, id)
  if (record.kind !== 'fleeting') throw kindMismatch(record, 'fleeting')
  ensureExpected(record, patch.expectedUpdatedAt)
  const clean = validateCreate({ title: patch.title ?? record.title, body: patch.body ?? record.body })
  ensureTitleAvailable(tables.notes, owner, clean.title, id)
  resolveLinksOrThrow(tables.notes, owner, clean.body)
  const next: NoteRecord = { ...record, title: clean.title, body: clean.body, updatedAt: now, kind: 'permanent' }
  await tables.notes.put(noteKey(owner, id), next)
  await syncRecordLinks(tables.links, owner, next)
  await appendLedger(tables.ledger, owner, id, 'promoted', now)
  return next
}

/**
 * Archive one project card — the honest project ending (Ahrens: project notes
 * are discarded once the project ends; the flywheel forbids stranded value).
 * The distill-back evidence comes first: every `distilledInto` id must name an
 * existing permanent card, proving the insights migrated. The card is then
 * deleted, guarded like any deletion. Ledger: `archived`.
 * @param tables - the notes, links, and ledger tables of the open domain.
 * @param owner - preset id whose project closes.
 * @param id - the project card.
 * @param distilledInto - ids of the permanent cards that absorbed the value.
 * @param now - ISO instant stamped on the ledger row.
 * @returns `true` once the project card is gone.
 * @throws NotebookError on unknown id, `kind-mismatch` (not a project card),
 *   `archive-undistilled` (empty evidence, a missing id, or a non-permanent
 *   target), or `card-referenced` (cards still link it).
 */
export async function applyCardArchive(
  tables: CardTables,
  owner: string,
  id: string,
  distilledInto: readonly string[],
  now: string,
): Promise<boolean> {
  const record = requireOwned(tables.notes, owner, id)
  if (record.kind !== 'project') throw kindMismatch(record, 'project')
  if (distilledInto.length === 0) {
    throw new NotebookError(
      'notebook/archive-undistilled',
      'a project card closes only with distill-back evidence: name the permanent card(s) that absorbed its'
        + ' insights in distilledInto — or promote them first (write_note / promote_note).',
    )
  }
  for (const targetId of distilledInto) {
    const card = tables.notes.all().find(row => row.owner === owner && row.id === targetId)
    if (card === undefined) {
      throw new NotebookError(
        'notebook/archive-undistilled',
        `distill-back target "${targetId}" does not exist in this notebook; distill the insight into a permanent card first.`,
      )
    }
    if (card.kind !== 'permanent') {
      throw new NotebookError(
        'notebook/archive-undistilled',
        `distill-back target "${card.title}" (${card.id}) is a ${card.kind} card; value settles into permanent cards only.`,
      )
    }
  }
  ensureUnreferenced(tables.links, tables.notes, owner, id)
  await tables.notes.del(noteKey(owner, id))
  await deleteSourceLinks(tables.links, owner, record.id)
  await appendLedger(tables.ledger, owner, id, 'archived', now)
  return true
}
