/**
 * The box canvas: the graph face as a connected card atlas. Geometry comes
 * from `canvas-layout` (pure), the viewport from `canvas-viewport`; this file
 * is rendering and interaction only — one SVG edge layer, card-shaped node
 * buttons, and the zoom toolbar. Edge hover highlights the neighborhood and
 * dims the rest; an edge click selects its target card; a node click selects
 * the card, and the editor seat follows. The edge layer and the node layer are
 * their own small components.
 *
 * 盒画布：图面即带连线的卡片图集。几何来自 `canvas-layout`（纯函数），视口来自
 * `canvas-viewport`；本文件只做渲染与交互——一层 SVG 边、卡形的节点按钮与缩放
 * 工具条。悬停边即高亮邻域、压暗其余；点边即选中目标卡；点节点即选中卡片，编辑
 * 器席位跟切。边层与节点层各自成小组件。
 *
 * @module @veren/notebook-ui/client/canvas
 */

import { useMemo, useState } from 'react'
import { layoutCanvas, NODE_H, NODE_W } from './canvas-layout.ts'
import { agingLabelOf, agingText } from './aging.ts'
import { useCanvasViewport } from './canvas-viewport.ts'
import type { CanvasEdgeView, CanvasNodeView } from './remote.ts'
import type { NotebookKey } from './locales.ts'

/** Everything the canvas renders and the two intents it hands back. */
export interface CanvasGraphProps {
  readonly t: (key: NotebookKey) => string
  readonly nodes: readonly CanvasNodeView[]
  readonly edges: readonly CanvasEdgeView[]
  readonly selectedId: string | undefined
  readonly onSelect: (id: string) => void
  readonly onClearSelection: () => void
  /** Refit when this changes — the owner id: each box opens fitted. 变化即重新适配——归属 id：每盒打开即适配。 */
  readonly fitKey: string
}

/** The zoom toolbar: zoom in, out, and fit, all keyboard-reachable. 缩放工具条：放大、缩小与适配，全部键盘可达。 */
function CanvasToolbar({ t, zoomBy, fit, count }: {
  readonly t: (key: NotebookKey) => string
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

/** One edge: a wide transparent line carries the hover, the thin one the ink. 一条边：宽的透明线承担悬停，细的承担墨迹。 */
function CanvasEdgeHit({ edge, index, lit, layout, onHover, onSelect }: {
  readonly edge: CanvasEdgeView
  readonly index: number
  readonly lit: boolean
  readonly layout: ReturnType<typeof layoutCanvas>
  readonly onHover: (index: number) => void
  readonly onSelect: (id: string) => void
}): React.ReactElement | null {
  const source = layout.byId.get(edge.sourceId)
  const target = layout.byId.get(edge.targetId)
  if (source === undefined || target === undefined) return null
  return (
    <g key={`${edge.sourceId}-${edge.targetId}`}>
      <line
        className="notebook-canvas-edge-hit"
        x1={source.x} y1={source.y} x2={target.x} y2={target.y}
        onPointerEnter={() => { onHover(index) }}
        onPointerLeave={() => { onHover(-1) }}
        onClick={() => { onSelect(edge.targetId) }}
      />
      <line
        className={`notebook-canvas-edge${lit ? '' : ' is-dim'}`}
        x1={source.x} y1={source.y} x2={target.x} y2={target.y}
      />
    </g>
  )
}

/** One card-shaped node button. 一枚卡形的节点按钮。 */
function CanvasNode({ t, node, x, y, selected, dimmed, onSelect }: {
  readonly t: (key: NotebookKey) => string
  readonly node: CanvasNodeView
  readonly x: number
  readonly y: number
  readonly selected: boolean
  readonly dimmed: boolean
  readonly onSelect: (id: string) => void
}): React.ReactElement {
  const kindKey = { fleeting: 'kindFleeting', permanent: 'kindPermanent', project: 'kindProject' } as const
  const aging = node.aging !== undefined && node.expiresAt !== undefined
    ? agingLabelOf(node.expiresAt, Date.now())
    : undefined
  const classes = ['notebook-canvas-node', `is-${node.kind}`]
  if (node.aging === 'overdue') classes.push('is-overdue')
  if (selected) classes.push('is-selected')
  if (dimmed) classes.push('is-dim')
  return (
    <button
      type="button"
      className={classes.join(' ')}
      style={{ left: `${String(x - NODE_W / 2)}px`, top: `${String(y - NODE_H / 2)}px`, width: `${String(NODE_W)}px`, height: `${String(NODE_H)}px` }}
      aria-pressed={selected}
      title={node.title}
      onClick={() => { onSelect(node.id) }}
    >
      <span className="notebook-canvas-node-top">
        <span className={`notebook-canvas-node-kind is-${node.kind}`}>{t(kindKey[node.kind])}</span>
        {node.inbound > 0 && <span className="notebook-canvas-node-links">{`⟲ ${String(node.inbound)}`}</span>}
      </span>
      <span className="notebook-canvas-node-title">{node.title}</span>
      {node.excerpt !== '' && <span className="notebook-canvas-node-excerpt">{node.excerpt}</span>}
      {node.aging !== undefined && node.expiresAt !== undefined && aging !== undefined && (
        <span className={`notebook-canvas-node-aging is-${node.aging}`}>{agingText(aging, t)}</span>
      )}
    </button>
  )
}

/** The SVG edge layer: one hit group per edge. SVG 边层：每边一个命中组。 */
function EdgeLayer({ edges, layout, activeIds, onHover, onSelect }: {
  readonly edges: readonly CanvasEdgeView[]
  readonly layout: ReturnType<typeof layoutCanvas>
  readonly activeIds: ReadonlySet<string> | undefined
  readonly onHover: (index: number) => void
  readonly onSelect: (id: string) => void
}): React.ReactElement {
  return (
    <svg className="notebook-canvas-edges" width="0" height="0" aria-hidden="true">
      {edges.map((edge, index) => (
        <CanvasEdgeHit
          key={`${edge.sourceId}-${edge.targetId}`}
          edge={edge}
          index={index}
          lit={activeIds === undefined || (activeIds.has(edge.sourceId) && activeIds.has(edge.targetId))}
          layout={layout}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
    </svg>
  )
}

/** The placed-node layer: every laid-out card, dimmed outside the hover neighborhood. 落位节点层：每张已布局的卡，悬停邻域之外压暗。 */
function NodeLayer({ t, layout, nodesById, selectedId, activeIds, onSelect }: {
  readonly t: (key: NotebookKey) => string
  readonly layout: ReturnType<typeof layoutCanvas>
  readonly nodesById: ReadonlyMap<string, CanvasNodeView>
  readonly selectedId: string | undefined
  readonly activeIds: ReadonlySet<string> | undefined
  readonly onSelect: (id: string) => void
}): React.ReactElement {
  return (
    <>
      {layout.placed.map(placed => {
        const node = nodesById.get(placed.id)
        if (node === undefined) return null
        return (
          <CanvasNode
            key={placed.id}
            t={t}
            node={node}
            x={placed.x}
            y={placed.y}
            selected={placed.id === selectedId}
            dimmed={activeIds !== undefined && !activeIds.has(placed.id)}
            onSelect={onSelect}
          />
        )
      })}
    </>
  )
}

/** The pan/zoom stage: the transformed world the layers live in. 平移/缩放舞台：各层所住的被变换世界。 */
function CanvasStage({ viewport, children }: {
  readonly viewport: ReturnType<typeof useCanvasViewport>
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <div
      className={`notebook-canvas-stage${viewport.dragging ? ' is-dragging' : ''}`}
      ref={viewport.ref}
      onPointerDown={viewport.onPointerDown}
      onPointerMove={viewport.onPointerMove}
      onPointerUp={viewport.onPointerEnd}
      onPointerCancel={viewport.onPointerEnd}
    >
      <div
        className="notebook-canvas-world"
        style={{ transform: `translate(${String(viewport.view.x)}px, ${String(viewport.view.y)}px) scale(${String(viewport.view.zoom)})` }}
      >
        {children}
      </div>
    </div>
  )
}

/** Render the box canvas. */
export function CanvasGraph(props: CanvasGraphProps): React.ReactElement {
  const { t, nodes, edges, selectedId, onSelect, onClearSelection, fitKey } = props
  const layout = useMemo(() => layoutCanvas(nodes), [nodes])
  const viewport = useCanvasViewport(layout, fitKey, onClearSelection)
  const [hovered, setHovered] = useState(-1)
  const nodesById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  // While an edge is hovered: its endpoints lit, every other node dimmed, and
  // only edges touching the endpoints stay bright.
  // 悬停一条边时：两端点亮，其余节点压暗，只有触及两端的边保持明亮。
  const activeIds = hovered >= 0
    ? new Set([edges[hovered]!.sourceId, edges[hovered]!.targetId])
    : undefined
  return (
    <section className="notebook-canvas" aria-label={t('canvasTitle')}>
      <CanvasToolbar t={t} zoomBy={viewport.zoomBy} fit={viewport.fit} count={nodes.length} />
      <CanvasStage viewport={viewport}>
        <EdgeLayer
          edges={edges} layout={layout} activeIds={activeIds}
          onHover={(next) => { setHovered(next) }} onSelect={onSelect}
        />
        <NodeLayer
          t={t} layout={layout} nodesById={nodesById} selectedId={selectedId}
          activeIds={activeIds} onSelect={onSelect}
        />
      </CanvasStage>
    </section>
  )
}
