/**
 * The box graph read: one derived query that returns everything a canvas face
 * needs — nodes with their two resolved link counts and, for fleeting cards,
 * the aging face; the resolved edges; the riddles; and the breathing readout.
 * Like every window answer here it is a query, never a schema: nothing is
 * stored, nothing is scheduled, and a reader that never calls it pays nothing.
 *
 * 盒图读取：一条派生查询，一次返回画布面需要的全部——节点（带两个已解析链接
 * 计数；闪念卡另带老化面）、已解析边、谜面与呼吸读数。与这里的其他窗口应答
 * 一样，是查询，不是 schema：不存储任何东西，不调度任何东西，从不调用的读者
 * 分文不付。
 *
 * @module @veren/notebook/boxgraph
 */

import { resolveLinkTarget } from './graph.ts'
import { noteSummary } from './notes.ts'
import { agingOf, expiresAtOf, FLEETING_DAYS } from './queue.ts'
import { riddlePairs } from './riddles.ts'
import { boxStats } from './stats.ts'
import type { NotebookTable } from './storage.ts'
import type {
  BoxGraphView, CanvasEdgeView, CanvasNodeView, LedgerRecord, LinkRecord, NoteRecord,
} from './types.ts'

/**
 * Read one owner's whole graph face in one pass.
 * @param notes - the notes table.
 * @param links - the links cache table.
 * @param ledger - the lifecycle ledger table (the readout's fact base).
 * @param owner - preset id whose box is read.
 * @param nowMs - the current time in epoch milliseconds.
 * @param days - the fleeting freshness window in days (default {@link FLEETING_DAYS}).
 * @returns nodes, resolved edges, riddles, and the stats readout. Edges come
 *   from the cache joined with the notes table: a target that does not resolve
 *   (fleeting or missing) never surfaces, and a self-edge never surfaces.
 *
 * 一趟读出某归属的整张图面。边来自 links 缓存与 notes 表的连接：解析不了的目标
 * （闪念或不存在）绝不出现，自环绝不出现。
 */
export function boxGraphView(
  notes: NotebookTable<NoteRecord>,
  links: NotebookTable<LinkRecord>,
  ledger: NotebookTable<LedgerRecord>,
  owner: string,
  nowMs: number,
  days = FLEETING_DAYS,
): BoxGraphView {
  const cards = notes.all().filter(row => row.owner === owner)
  const { edges, inbound, outbound } = resolvedEdges(links, notes, owner)
  const nodes = cards.map(record => nodeView(record, nowMs, days, inbound, outbound))
  return {
    nodes,
    edges,
    riddles: riddlePairs(notes, links, owner),
    stats: boxStats(notes, links, ledger, owner, nowMs, days),
  }
}

/** The counts and edge list one graph face carries. 一张图面携带的计数与边表。 */
interface ResolvedEdges {
  readonly edges: readonly CanvasEdgeView[]
  readonly inbound: ReadonlyMap<string, number>
  readonly outbound: ReadonlyMap<string, number>
}

/**
 * Resolve the cache rows into edges between card ids, counting both directions.
 * @param links - the links cache table.
 * @param notes - the notes table (targets resolve through it).
 * @param owner - preset id whose box is read.
 * @returns the edge list plus per-id inbound/outbound counts.
 *
 * 把缓存行解析成卡 id 之间的边，双向计数。
 */
function resolvedEdges(
  links: NotebookTable<LinkRecord>,
  notes: NotebookTable<NoteRecord>,
  owner: string,
): ResolvedEdges {
  const edges: CanvasEdgeView[] = []
  const inbound = new Map<string, number>()
  const outbound = new Map<string, number>()
  const bump = (map: Map<string, number>, id: string): void => {
    map.set(id, (map.get(id) ?? 0) + 1)
  }
  for (const row of links.all()) {
    if (row.owner !== owner) continue
    const target = resolveLinkTarget(notes, owner, row.targetTitle)
    if (target === undefined || target.id === row.sourceId) continue
    edges.push({ sourceId: row.sourceId, targetId: target.id })
    bump(outbound, row.sourceId)
    bump(inbound, target.id)
  }
  return { edges, inbound, outbound }
}

/**
 * Project one card onto its canvas node: a list summary plus the link counts
 * and — for a fleeting card only — the derived aging face.
 * @param record - the card as stored.
 * @param nowMs - the current time in epoch milliseconds.
 * @param days - the fleeting freshness window in days.
 * @param inbound - resolved inbound counts by id.
 * @param outbound - resolved outbound counts by id.
 * @returns the node view.
 *
 * 把一张卡投影成画布节点：列表摘要加链接计数——仅闪念卡另带派生老化面。
 */
function nodeView(
  record: NoteRecord,
  nowMs: number,
  days: number,
  inbound: ReadonlyMap<string, number>,
  outbound: ReadonlyMap<string, number>,
): CanvasNodeView {
  const fleeting = record.kind === 'fleeting'
  return {
    ...noteSummary(record),
    inbound: inbound.get(record.id) ?? 0,
    outbound: outbound.get(record.id) ?? 0,
    ...(fleeting
      ? { aging: agingOf(record, nowMs, days), expiresAt: expiresAtOf(record, days) }
      : {}),
  }
}
