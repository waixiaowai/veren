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

/** One point in canvas coordinates (centers, not corners). 画布坐标中的一个点（中心，非左上角）。 */
export interface CanvasPoint {
  readonly x: number
  readonly y: number
}

/** The layout result: every node exactly once, plus the drawing's bounds. 布局结果：每卡恰好一次，外加图幅边界。 */
export interface CanvasLayout {
  readonly placed: readonly PlacedNode[]
  readonly byId: ReadonlyMap<string, PlacedNode>
  readonly width: number
  readonly height: number
  /** Where the initial view centers: the hub ring's centroid, falling back to
   * all citizens, then the intake strip, then the origin. 初始视口的居中点：
   * 枢纽环质心，退化到全部图内公民，再到进料带，最后原点。 */
  readonly focus: CanvasPoint
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
  /** The hub ring's centroid, or the whole citizen cloud's when no hub exists. 枢纽环质心；无枢纽时取全部公民的质心。 */
  readonly focus: CanvasPoint
}

/** The centroid of a set of placed cards; the origin for an empty set. 一组落位卡的质心；空集取原点。 */
function centroidOf(placed: readonly PlacedNode[]): CanvasPoint {
  if (placed.length === 0) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const node of placed) {
    x += node.x
    y += node.y
  }
  return { x: round2(x / placed.length), y: round2(y / placed.length) }
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
  const hubPlaced: PlacedNode[] = []
  for (let tier = 0; tier < tiers.length; tier++) {
    const ring = placeRing(tiers[tier]!.map(node => node.id), radii[tier]!)
    if (tier === 0) hubPlaced.push(...ring)
    placed.push(...ring)
  }
  const focus = centroidOf(hubPlaced.length > 0 ? hubPlaced : placed)
  return { placed, citizens: citizens.length, outerRadius: radii[2]!, focus }
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
  // A fleeting-only box has no ring centroid: center on the intake strip.
  // 只有闪念的盒没有环质心：居中到进料带。
  const focus = zone.citizens > 0 ? zone.focus : centroidOf(placed)
  return { placed, byId, width: bounds(placed, node => node.x, NODE_W), height: bounds(placed, node => node.y, NODE_H), focus }
}

/**
 * Overlay the user's dragged positions on a base layout: known ids move to
 * their dragged spot, unknown ids keep the deterministic spot, and the bounds
 * are recomputed so fit still covers the whole drawing. Positions are view
 * state — they ride localStorage, never the box's data.
 * @param base - the deterministic layout.
 * @param overrides - dragged positions by id (sparse).
 * @returns a new layout with the overrides applied.
 *
 * 把用户拖过的位置叠加在基准布局上：已知 id 落在拖放点，未知 id 保持确定性
 * 落位，边界重算让适配仍盖住整幅图。位置是视图态——走 localStorage，绝不入
 * 盒的数据。
 */
export function applyOverrides(base: CanvasLayout, overrides: ReadonlyMap<string, PlacedNode>): CanvasLayout {
  if (overrides.size === 0) return base
  const placed = base.placed.map(node => overrides.get(node.id) ?? node)
  const byId = new Map(placed.map(node => [node.id, node]))
  // Dragging moves cards, not the frame the box opens on: keep the base focus.
  // 拖拽移动卡片，不移动盒打开时对准的框：保留基准质心。
  return {
    placed, byId, focus: base.focus,
    width: bounds(placed, node => node.x, NODE_W), height: bounds(placed, node => node.y, NODE_H),
  }
}

/** How much of a chord becomes the Bézier bend; capped so long edges stay readable. 弦长转为贝塞尔弯曲的比例；封顶让长边仍可读。 */
const EDGE_BEND_RATIO = 0.18
const EDGE_BEND_MIN = 16
const EDGE_BEND_MAX = 110

/**
 * The SVG path of one edge: a quadratic Bézier bent along the ring's tangent
 * instead of a straight chord. Two chords that met in an X at the centre are
 * pushed onto opposite arcs, so the relation's direction reads without the
 * lines covering the cards between them.
 *
 * The control point sits at the chord midpoint plus the unit normal times the
 * bend, consistent for every edge, so the result is deterministic and
 * order-free just like the layout.
 *
 * @param from - the source card's centre.
 * @param to - the target card's centre.
 * @returns an SVG path (`M … Q … …`), or a degenerate point for coincident nodes.
 *
 * 一条边的 SVG 路径：二次贝塞尔沿环的切线方向弯曲，而不是直线弦。两条在圆心
 * 交叉成 X 的弦被推到相反的弧上，关系走向因此可读，线也不会盖住中间的卡。
 *
 * 控制点在弦中点加单位法线乘弯曲量，所有边同一规则，因此与布局一样确定且
 * 与顺序无关。
 */
export function edgePath(from: CanvasPoint, to: CanvasPoint): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 0.01) return `M ${String(from.x)} ${String(from.y)}`
  const bend = Math.min(EDGE_BEND_MAX, Math.max(EDGE_BEND_MIN, length * EDGE_BEND_RATIO))
  const controlX = round2((from.x + to.x) / 2 - (dy / length) * bend)
  const controlY = round2((from.y + to.y) / 2 + (dx / length) * bend)
  return `M ${String(from.x)} ${String(from.y)} Q ${String(controlX)} ${String(controlY)} ${String(to.x)} ${String(to.y)}`
}
