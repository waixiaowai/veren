/**
 * The link graph over one owner's cards: the disposable `links` cache and the
 * queries that answer from it.
 *
 * Source of truth is the bodies. Every card write rewrites that card's cache
 * rows; every read answers from the cache, joining with the notes table so an
 * occurrence whose target has no card (possible only in legacy v1 bodies,
 * which predate the grammar) never surfaces as a link. The identity that makes
 * the cache honest — the cache equals a fresh syntactic body scan — is
 * invariant I4 and is property-tested against {@link scanBacklinks}.
 *
 * 某个归属卡片集合上的链接图：可丢弃的 `links` 缓存，与应答它的查询。
 *
 * 事实源是正文。每次卡片写入都重写该卡的缓存行；每次读都应答自缓存，并与笔记表
 * 连接——目标不存在的出现（只可能存在于早于语法规则的 v1 旧正文里）绝不以链接
 * 面目露出。让缓存诚实的恒等式——缓存 ≡ 对正文的全新语法扫描——即不变式 I4，
 * 在包套件里对 {@link scanBacklinks} 做属性测试。
 *
 * @module @veren/notebook/graph
 */

import { extractLinks, retargetOccurrences } from './links.ts'
import { MAX_BODY_CHARS, applyUpdate, noteKey, noteSummary } from './notes.ts'
import { NotebookError } from './notes.ts'
import type { NotebookTable } from './storage.ts'
import type { HubView, LinkCountView, LinkRecord, LinkTargetView, NoteRecord, NoteSummary, RiddleView } from './types.ts'

/**
 * Compose the storage key of one cached link.
 * @param owner - preset id that owns both cards.
 * @param sourceId - id of the card whose body carries the link.
 * @param targetTitle - the link's target title.
 * @returns the owner-scoped cache key.
 */
export function linkKey(owner: string, sourceId: string, targetTitle: string): string {
  return `${encodeURIComponent(owner)}/${sourceId}/${encodeURIComponent(targetTitle)}`
}

/**
 * Distinct link targets of one body, in first-occurrence order.
 * @param body - the stored body, read verbatim.
 * @returns each target title once.
 */
export function distinctTargets(body: string): string[] {
  const seen = new Set<string>()
  const titles: string[] = []
  for (const ref of extractLinks(body)) {
    if (seen.has(ref.title)) continue
    seen.add(ref.title)
    titles.push(ref.title)
  }
  return titles
}

/**
 * Rewrite one source card's cache rows to match its body.
 * @param links - the links cache table.
 * @param owner - preset id that owns the card.
 * @param sourceId - id of the card being written.
 * @param body - the card's new body.
 */
export async function syncLinks(
  links: NotebookTable<LinkRecord>,
  owner: string,
  sourceId: string,
  body: string,
): Promise<void> {
  for (const row of sourceLinks(links, owner, sourceId)) await links.del(linkKey(owner, sourceId, row.targetTitle))
  for (const targetTitle of distinctTargets(body)) {
    await links.put(linkKey(owner, sourceId, targetTitle), { owner, sourceId, targetTitle })
  }
}

/**
 * Drop one source card's cache rows (its body is going away).
 * @param links - the links cache table.
 * @param owner - preset id that owns the card.
 * @param sourceId - id of the card being deleted.
 */
export async function deleteSourceLinks(links: NotebookTable<LinkRecord>, owner: string, sourceId: string): Promise<void> {
  for (const row of sourceLinks(links, owner, sourceId)) await links.del(linkKey(owner, sourceId, row.targetTitle))
}

/**
 * Re-key the cache rows that point at a renamed title.
 * @param links - the links cache table.
 * @param owner - preset id that owns the cards.
 * @param fromTitle - the title as it was.
 * @param toTitle - the title as it now is.
 */
export async function retargetLinks(
  links: NotebookTable<LinkRecord>,
  owner: string,
  fromTitle: string,
  toTitle: string,
): Promise<void> {
  for (const row of cachedBacklinks(links, owner, fromTitle)) {
    await links.del(linkKey(owner, row.sourceId, fromTitle))
    await links.put(linkKey(owner, row.sourceId, toTitle), { ...row, targetTitle: toTitle })
  }
}

/**
 * One owner's cache rows carried by one source card.
 * @param links - the links cache table.
 * @param owner - preset id that owns the card.
 * @param sourceId - id of the source card.
 * @returns the cached rows, cache order.
 */
function sourceLinks(links: NotebookTable<LinkRecord>, owner: string, sourceId: string): LinkRecord[] {
  return links.all().filter(row => row.owner === owner && row.sourceId === sourceId)
}

/**
 * Rewrite every referrer body on a rename, so `[[fromTitle]]` occurrences
 * follow the title to `toTitle` — links address titles, so the referring text
 * must move with them. All bodies are length-checked before the first put, so
 * a rename either lands whole or not at all.
 * @param notes - the notes table.
 * @param links - the links cache table (who refers to the old title).
 * @param owner - preset id whose box is renamed in.
 * @param fromTitle - the exact old title.
 * @param toTitle - the new title.
 * @param now - ISO instant stamped as the referrers' new update time.
 * @throws NotebookError `input-invalid` when a rewritten body would exceed the body limit.
 */
export async function rewriteReferrers(
  notes: NotebookTable<NoteRecord>,
  links: NotebookTable<LinkRecord>,
  owner: string,
  fromTitle: string,
  toTitle: string,
  now: string,
): Promise<void> {
  const referrers = cachedBacklinks(links, owner, fromTitle)
    .map(row => notes.get(noteKey(owner, row.sourceId)))
    .filter((row): row is NoteRecord => row !== undefined)
  const rewritten = referrers.map(row => ({ row, body: retargetOccurrences(row.body, fromTitle, toTitle) }))
  for (const { body } of rewritten) {
    if ([...body].length > MAX_BODY_CHARS) {
      throw new NotebookError(
        'notebook/input-invalid',
        `renaming "${fromTitle}" would push a referring card past the ${String(MAX_BODY_CHARS)}-character body limit; `
          + 'shorten the new title or the referring card first.',
      )
    }
  }
  for (const { row, body } of rewritten) {
    await notes.put(noteKey(owner, row.id), applyUpdate(row, { body }, now))
  }
}

/**
 * The cache's answer to "who links to this title".
 * @param links - the links cache table.
 * @param owner - preset id whose box is read.
 * @param targetTitle - the target card's title.
 * @returns every cached row pointing at the title.
 */
export function cachedBacklinks(links: NotebookTable<LinkRecord>, owner: string, targetTitle: string): LinkRecord[] {
  return links.all().filter(row => row.owner === owner && row.targetTitle === targetTitle)
}

/**
 * The equivalence oracle for I4: a fresh syntactic scan of the bodies.
 * @param notes - the notes table.
 * @param owner - preset id whose box is scanned.
 * @param targetTitle - the target card's title.
 * @returns every owner card whose body carries a `[[targetTitle]]` occurrence.
 */
export function scanBacklinks(notes: NotebookTable<NoteRecord>, owner: string, targetTitle: string): NoteRecord[] {
  return notes.all().filter(row => row.owner === owner && distinctTargets(row.body).includes(targetTitle))
}

/**
 * Resolve one title to its card.
 * @param notes - the notes table.
 * @param owner - preset id whose box is read.
 * @param title - the exact card title.
 * @returns the card, or `undefined` when no owner card carries the title.
 */
export function resolveTitle(notes: NotebookTable<NoteRecord>, owner: string, title: string): NoteRecord | undefined {
  return notes.all().find(row => row.owner === owner && row.title === title)
}

/**
 * One card's outgoing links, each resolved to its target id.
 * @param notes - the notes table.
 * @param owner - preset id that owns the card.
 * @param body - the card's body.
 * @returns one row per distinct target that resolves; legacy junk stays out.
 */
export function outgoingOf(notes: NotebookTable<NoteRecord>, owner: string, body: string): LinkTargetView[] {
  const views: LinkTargetView[] = []
  for (const title of distinctTargets(body)) {
    const target = resolveTitle(notes, owner, title)
    if (target !== undefined) views.push({ targetId: target.id, targetTitle: title })
  }
  return views
}

/**
 * The most-linked cards of one box — its entry points — joined with ids.
 * @param notes - the notes table.
 * @param links - the links cache table.
 * @param owner - preset id whose box is ranked.
 * @param limit - how many hubs to return.
 * @returns hubs by descending inbound count (ties by title), unresolved titles dropped.
 */
export function hubView(notes: NotebookTable<NoteRecord>, links: NotebookTable<LinkRecord>, owner: string, limit: number): HubView[] {
  const counts = new Map<string, number>()
  for (const row of links.all()) {
    if (row.owner !== owner) continue
    counts.set(row.targetTitle, (counts.get(row.targetTitle) ?? 0) + 1)
  }
  const ranked = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit * 2)
  const hubs: HubView[] = []
  for (const [title, inboundCount] of ranked) {
    const card = resolveTitle(notes, owner, title)
    if (card === undefined) continue
    hubs.push({ id: card.id, title, inboundCount })
    if (hubs.length === limit) break
  }
  return hubs
}

/**
 * Inbound-link count per card title of one box, for the panel's list badges.
 * @param notes - the notes table.
 * @param links - the links cache table.
 * @param owner - preset id whose box is counted.
 * @returns one row per owner card, title ascending; cards with no inbound links count zero.
 */
/**
 * The freshness window before an unlinked card surfaces in the waiting list.
 * 无链接卡片浮出待加工区前的保鲜窗口（天）。
 */
export const STALE_DAYS = 7

/**
 * One box's waiting-to-be-processed cards — no inbound links and untouched for
 * the freshness window — the lost cards Luhmann warned about (C4: unconnected
 * notes get lost and are forgotten by the box). Derived entirely from the
 * notes+links tables, oldest first: a query, never a schema.
 * @param notes - the notes table.
 * @param links - the links cache table.
 * @param owner - preset id whose box is screened.
 * @param nowMs - the current time in epoch milliseconds.
 * @param days - the freshness window in days (default {@link STALE_DAYS}).
 * @returns the stale orphan summaries, oldest first.
 *
 * 某盒的待加工卡片——没有入链且超过保鲜窗口未动——卢曼警告过的迷失卡片（C4：
 * 不相连的笔记会迷失，会被盒遗忘）。完全派生自 notes+links 两表，最早优先：
 * 是查询，不是 schema。
 */
export function staleView(notes: NotebookTable<NoteRecord>, links: NotebookTable<LinkRecord>, owner: string, nowMs: number, days = STALE_DAYS): NoteSummary[] {
  const counts = new Map<string, number>()
  for (const row of links.all()) {
    if (row.owner !== owner) continue
    counts.set(row.targetTitle, (counts.get(row.targetTitle) ?? 0) + 1)
  }
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000
  return notes.all()
    .filter(record => record.owner === owner
      && (counts.get(record.title) ?? 0) === 0
      && Date.parse(record.updatedAt) <= cutoffMs)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .map(noteSummary)
}

export function linkCounts(notes: NotebookTable<NoteRecord>, links: NotebookTable<LinkRecord>, owner: string): LinkCountView[] {
  const counts = new Map<string, number>()
  for (const row of links.all()) {
    if (row.owner !== owner) continue
    counts.set(row.targetTitle, (counts.get(row.targetTitle) ?? 0) + 1)
  }
  return notes.all()
    .filter(row => row.owner === owner)
    .sort((left, right) => left.title.localeCompare(right.title))
    .map(card => ({ title: card.title, count: counts.get(card.title) ?? 0 }))
}

/**
 * Project a cached row onto its referrer's view.
 * @param notes - the notes table (the referrer's title and excerpt come from here).
 * @param owner - preset id whose box is read.
 * @param row - the cached link row.
 * @returns the view row, or `undefined` when the referrer is gone (transient during delete).
 */
export function backlinkViewOf(notes: NotebookTable<NoteRecord>, owner: string, row: LinkRecord): { sourceId: string; sourceTitle: string; excerpt: string } | undefined {
  const source = notes.get(noteKey(owner, row.sourceId))
  if (source === undefined) return undefined
  return { sourceId: source.id, sourceTitle: source.title, excerpt: excerptLine(source.body) }
}

/** One body's opening line, flattened and capped, as a referrer excerpt. 一条正文的首行，压平并截断，作引用方摘录。 */
function excerptLine(body: string): string {
  const flat = body.replaceAll(/\s+/g, ' ').trim()
  return flat.length <= 120 ? flat : `${flat.slice(0, 120)}…`
}

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
    direct.add(source < target ? `${source}${target}` : `${target}${source}`)
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
        const key = a < b ? `${a}${b}` : `${b}${a}`
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
