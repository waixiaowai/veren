/**
 * The card write paths: one function per mutation, shared by the service and
 * the specs.
 *
 * Each path runs its checks first (validation, uniqueness, link resolution,
 * delete guard), then writes the row and its cache rows — the only place the
 * notes and links tables move together. Because every caller runs these inside
 * one domain write transaction, a check cannot pass against a state another
 * write has already changed. The specs call these directly against in-memory
 * tables, so the tested path IS the production path.
 *
 * 卡片写路径：一次变更一个函数，服务与用例共用。
 *
 * 每条路径先跑检查（校验、唯一性、链接解析、删除守卫），再写行与其缓存行——这是
 * 笔记表与链接表一起移动的唯一场所。所有调用方都在同一次域写事务里跑它们，检查
 * 不可能对着已被别的写改过的状态通过。用例直接对内存表调用这些函数，因此被测路径
 * 就是生产路径。
 *
 * @module @veren/notebook/cards
 */

import { buildNote, applyUpdate, noteKey, requireOwned } from './notes.ts'
import { retargetLinks, rewriteReferrers, syncLinks, deleteSourceLinks } from './graph.ts'
import {
  ensureExpected, ensureTitleAvailable, ensureUnreferenced, resolveLinksOrThrow, validateCreate, validateUpdate,
} from './validate.ts'
import type { NotebookTable } from './storage.ts'
import type { LinkRecord, NoteFields, NotePatch, NoteRecord } from './types.ts'

/** The two tables one write moves together. 一次写会一起移动的两张表。 */
export interface CardTables {
  readonly notes: NotebookTable<NoteRecord>
  readonly links: NotebookTable<LinkRecord>
}

/**
 * Create one card: field validation, uniqueness, link resolution, the row,
 * its cache rows.
 * @param tables - the notes and links tables of the open domain.
 * @param owner - preset id whose box gains the card.
 * @param fields - caller-supplied title and body.
 * @param now - ISO instant recorded as both timestamps.
 * @param id - the card id; minted when omitted.
 * @returns the stored row.
 * @throws NotebookError on bad fields, `title-conflict`, or `link-unresolved`, before any write.
 */
export async function applyCardCreate(
  tables: CardTables,
  owner: string,
  fields: NoteFields,
  now: string,
  id?: string,
): Promise<NoteRecord> {
  const clean = validateCreate(fields)
  ensureTitleAvailable(tables.notes, owner, clean.title)
  resolveLinksOrThrow(tables.notes, owner, clean.body)
  const record = buildNote(owner, clean, now, id)
  await tables.notes.put(noteKey(owner, record.id), record)
  await syncLinks(tables.links, owner, record.id, record.body)
  return record
}

/**
 * Update one card: optimistic guard, uniqueness (excluding itself), link
 * resolution, the row, and the maintenance its change implies — a rename
 * rewrites every referrer body and retargets the cache rows, a body rewrite
 * resyncs the card's outgoing rows.
 * @param tables - the notes and links tables of the open domain.
 * @param owner - preset id whose card is updated.
 * @param id - the card to update.
 * @param patch - the fields to replace, with the optional optimistic guard.
 * @param now - ISO instant recorded as the new update time.
 * @returns the stored row.
 * @throws NotebookError on unknown id, stale guard, title conflict, unresolved links, or a referrer that would exceed the body limit.
 */
export async function applyCardUpdate(
  tables: CardTables,
  owner: string,
  id: string,
  patch: NotePatch & { readonly expectedUpdatedAt?: string },
  now: string,
): Promise<NoteRecord> {
  const record = requireOwned(tables.notes, owner, id)
  ensureExpected(record, patch.expectedUpdatedAt)
  const fields = validateUpdate(patch)
  ensureTitleAvailable(tables.notes, owner, fields.title ?? record.title, id)
  const nextBody = fields.body ?? record.body
  resolveLinksOrThrow(tables.notes, owner, nextBody)
  const next = applyUpdate(record, fields, now)
  await tables.notes.put(noteKey(owner, id), next)
  if (next.title !== record.title) {
    // Links address titles, so a rename moves the referring text, then the
    // cache rows — bodies and cache stay in the I4 identity.
    // 链接按标题寻址，因此改名先移动引用正文，再移动缓存行——正文与缓存保持 I4 恒等式。
    await rewriteReferrers(tables.notes, tables.links, owner, record.title, next.title, now)
    await retargetLinks(tables.links, owner, record.title, next.title)
  }
  if (fields.body !== undefined) await syncLinks(tables.links, owner, id, next.body)
  return next
}

/**
 * Delete one card: the reference guard first, then the row and its outgoing
 * cache rows.
 * @param tables - the notes and links tables of the open domain.
 * @param owner - preset id whose card is deleted.
 * @param id - the card to delete.
 * @returns `true` once the card is gone.
 * @throws NotebookError `card-referenced` while other cards still link to it.
 */
export async function applyCardRemove(tables: CardTables, owner: string, id: string): Promise<boolean> {
  ensureUnreferenced(tables.links, tables.notes, owner, id)
  const record = requireOwned(tables.notes, owner, id)
  await tables.notes.del(noteKey(owner, id))
  await deleteSourceLinks(tables.links, owner, record.id)
  return true
}
