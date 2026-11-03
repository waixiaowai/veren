/**
 * One canvas card: the same anatomy the DOM card used to have — kind chip,
 * inbound badge, one-line title, two-line excerpt, aging line — now painted as
 * a Konva group. Every card is a scene-graph node, so dragging, hit testing and
 * redraw are the library's job; this file only decides what a card looks like
 * and where its pieces sit inside the 176×84 box.
 *
 * Geometry is expressed from the card's center, so the group's x/y is the
 * layout coordinate itself and edges can be drawn center-to-center.
 *
 * 一张画布卡片：与旧 DOM 卡片相同的解剖——类别章、入链角标、单行标题、两行摘要、
 * 老化行——现在画成一个 Konva 组。每张卡都是场景图节点，因此拖拽、命中测试与重绘
 * 都由库负责；本文件只决定卡片长什么样、各部件落在 176×84 盒内的哪里。
 *
 * 几何以卡片中心为原点表达，于是组的 x/y 就是布局坐标，边也可以直接中心到中心绘制。
 *
 * @module @veren/notebook-ui/client/canvas-card
 */

import { Group } from 'konva/lib/Group'
import { Rect } from 'konva/lib/shapes/Rect'
import { Text } from 'konva/lib/shapes/Text'
import { agingLabelOf, agingText } from './aging.ts'
import { NODE_H as CARD_H, NODE_W as CARD_W } from './canvas-layout.ts'
import type { CanvasPalette } from './canvas-theme.ts'
import type { NotebookKey } from './locales.ts'
import type { CanvasNodeView, NoteKind } from './remote.ts'

/** The page dictionary, narrowed to the keys a card can render. 页面词典，窄化为卡片会渲染的键。 */
export type Translate = (key: NotebookKey) => string

/** Horizontal inner padding of a card. 卡片水平内边距。 */
const PAD_X = 10

/** Vertical inner padding of a card. 卡片垂直内边距。 */
const PAD_Y = 7

/** Inner content width. 内部内容宽。 */
const INNER_W = CARD_W - PAD_X * 2

/** Left edge of the inner content, card-center relative. 内容左缘，相对卡片中心。 */
const LEFT = -CARD_W / 2 + PAD_X

/** Top edge of the card, card-center relative. 卡片上缘，相对卡片中心。 */
const TOP = -CARD_H / 2

/** Kind chip: height, horizontal padding and font size. 类别章：高、横向内边距与字号。 */
const PILL_H = 14
const PILL_PAD_X = 6
const PILL_FONT = 10

/** Title band: top and height, card-center relative. 标题带：上缘与高度，相对卡片中心。 */
const TITLE_TOP = 23
const TITLE_H = 17

/** Excerpt band: top and height (two lines). 摘要带：上缘与高度（两行）。 */
const EXCERPT_TOP = 41
const EXCERPT_H = 27

/** Aging line: top and height. 老化行：上缘与高度。 */
const AGING_TOP = 69
const AGING_H = 10

/** Card corner radius and drag threshold. 卡片圆角与拖拽阈值。 */
const RADIUS = 10
const DRAG_THRESHOLD = 3

/** Kind label key per note kind. 每种笔记类别对应的文案键。 */
const KIND_KEY: Record<NoteKind, NotebookKey> = {
  fleeting: 'kindFleeting',
  permanent: 'kindPermanent',
  project: 'kindProject',
}

/** What a card reports back while it is dragged or clicked. 卡片被拖动或点选时回报的事。 */
export interface CardDragHandlers {
  readonly onDragStart: (id: string) => void
  readonly onDragMove: (id: string) => void
  readonly onDragEnd: (id: string, x: number, y: number) => void
  /** A plain click (no drag): select the card and its chain. 纯点击（未拖动）：选中该卡及其链。 */
  readonly onSelect: (id: string) => void
}

/** Everything one card is built from. 构建一张卡所需的全部输入。 */
export interface CardInput {
  readonly node: CanvasNodeView
  readonly x: number
  readonly y: number
  readonly palette: CanvasPalette
  readonly t: Translate
  readonly handlers: CardDragHandlers
}

/** The rounded card body, dashed when the card is overdue. 圆角卡身；过期时描边为虚线。 */
function cardBody(node: CanvasNodeView, palette: CanvasPalette): Rect {
  const overdue = node.aging === 'overdue'
  return new Rect({
    x: -CARD_W / 2, y: TOP, width: CARD_W, height: CARD_H, cornerRadius: RADIUS,
    name: 'body',
    fill: node.kind === 'fleeting' ? palette.fleetingFill : palette.surface,
    stroke: overdue ? palette.border : palette.borderSoft,
    strokeWidth: 1,
    shadowColor: palette.shadow, shadowBlur: 10, shadowOffsetY: 2, shadowOpacity: 1,
    shadowForStrokeEnabled: false,
    listening: false,
    ...(overdue ? { dash: [4, 3] } : {}),
  })
}

/** Project cards carry a 3px success bar on their left edge. 项目卡左缘带 3px 成功色条。 */
function projectBar(palette: CanvasPalette): Rect {
  return new Rect({
    x: -CARD_W / 2, y: TOP + 2, width: 3, height: CARD_H - 4,
    cornerRadius: 2, fill: palette.success, listening: false,
  })
}

/** The kind chip: a sunken pill sized to its measured label. 类别章：按实测文案宽度的下沉色胶囊。 */
function kindPill(node: CanvasNodeView, palette: CanvasPalette, t: Translate, fontFamily: string): Group {
  const label = new Text({
    text: t(KIND_KEY[node.kind]), fontFamily, fontSize: PILL_FONT,
    fill: palette.secondary, listening: false,
  })
  const pillWidth = Math.ceil(label.getWidth()) + PILL_PAD_X * 2
  label.position({ x: PILL_PAD_X, y: 2 })
  const pill = new Rect({ width: pillWidth, height: PILL_H, cornerRadius: PILL_H / 2, fill: palette.sunken, listening: false })
  const group = new Group({ x: LEFT, y: TOP + PAD_Y })
  group.add(pill, label)
  return group
}

/** The inbound-link badge, right aligned on the chip row. 入链角标，在类别行右对齐。 */
function inboundBadge(node: CanvasNodeView, palette: CanvasPalette, fontFamily: string): Text {
  return new Text({
    x: LEFT, y: TOP + PAD_Y + 1, width: INNER_W, align: 'right',
    text: `⟲ ${String(node.inbound)}`, fontFamily, fontSize: 10.5, fill: palette.accent,
    wrap: 'none', ellipsis: true, listening: false,
  })
}

/** The one-line title, clipped with an ellipsis. 单行标题，超出以省略号截断。 */
function titleLine(node: CanvasNodeView, palette: CanvasPalette, fontFamily: string): Text {
  return new Text({
    x: LEFT, y: TOP + TITLE_TOP, width: INNER_W, height: TITLE_H,
    text: node.title, fontFamily, fontSize: 13, fontStyle: 'bold',
    fill: palette.text, wrap: 'none', ellipsis: true, lineHeight: 1.25, listening: false,
  })
}

/** The two-line excerpt; skipped when the card has none. 两行摘要；无摘要时不占位。 */
function excerptLine(node: CanvasNodeView, palette: CanvasPalette, fontFamily: string): Text {
  return new Text({
    x: LEFT, y: TOP + EXCERPT_TOP, width: INNER_W, height: EXCERPT_H,
    text: node.excerpt, fontFamily, fontSize: 10.5,
    // 1.28 × 10.5 = 13.44px per line: two lines fit the 27px band with the
    // ellipsis intact; a rounder multiplier would leave only one line.
    // 1.28 × 10.5 = 13.44px 每行：两行恰好放进 27px 带内且保留省略号；更整的倍数
    // 只会剩下一行。
    fill: palette.secondary, wrap: 'char', ellipsis: true, lineHeight: 1.28, listening: false,
  })
}

/** The aging line: countdown in muted ink, overdue in danger ink. 老化行：窗内用弱化墨，过期用危险色。 */
function agingLine(node: CanvasNodeView, palette: CanvasPalette, t: Translate, fontFamily: string): Text | undefined {
  if (node.expiresAt === undefined) return undefined
  const overdue = node.aging === 'overdue'
  return new Text({
    x: LEFT, y: TOP + AGING_TOP, width: INNER_W, height: AGING_H, align: 'right',
    text: agingText(agingLabelOf(node.expiresAt, Date.now()), t),
    fontFamily, fontSize: 10, fontStyle: overdue ? 'bold' : 'normal',
    fill: overdue ? palette.danger : palette.muted,
    wrap: 'none', ellipsis: true, listening: false,
  })
}

/** Wire the library drag gesture and the plain-click select to the canvas faces. 把库的拖拽手势与纯点选接到画布两面。 */
function wireDrag(group: Group, id: string, handlers: CardDragHandlers): void {
  group.on('dragstart', () => {
    group.moveToTop()
    handlers.onDragStart(id)
  })
  group.on('dragmove', () => { handlers.onDragMove(id) })
  group.on('dragend', () => { handlers.onDragEnd(id, group.x(), group.y()) })
  // Konva's dragDistance already separates the two: a click only fires when
  // the pointer never became a drag.
  // Konva 的 dragDistance 已把两者分开：只有指针从未变成拖拽时 click 才触发。
  group.on('click', () => { handlers.onSelect(id) })
}

/**
 * Build one draggable card group.
 * @param input - the node, its layout center, the palette, the dictionary, the drag face.
 * @returns a Konva group positioned at the layout center, ready to be added to a layer.
 *
 * 构建一张可拖拽的卡组。返回的组以布局中心为坐标，可直接加入图层。
 */
export function buildCard(input: CardInput): Group {
  const { node, x, y, palette, t, handlers } = input
  const group = new Group({ x, y, draggable: true, dragDistance: DRAG_THRESHOLD })
  group.add(cardBody(node, palette))
  if (node.kind === 'project') group.add(projectBar(palette))
  group.add(kindPill(node, palette, t, palette.fontFamily))
  if (node.inbound > 0) group.add(inboundBadge(node, palette, palette.fontFamily))
  group.add(titleLine(node, palette, palette.fontFamily))
  if (node.excerpt !== '') group.add(excerptLine(node, palette, palette.fontFamily))
  const aging = agingLine(node, palette, t, palette.fontFamily)
  if (aging !== undefined) group.add(aging)
  wireDrag(group, node.id, handlers)
  return group
}
