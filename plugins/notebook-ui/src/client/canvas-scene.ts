/**
 * The canvas scene: one Konva layer holding the edge layer and the card layer,
 * plus the three operations interaction needs — re-route the edges while a card
 * is dragged, dim everything outside a hovered edge's neighborhood, and tear
 * the scene down. Building is a pure assembly over `canvas-layout`'s geometry
 * and `canvas-card`'s card builder; nothing here reads React or the Host.
 *
 * 画布场景：一个 Konva 图层，里面是边层与卡层，外加交互需要的三个操作——拖动卡片
 * 时重接边、悬停边的邻域之外压暗、拆除场景。构建只是对 `canvas-layout` 几何与
 * `canvas-card` 卡片构建器的纯装配；这里不读 React，也不读宿主。
 *
 * @module @veren/notebook-ui/client/canvas-scene
 */

import { Group } from 'konva/lib/Group'
import { Path } from 'konva/lib/shapes/Path'
import { Rect } from 'konva/lib/shapes/Rect'
import type { Layer } from 'konva/lib/Layer'
import { buildCard } from './canvas-card.ts'
import type { CardDragHandlers, Translate } from './canvas-card.ts'
import { edgePath } from './canvas-layout.ts'
import type { CanvasLayout } from './canvas-layout.ts'
import type { CanvasPalette } from './canvas-theme.ts'
import type { CanvasEdgeView, CanvasNodeView } from './remote.ts'

/** A node outside the hovered neighborhood fades to this. 悬停邻域之外的节点褪到此透明度。 */
const DIM_NODE = 0.3

/** An edge outside the hovered neighborhood fades to this. 悬停邻域之外的边褪到此透明度。 */
const DIM_EDGE = 0.18

/** The ink width of an edge and the transparent width that catches the pointer. 边的墨宽与捕指针的透明命中宽。 */
const EDGE_WIDTH = 1.6
const EDGE_HIT_WIDTH = 12

/** One drawn edge and the view it came from. 一条已画的边及其来源视图。 */
interface EdgeShape {
  readonly edge: CanvasEdgeView
  readonly path: Path
}

/** One drawn card: the group plus the body rect its selection ring restyles. 一张已画的卡：组加其选中环会改样的卡身矩形。 */
interface CardShape {
  readonly group: Group
  readonly body: Rect | undefined
  readonly defaultStroke: string
  readonly defaultWidth: number
}

/** Everything one scene is assembled from. 装配一个场景所需的全部输入。 */
export interface SceneInput {
  readonly layer: Layer
  readonly layout: CanvasLayout
  readonly nodesById: ReadonlyMap<string, CanvasNodeView>
  readonly edges: readonly CanvasEdgeView[]
  readonly palette: CanvasPalette
  readonly t: Translate
  /** Edge index to light at build time, or -1. 构建时要点亮的边下标，或 -1。 */
  readonly hovered: number
  /** The selected card's id, or `undefined` when nothing is selected. 选中卡的 id；未选中为 `undefined`。 */
  readonly selectedId: string | undefined
  /** The selected card's connected chain, or `undefined` when nothing is selected. 选中卡的连通链；未选中为 `undefined`。 */
  readonly selection: ReadonlySet<string> | undefined
  /** Called when the pointer enters a new edge (index) or leaves every edge (-1). 指针进入新边或离开全部边时调用。 */
  readonly onHover: (index: number) => void
  readonly handlers: CardDragHandlers
}

/** The handle the stage keeps for the scene's lifetime. 舞台为场景生命周期持有的句柄。 */
export interface CanvasScene {
  setHover(index: number): void
  setSelection(selectedId: string | undefined, selection: ReadonlySet<string> | undefined): void
  syncEdges(): void
  destroy(): void
}

/** Route one edge along the same Bézier the layout's `edgePath` defines. 沿布局 `edgePath` 定义的贝塞尔重接一条边。 */
function routeEdge(shape: EdgeShape, cards: ReadonlyMap<string, CardShape>): void {
  const source = cards.get(shape.edge.sourceId)
  const target = cards.get(shape.edge.targetId)
  if (source === undefined || target === undefined) return
  shape.path.data(edgePath({ x: source.group.x(), y: source.group.y() }, { x: target.group.x(), y: target.group.y() }))
}

/** Build one edge path, or `undefined` when an endpoint is not on the canvas. 构建一条边；端点不在画布上时返回 `undefined`。 */
function edgeShape(edge: CanvasEdgeView, index: number, input: SceneInput, cards: ReadonlyMap<string, CardShape>): EdgeShape | undefined {
  const source = cards.get(edge.sourceId)
  const target = cards.get(edge.targetId)
  if (source === undefined || target === undefined) return undefined
  const path = new Path({
    data: edgePath({ x: source.group.x(), y: source.group.y() }, { x: target.group.x(), y: target.group.y() }),
    stroke: input.palette.edge, strokeWidth: EDGE_WIDTH, hitStrokeWidth: EDGE_HIT_WIDTH, lineCap: 'round',
  })
  path.on('mouseenter', () => { input.onHover(index) })
  path.on('mouseleave', () => { input.onHover(-1) })
  return { edge, path }
}

/** Build every edge path and add it to the edge group. 构建全部边并加入边层。 */
function addEdges(input: SceneInput, group: Group, cards: ReadonlyMap<string, CardShape>): EdgeShape[] {
  const shapes: EdgeShape[] = []
  input.edges.forEach((edge, index) => {
    const shape = edgeShape(edge, index, input, cards)
    if (shape === undefined) return
    group.add(shape.path)
    shapes.push(shape)
  })
  return shapes
}

/** Build every placed card and add it to the card group. 构建每张落位卡片并加入卡层。 */
function addCards(input: SceneInput, group: Group): Map<string, CardShape> {
  const cards = new Map<string, CardShape>()
  for (const placed of input.layout.placed) {
    const node = input.nodesById.get(placed.id)
    if (node === undefined) continue
    const card = buildCard({
      node, x: placed.x, y: placed.y, palette: input.palette, t: input.t, handlers: input.handlers,
    })
    group.add(card)
    const body = card.findOne<Rect>('.body')
    cards.set(placed.id, {
      group: card,
      body: body ?? undefined,
      defaultStroke: body === null || body === undefined ? '' : String(body.stroke() ?? ''),
      defaultWidth: body === null || body === undefined ? 1 : (body.strokeWidth() ?? 1),
    })
  }
  return cards
}

/** The governing highlight set: the selected card's chain wins over a hover. 管辖高亮的集合：选中链压过悬停。 */
function applyFocus(cards: ReadonlyMap<string, CardShape>, shapes: readonly EdgeShape[], edges: readonly CanvasEdgeView[], hovered: number, selectedId: string | undefined, selection: ReadonlySet<string> | undefined, palette: CanvasPalette): void {
  let active: ReadonlySet<string> | undefined
  if (selectedId !== undefined && selection !== undefined && selection.has(selectedId)) {
    active = selection
  } else {
    const hoveredEdge = hovered >= 0 ? edges[hovered] : undefined
    active = hoveredEdge === undefined ? undefined : new Set([hoveredEdge.sourceId, hoveredEdge.targetId])
  }
  for (const [id, card] of cards) {
    card.group.opacity(active === undefined || active.has(id) ? 1 : DIM_NODE)
    if (card.body === undefined) continue
    const selected = id === selectedId
    card.body.stroke(selected ? palette.accent : card.defaultStroke)
    card.body.strokeWidth(selected ? 2.5 : card.defaultWidth)
  }
  for (const shape of shapes) {
    const lit = active === undefined || (active.has(shape.edge.sourceId) && active.has(shape.edge.targetId))
    shape.path.opacity(lit ? 1 : DIM_EDGE)
  }
}

/**
 * Assemble one scene on a fresh layer.
 * @param input - layout, nodes, edges, palette, dictionary, focus wiring and drag wiring.
 * @returns the scene handle the stage keeps.
 *
 * 在一层新的图层上装配一个场景；返回舞台持有的场景句柄。
 */
/** The scene's mutable focus state: the hovered edge and the selected chain. 场景的可变聚焦态：悬停边与选中链。 */
interface FocusState {
  hovered: number
  selectedId: string | undefined
  selection: ReadonlySet<string> | undefined
}

/** Assemble the scene handle over the drawn shapes. 在已画的图形上组装场景句柄。 */
function assembleScene(input: SceneInput, edgesGroup: Group, cardsGroup: Group, cards: ReadonlyMap<string, CardShape>, shapes: readonly EdgeShape[], state: FocusState): CanvasScene {
  const focus = (): void => {
    applyFocus(cards, shapes, input.edges, state.hovered, state.selectedId, state.selection, input.palette)
    input.layer.batchDraw()
  }
  focus()
  return {
    setHover: (index: number): void => {
      state.hovered = index
      focus()
    },
    setSelection: (nextId: string | undefined, next: ReadonlySet<string> | undefined): void => {
      state.selectedId = nextId
      state.selection = next
      focus()
    },
    syncEdges: (): void => {
      for (const shape of shapes) routeEdge(shape, cards)
      input.layer.batchDraw()
    },
    destroy: (): void => {
      edgesGroup.destroy()
      cardsGroup.destroy()
    },
  }
}

export function createScene(input: SceneInput): CanvasScene {
  const edgesGroup = new Group({ listening: true })
  const cardsGroup = new Group()
  input.layer.add(edgesGroup, cardsGroup)
  const cards = addCards(input, cardsGroup)
  const shapes = addEdges(input, edgesGroup, cards)
  return assembleScene(input, edgesGroup, cardsGroup, cards, shapes, {
    hovered: input.hovered, selectedId: input.selectedId, selection: input.selection,
  })
}
