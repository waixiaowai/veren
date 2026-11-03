/**
 * The box canvas: the graph face as a connected card atlas. Geometry comes from
 * `canvas-layout` (pure), the viewport from `canvas-viewport`, and the pixels
 * from a Konva stage (`canvas-stage`) — no card is a DOM element any more, so
 * the node count stops being a layout-engine liability. This file is
 * composition only: the toolbar, the stage, and the empty box's one instruction
 * card. No editing lives here (the user's ruling): a node drag rearranges the
 * canvas and persists to localStorage as view state; the box's data is
 * untouched.
 *
 * 盒画布：图面即带连线的卡片图集。几何来自 `canvas-layout`（纯函数），视口来自
 * `canvas-viewport`，像素来自 Konva 舞台（`canvas-stage`）——卡片不再是 DOM
 * 元素，节点数不再是布局引擎的负担。本文件只做组装：工具条、舞台，以及空盒的唯一
 * 指引卡。这里没有任何编辑（用户裁定）：拖节点只是重排画布，位置作为视图态持久化到
 * localStorage；盒的数据分文不动。
 *
 * @module @veren/notebook-ui/client/canvas
 */

import { useMemo } from 'react'
import { CanvasStage } from './canvas-stage.tsx'
import { applyOverrides, layoutCanvas } from './canvas-layout.ts'
import { useDragPositions } from './canvas-positions.ts'
import { useCanvasPalette } from './canvas-theme.ts'
import { useCanvasViewport } from './canvas-viewport.ts'
import type { Translate } from './canvas-card.ts'
import type { CanvasEdgeView, CanvasNodeView } from './remote.ts'

/** Everything the canvas renders; no selection face — the canvas is not an editor. 画布渲染的一切；没有选中面——画布不是编辑器。 */
export interface CanvasGraphProps {
  readonly t: Translate
  readonly nodes: readonly CanvasNodeView[]
  readonly edges: readonly CanvasEdgeView[]
  /** Re-apply the opening view when this changes — the owner id. 变化即重新应用打开视口——归属 id。 */
  readonly viewKey: string
  /** True before the first authoritative read: no empty state while loading. 首次权威读取之前：加载中不显示空态。 */
  readonly loading?: boolean
  /** The empty state's one action: switch to the list and start a draft. 空态的唯一动作：切到列表并开始草稿。 */
  readonly onCreate: () => void
}

/** The zoom toolbar: zoom in, out, and fit, all keyboard-reachable. 缩放工具条：放大、缩小与适配，全部键盘可达。 */
function CanvasToolbar({ t, zoomBy, fit, count }: {
  readonly t: Translate
  readonly zoomBy: (factor: number) => void
  readonly fit: () => void
  readonly count: number
}): React.ReactElement {
  return (
    <div className="notebook-canvas-toolbar" data-canvas-control>
      <span className="notebook-canvas-count">{`${t('notes')} ${String(count)}`}</span>
      <button type="button" className="notebook-btn" aria-label={t('canvasZoomIn')} onClick={() => { zoomBy(1.25) }}>+</button>
      <button type="button" className="notebook-btn" aria-label={t('canvasZoomOut')} onClick={() => { zoomBy(0.8) }}>−</button>
      <button type="button" className="notebook-btn" onClick={fit}>{t('canvasFit')}</button>
    </div>
  )
}

/** The empty box's one instruction card: the list's empty-state copy plus the
 * route to the writing surface. A blank canvas told a new reader nothing.
 * 空盒的唯一指引卡：列表空态文案，加上通往创作面的路。空白画布对新读者什么
 * 也没说。 */
function CanvasEmpty({ t, onCreate }: {
  readonly t: Translate
  readonly onCreate: () => void
}): React.ReactElement {
  return (
    <div className="notebook-canvas-empty" data-canvas-control>
      <h3>{t('noNotes')}</h3>
      <p>{t('canvasEmptyHint')}</p>
      <button type="button" className="notebook-btn is-primary" onClick={onCreate}>
        {t('newNote')}
      </button>
    </div>
  )
}

/** Render the box canvas. */
export function CanvasGraph(props: CanvasGraphProps): React.ReactElement {
  const { t, nodes, edges, viewKey, onCreate } = props
  const loading = props.loading ?? false
  const base = useMemo(() => layoutCanvas(nodes), [nodes])
  const { overrides, move } = useDragPositions(viewKey)
  const layout = useMemo(() => applyOverrides(base, overrides), [base, overrides])
  const viewport = useCanvasViewport(layout, viewKey)
  const palette = useCanvasPalette(viewport.ref)
  const nodesById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  return (
    <section className="notebook-canvas" aria-label={t('canvasTitle')}>
      <CanvasToolbar t={t} zoomBy={viewport.zoomBy} fit={viewport.fit} count={nodes.length} />
      <CanvasStage
        viewport={viewport}
        layout={layout}
        nodesById={nodesById}
        edges={edges}
        palette={palette}
        t={t}
        onNodeDragEnd={move}
      />
      {nodes.length === 0 && !loading && <CanvasEmpty t={t} onCreate={onCreate} />}
    </section>
  )
}
