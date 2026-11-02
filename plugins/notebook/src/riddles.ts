/**
 * The box's riddles: pairs of cards that keep touching the same ideas without
 * ever meeting — Ahrens's principle 6 (let chance play a role) as a derived
 * query. This module owns both faces of a riddle: proposing pairs
 * ({@link riddlePairs}) and detecting the moment a write closes one
 * ({@link riddleClosedByLink}), which is what makes the spark rate measurable
 * instead of anecdotal.
 *
 * 盒的谜面：不断触碰同一批想法却从未相遇的卡对——Ahrens 原则6（让偶然性扮演
 * 角色）的派生查询。本模块持有谜面的两面：提议卡对（{@link riddlePairs}）与
 * 检测一次写入闭合谜面的时刻（{@link riddleClosedByLink}）——后者让激发率可测，
 * 而不是靠轶事。
 *
 * @module @veren/notebook/riddles
 */

import { resolveTitle } from './graph.ts'
import type { NotebookTable } from './storage.ts'
import type { LinkRecord, NoteRecord, RiddleView } from './types.ts'

/** The shared-neighbor count below which a pair is not proposed as a riddle. 不足此共享邻居数的卡对不提出谜面。 */
export const RIDDLE_MIN_SHARED = 2

/**
 * The box's riddles: card pairs that share neighbors — they keep touching the
 * same ideas — yet never link to each other. Ahrens's principle 6 (let chance
 * play a role) as a derived query: the graph answers questions; this one asks
 * one. Undirected neighbors (outbound and inbound alike); a direct link in
 * either direction disqualifies a pair; ranked by shared count then ids,
 * capped. Cost note: inverted-bucket pairwise counting over the links cache —
 * fine at the 10k-card design target's realistic sparse densities; benchmark
 * before shipping to bigger boxes.
 * @param notes - the notes table.
 * @param links - the links cache table.
 * @param owner - preset id whose box is mined.
 * @param limit - how many riddles to return.
 * @returns the riddle pairs, strongest first.
 *
 * 盒的谜面：共享邻居——不断触碰同一批想法——却从未互链的卡对。Ahrens 原则6
 * （让偶然性扮演角色）的派生查询：图谱回答问题；这一条提出问题。邻居按无向计
 * （出入链皆算）；任一方向有直链即取消资格；按共享数与 id 排序，限量返回。
 * 成本注：links 缓存上的倒排桶成对计数——设计目标 1 万卡的现实稀疏密度下没问题；
 * 更大的盒先基准再上。
 */
export function riddlePairs(notes: NotebookTable<NoteRecord>, links: NotebookTable<LinkRecord>, owner: string, limit = 3): RiddleView[] {
  const idOfTitle = new Map<string, string>()
  const titleOfId = new Map<string, string>()
  for (const record of notes.all()) {
    if (record.owner !== owner) continue
    idOfTitle.set(record.title, record.id)
    titleOfId.set(record.id, record.title)
  }
  const neighbors = new Map<string, Set<string>>()
  const direct = new Set<string>()
  const touch = (a: string, b: string): void => {
    if (a === b || !titleOfId.has(a) || !titleOfId.has(b)) return
    if (!neighbors.has(a)) neighbors.set(a, new Set())
    neighbors.get(a)!.add(b)
  }
  for (const row of links.all()) {
    if (row.owner !== owner) continue
    const source = row.sourceId
    const target = idOfTitle.get(row.targetTitle)
    if (source === undefined || target === undefined || source === target) continue
    touch(source, target)
    touch(target, source)
    direct.add(pairKey(source, target))
  }
  const buckets = new Map<string, string[]>()
  for (const [id, set] of neighbors) {
    for (const neighbor of set) {
      if (!buckets.has(neighbor)) buckets.set(neighbor, [])
      buckets.get(neighbor)!.push(id)
    }
  }
  const overlap = new Map<string, { a: string; b: string; shared: number }>()
  for (const members of buckets.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!
        const b = members[j]!
        if (a === b) continue
        const key = pairKey(a, b)
        if (direct.has(key)) continue
        const entry = overlap.get(key)
        if (entry !== undefined) entry.shared += 1
        else overlap.set(key, { a, b, shared: 1 })
      }
    }
  }
  return [...overlap.values()]
    .filter(entry => entry.shared >= RIDDLE_MIN_SHARED)
    .sort((left, right) => right.shared - left.shared || left.a.localeCompare(right.a))
    .slice(0, limit)
    .map(({ a, b, shared }) => ({
      aId: a, aTitle: titleOfId.get(a) ?? '', bId: b, bTitle: titleOfId.get(b) ?? '', shared,
    }))
}

/**
 * Whether a write that adds one direct link `sourceId → targetTitle` closes a
 * riddle: the pair must have shared at least {@link RIDDLE_MIN_SHARED}
 * neighbors before the write, and no direct link in either direction may have
 * existed. Evaluated against the cache as it stands BEFORE the write's own
 * rows land — the caller runs it first, records the verdict, writes, then
 * appends the ledger row when the verdict said yes.
 * 判断一次新增直链 `sourceId → targetTitle` 的写入是否闭合谜面：写入前该对须
 * 共享至少 {@link RIDDLE_MIN_SHARED} 个邻居，且任一方向此前都无直链。判定对着
 * 本次写入落行**之前**的缓存做——调用方先判、记下结论、再写入，结论为真时补记
 * 账表行。
 * @param notes - the notes table.
 * @param links - the links cache table, before this write's rows land.
 * @param owner - preset id whose box is written.
 * @param sourceId - the card whose body gains the link.
 * @param targetTitle - the link target's title.
 * @returns `true` when this one link closes a riddle.
 */
export function riddleClosedByLink(
  notes: NotebookTable<NoteRecord>,
  links: NotebookTable<LinkRecord>,
  owner: string,
  sourceId: string,
  targetTitle: string,
): boolean {
  const source = notes.all().find(row => row.owner === owner && row.id === sourceId)
  const target = resolveTitle(notes, owner, targetTitle)
  if (source === undefined || target === undefined || source.id === target.id) return false
  for (const row of links.all()) {
    if (row.owner !== owner) continue
    const forward = row.sourceId === sourceId && row.targetTitle === targetTitle
    const backward = row.sourceId === target.id && row.targetTitle === source.title
    if (forward || backward) return false
  }
  return sharedNeighborCount(notes, links, owner, sourceId, target.id) >= RIDDLE_MIN_SHARED
}

/**
 * Count the undirected neighbors two cards share — the same by-id model
 * {@link riddlePairs} ranks pairs with, so the detector and the proposer can
 * never disagree about what a riddle is.
 * 数两张卡共享的无向邻居——与 {@link riddlePairs} 排名卡对所用的是同一个按 id
 * 模型，检测者与提议者对"什么是谜面"永远不会各执一词。
 */
function sharedNeighborCount(
  notes: NotebookTable<NoteRecord>,
  links: NotebookTable<LinkRecord>,
  owner: string,
  sourceId: string,
  targetId: string,
): number {
  const idOfTitle = new Map<string, string>()
  const titleOfId = new Map<string, string>()
  for (const record of notes.all()) {
    if (record.owner !== owner) continue
    idOfTitle.set(record.title, record.id)
    titleOfId.set(record.id, record.title)
  }
  const neighborsOf = (id: string): Set<string> => {
    const title = titleOfId.get(id)
    const set = new Set<string>()
    for (const row of links.all()) {
      if (row.owner !== owner) continue
      if (row.sourceId === id) {
        const target = idOfTitle.get(row.targetTitle)
        if (target !== undefined && target !== id) set.add(target)
      }
      if (title !== undefined && row.targetTitle === title && row.sourceId !== id) set.add(row.sourceId)
    }
    return set
  }
  const ofSource = neighborsOf(sourceId)
  const ofTarget = neighborsOf(targetId)
  let shared = 0
  for (const neighbor of ofSource) if (ofTarget.has(neighbor)) shared += 1
  return shared
}

/** Order-independent pair key. 与顺序无关的卡对键。 */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}${b}` : `${b}${a}`
}
