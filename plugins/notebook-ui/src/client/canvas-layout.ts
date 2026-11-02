/**
 * The canvas layout: one deterministic, pure function from the box graph face
 * to node positions. Same set in, same coordinates out — order-insensitive,
 * time-free, and unit-testable without React. Positions are derived data in
 * the strictest sense: nothing here is ever stored.
 *
 * The zoning bakes the domain in: fleeting cards never join the link graph,
 * so the canvas gives them their own intake strip below the graph; the graph
 * citizens arrange on up to three concentric rings — hubs (inbound > 0)
 * innermost, linked-but-unlinked outflow next, islands (no links at all) on
 * the rim where the audit's "the only qualifying card is an island" becomes
 * visible instead of buried.
 *
 * 画布布局：从盒图面到节点坐标的一个确定性纯函数。同一集合进、同一坐标出
 * ——与输入顺序无关、与时间无关、无需 React 即可单测。坐标是最严格意义上的
 * 派生数据：这里的一切都绝不存储。
 *
 * 分区把领域事实烤进了几何：闪念从不入链接图，所以画布在图区下方给它们一条
 * 独立的进料带；图内公民排在最多三圈同心环上——枢纽（有入链）最内，有出链而
 * 无入链者次之，孤岛（全无链接）落在环缘——审计里「唯一合格卡是孤岛」因此显
 * 影，而不是被埋没。
 *
 * @module @veren/notebook-ui/client/canvas-layout
 */

import type { CanvasNodeView } from './remote.ts'

/** Rendered card width, px — the layout's unit of spacing. 卡片渲染宽（px）——布局的间距单位。 */
export const NODE_W = 176

/** Rendered card height, px. 卡片渲染高（px）。 */
export const NODE_H = 84

/** Per-node arc a ring reserves, so same-ring cards never overlap. 环上每卡预留的弧长，同环卡片互不重叠。 */
const RING_ARC_PER_NODE = NODE_W + 28

/** Vertical breathing room between adjacent rings. 相邻环之间的纵向呼吸空隙。 */
const RING_GAP = NODE_H + 48

/** Minimum radii so a sparse graph still reads as rings. 最小半径，稀疏图也要读得出环。 */
const RING_MIN = [130, 260, 380] as const

/** Gap between the graph zone and the intake strip. 图区与进料带之间的空隙。 */
const INTAKE_MARGIN = 90

/** Columns of the intake grid. 进料网格的列数。 */
const INTAKE_COLS = 4

/** Horizontal pitch of the intake grid. 进料网格的横向步距。 */
const INTAKE_PITCH_X = NODE_W + 24

/** Vertical pitch of the intake grid. 进料网格的纵向步距。 */
const INTAKE_PITCH_Y = NODE_H + 20

/** Outer margin around the whole drawing. 整幅图四周的外边距。 */
const CANVAS_PAD = 40

/** One placed card: its id and its center coordinates. 一个落位卡片：id 与中心坐标。 */
export interface PlacedNode {
  readonly id: string
  readonly x: number
  readonly y: number
}

/** The layout result: every node exactly once, plus the drawing's bounds. 布局结果：每卡恰好一次，外加图幅边界。 */
export interface CanvasLayout {
  readonly placed: readonly PlacedNode[]
  readonly byId: ReadonlyMap<string, PlacedNode>
  readonly width: number
  readonly height: number
}

/** Order-insensitive string compare — code-unit order, locale-free. 与顺序无关、与 locale 无关的字符串比较（码元序）。 */
function cmp(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Radius at which `count` nodes fit one ring without overlapping. `count` 个节点互不重叠地排满一圈所需半径。 */
function fitRadius(count: number, min: number): number {
  if (count <= 0) return 0
  return Math.max(min, Math.ceil((count * RING_ARC_PER_NODE) / (2 * Math.PI)))
}

/** Place one ring's nodes clockwise from the top, centered at the origin. 从正上方起顺时针落一圈，圆心在原点。 */
function placeRing(ids: readonly string[], radius: number): PlacedNode[] {
  return ids.map((id, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / ids.length
    return { id, x: round2(radius * Math.cos(angle)), y: round2(radius * Math.sin(angle)) }
  })
}

/** Round to two decimals so coordinates stay stable across platforms. 坐标取两位小数，跨平台稳定。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** What the citizen rings pass to the intake strip: its top edge. 公民环交给进料带的东西：它的顶边。 */
interface CitizenPlacement {
  readonly placed: readonly PlacedNode[]
  readonly citizens: number
  readonly outerRadius: number
}

/** Place the graph citizens on up to three rings: hubs, outflow, islands. 把图内公民排到最多三圈环上：枢纽、流出口、孤岛。 */
function placeCitizens(nodes: readonly CanvasNodeView[]): CitizenPlacement {
  const citizens = nodes
    .filter(node => node.kind !== 'fleeting')
    .sort((a, b) => b.inbound - a.inbound || b.outbound - a.outbound || cmp(a.id, b.id))
  const tiers = [
    citizens.filter(node => node.inbound > 0),
    citizens.filter(node => node.inbound === 0 && node.outbound > 0),
    citizens.filter(node => node.inbound === 0 && node.outbound === 0),
  ]
  const radii: number[] = [0, 0, 0]
  for (let tier = 0; tier < tiers.length; tier++) {
    const floor = tier === 0 ? RING_MIN[tier]! : radii[tier - 1]! + RING_GAP
    const empty = tiers[tier]!.length === 0
    radii[tier] = empty
      ? (tier === 0 ? 0 : radii[tier - 1]!)
      : Math.max(floor, fitRadius(tiers[tier]!.length, RING_MIN[tier]!))
  }
  const placed: PlacedNode[] = []
  for (let tier = 0; tier < tiers.length; tier++) {
    placed.push(...placeRing(tiers[tier]!.map(node => node.id), radii[tier]!))
  }
  return { placed, citizens: citizens.length, outerRadius: radii[2]! }
}

/** Place the fleeting cards on the intake grid: overdue first, each oldest first. 把闪念卡排上进料网格：过期在前，各自最早优先。 */
function placeIntake(nodes: readonly CanvasNodeView[], zone: CitizenPlacement): PlacedNode[] {
  const fleet = nodes
    .filter(node => node.kind === 'fleeting')
    .sort((a, b) => (a.aging === 'overdue' ? 0 : 1) - (b.aging === 'overdue' ? 0 : 1)
      || cmp(a.updatedAt, b.updatedAt)
      || cmp(a.id, b.id))
  const top = (zone.citizens > 0 ? zone.outerRadius : 0) + INTAKE_MARGIN + NODE_H / 2
  return fleet.map((node, index) => ({
    id: node.id,
    x: round2(((index % INTAKE_COLS) - (INTAKE_COLS - 1) / 2) * INTAKE_PITCH_X),
    y: round2(top + Math.floor(index / INTAKE_COLS) * INTAKE_PITCH_Y),
  }))
}

/** One axis' bounding extent including card size and the outer pad. 一根轴的图幅范围，含卡片尺寸与外边距。 */
function bounds(placed: readonly PlacedNode[], axis: (node: PlacedNode) => number, size: number): number {
  if (placed.length === 0) return 0
  let min = Infinity
  let max = -Infinity
  for (const node of placed) {
    const center = axis(node)
    min = Math.min(min, center - size / 2)
    max = Math.max(max, center + size / 2)
  }
  return Math.ceil(max - min + CANVAS_PAD * 2)
}

/**
 * Compute the canvas layout for one box graph face.
 * @param nodes - the face's nodes (any order; the layout is order-insensitive).
 * @returns every node placed exactly once, plus the drawing bounds.
 * @throws Error when two nodes share an id (a caller bug, failed loud).
 *
 * 为一张盒图面计算画布布局。节点任意顺序（布局与顺序无关）。两个节点同 id 时
 * 抛错（调用方缺陷，响亮失败）。
 */
export function layoutCanvas(nodes: readonly CanvasNodeView[]): CanvasLayout {
  const seen = new Set<string>()
  for (const node of nodes) {
    if (seen.has(node.id)) throw new Error(`canvas-layout: duplicate node id ${node.id}`)
    seen.add(node.id)
  }
  const zone = placeCitizens(nodes)
  const placed = [...zone.placed, ...placeIntake(nodes, zone)]
  const byId = new Map(placed.map(node => [node.id, node]))
  return { placed, byId, width: bounds(placed, node => node.x, NODE_W), height: bounds(placed, node => node.y, NODE_H) }
}
