/**
 * The box canvas: the graph face as a connected card atlas. Geometry comes
 * from `canvas-layout` (pure), the viewport from `canvas-viewport`; this file
 * is rendering and interaction only — one SVG edge layer and draggable
 * card-shaped nodes. No editing lives here (the user's ruling): a node drag
 * rearranges the canvas and persists to localStorage as view state; the box's
 * data is untouched. Edge hover highlights the neighborhood and dims the rest.
 *
 * 盒画布：图面即带连线的卡片图集。几何来自 `canvas-layout`（纯函数），视口来自
 * `canvas-viewport`；本文件只做渲染与交互——一层 SVG 边与可拖拽的卡形节点。
 * 这里没有任何编辑（用户裁定）：拖节点只是重排画布，位置作为视图态持久化到
 * localStorage；盒的数据分文不动。悬停边即高亮邻域、压暗其余。
 *
 * @module @veren/notebook-ui/client/canvas
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyOverrides, layoutCanvas, NODE_H, NODE_W } from './canvas-layout.ts'
import type { CanvasLayout, PlacedNode } from './canvas-layout.ts'
import { agingLabelOf, agingText } from './aging.ts'
import { useCanvasViewport } from './canvas-viewport.ts'
import type { CanvasEdgeView, CanvasNodeView } from './remote.ts'
import type { NotebookKey } from './locales.ts'

/** Everything the canvas renders; no selection face — the canvas is not an editor. */
export interface CanvasGraphProps {
  readonly t: (key: NotebookKey) => string
  readonly nodes: readonly CanvasNodeView[]
  readonly edges: readonly CanvasEdgeView[]
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
function CanvasEdgeHit({ edge, index, lit, layout, onHover }: {
  readonly edge: CanvasEdgeView
  readonly index: number
  readonly lit: boolean
  readonly layout: CanvasLayout
  readonly onHover: (index: number) => void
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
      />
      <line
        className={`notebook-canvas-edge${lit ? '' : ' is-dim'}`}
        x1={source.x} y1={source.y} x2={target.x} y2={target.y}
      />
    </g>
  )
}

/** The SVG edge layer: one hit group per edge. The svg viewport explicitly
 * covers the drawing; lines live in a translate group back in center-origin
 * coordinates. SVG 边层：每边一个命中组。svg 视口显式盖住整幅图，线画在
 * translate 组里，保持中心原点坐标。 */
function EdgeLayer({ edges, layout, activeIds, onHover }: {
  readonly edges: readonly CanvasEdgeView[]
  readonly layout: CanvasLayout
  readonly activeIds: ReadonlySet<string> | undefined
  readonly onHover: (index: number) => void
}): React.ReactElement {
  return (
    <svg
      className="notebook-canvas-edges"
      width={Math.max(1, layout.width)}
      height={Math.max(1, layout.height)}
      style={{ left: `${String(-layout.width / 2)}px`, top: `${String(-layout.height / 2)}px` }}
      aria-hidden="true"
    >
      <g transform={`translate(${String(layout.width / 2)}, ${String(layout.height / 2)})`}>
        {edges.map((edge, index) => (
          <CanvasEdgeHit
            key={`${edge.sourceId}-${edge.targetId}`}
            edge={edge}
            index={index}
            lit={activeIds === undefined || (activeIds.has(edge.sourceId) && activeIds.has(edge.targetId))}
            layout={layout}
            onHover={onHover}
          />
        ))}
      </g>
    </svg>
  )
}

/** Release a pointer capture, tolerating an already-released pointer. 容忍已释放指针的丢捕获。 */
function releaseCapture(event: React.PointerEvent<HTMLDivElement>): void {
  try {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  } catch {
    // The pointer may already be released; losing capture is harmless.
    // 指针可能早已释放；丢捕获无害。
  }
}

/** The drag gesture for one card: capture at press, fire onDrag past 3px,
 * fire onDragEnd on release. 一张卡的拖拽手势：按下即捕获，越过 3px 触发
 * onDrag，松开触发 onDragEnd。 */
function useCardDrag(x: number, y: number, id: string, onDrag: (id: string, x: number, y: number) => void, onDragEnd: (id: string) => void): {
  readonly dragging: boolean
  readonly onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  readonly onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  readonly onPointerEnd: (event: React.PointerEvent<HTMLDivElement>) => void
} {
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number; moved: boolean } | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    dragRef.current = { px: event.clientX, py: event.clientY, ox: x, oy: y, moved: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [x, y])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === undefined) return
    const dx = event.clientX - drag.px
    const dy = event.clientY - drag.py
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return
    if (!drag.moved) {
      drag.moved = true
      setDragging(true)
    }
    onDrag(id, drag.ox + dx, drag.oy + dy)
  }, [id, onDrag])
  const onPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === undefined) return
    dragRef.current = undefined
    if (!drag.moved) return
    setDragging(false)
    releaseCapture(event)
    onDragEnd(id)
  }, [id, onDragEnd])
  return { dragging, onPointerDown, onPointerMove, onPointerEnd }
}

/** The node's class list: kind, aging, dim, dragging. 节点的类名表：类别、老化、压暗、拖拽中。 */
function nodeClasses(node: CanvasNodeView, dimmed: boolean, dragging: boolean): string {
  const classes = ['notebook-canvas-node', `is-${node.kind}`]
  if (node.aging === 'overdue') classes.push('is-overdue')
  if (dimmed) classes.push('is-dim')
  if (dragging) classes.push('is-dragging')
  return classes.join(' ')
}

/** One draggable card node. Dragging rearranges the canvas; the box's data is
 * never touched. 一枚可拖拽的卡形节点。拖拽只重排画布，盒的数据分文不动。 */
function CanvasNode({ t, node, x, y, dimmed, onDrag, onDragEnd }: {
  readonly t: (key: NotebookKey) => string
  readonly node: CanvasNodeView
  readonly x: number
  readonly y: number
  readonly dimmed: boolean
  readonly onDrag: (id: string, x: number, y: number) => void
  readonly onDragEnd: (id: string) => void
}): React.ReactElement {
  const kindKey = { fleeting: 'kindFleeting', permanent: 'kindPermanent', project: 'kindProject' } as const
  const aging = node.aging !== undefined && node.expiresAt !== undefined
    ? agingLabelOf(node.expiresAt, Date.now())
    : undefined
  const drag = useCardDrag(x, y, node.id, onDrag, onDragEnd)
  return (
    <div
      className={nodeClasses(node, dimmed, drag.dragging)}
      data-canvas-node={node.id}
      style={{ left: `${String(x - NODE_W / 2)}px`, top: `${String(y - NODE_H / 2)}px`, width: `${String(NODE_W)}px`, height: `${String(NODE_H)}px` }}
      title={node.title}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerEnd}
      onPointerCancel={drag.onPointerEnd}
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
    </div>
  )
}

/** The placed-node layer: every laid-out card, dimmed outside the hover neighborhood. 落位节点层：每张已布局的卡，悬停邻域之外压暗。 */
function NodeLayer({ t, layout, nodesById, activeIds, onDrag, onDragEnd }: {
  readonly t: (key: NotebookKey) => string
  readonly layout: CanvasLayout
  readonly nodesById: ReadonlyMap<string, CanvasNodeView>
  readonly activeIds: ReadonlySet<string> | undefined
  readonly onDrag: (id: string, x: number, y: number) => void
  readonly onDragEnd: (id: string) => void
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
            dimmed={activeIds !== undefined && !activeIds.has(placed.id)}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
          />
        )
      })}
    </>
  )
}

/** Read the dragged positions stored for one box (view state, localStorage). 读某盒已存的拖拽位置（视图态，localStorage）。 */
function loadPositions(owner: string): Map<string, PlacedNode> {
  try {
    const raw = globalThis.localStorage?.getItem(`notebook-canvas-positions:${owner}`)
    if (raw === null) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return new Map()
    const map = new Map<string, PlacedNode>()
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const { x, y } = value as Record<string, unknown>
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue
      map.set(id, { id, x, y })
    }
    return map
  } catch {
    return new Map()
  }
}

/** Persist the dragged positions for one box. 持久化某盒的拖拽位置。 */
function savePositions(owner: string, positions: ReadonlyMap<string, PlacedNode>): void {
  try {
    globalThis.localStorage?.setItem(
      `notebook-canvas-positions:${owner}`,
      JSON.stringify(Object.fromEntries(positions)),
    )
  } catch {
    // Quota or privacy modes refuse storage; dragging still works this session.
    // 配额或隐私模式会拒绝存储；拖拽在本会话仍然可用。
  }
}

/** The dragged-position store: load per owner, move, persist on release.
 * 拖拽位置仓：按归属载入、拖动、松开持久化。 */
function useDragPositions(fitKey: string): {
  readonly overrides: ReadonlyMap<string, PlacedNode>
  readonly onDrag: (id: string, x: number, y: number) => void
  readonly onDragEnd: (id: string) => void
} {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, PlacedNode>>(new Map())
  // Load this box's saved positions when the owner switches.
  // 换归属时载入该盒已存的位置。
  useEffect(() => {
    setOverrides(loadPositions(fitKey))
  }, [fitKey])
  const onDrag = useCallback((id: string, x: number, y: number): void => {
    setOverrides(current => {
      const next = new Map(current)
      next.set(id, { id, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 })
      return next
    })
  }, [])
  const onDragEnd = useCallback((id: string): void => {
    setOverrides(current => {
      if (current.has(id)) savePositions(fitKey, current)
      return current
    })
  }, [fitKey])
  return { overrides, onDrag, onDragEnd }
}

/** Render the box canvas. */
export function CanvasGraph(props: CanvasGraphProps): React.ReactElement {
  const { t, nodes, edges, fitKey } = props
  const base = useMemo(() => layoutCanvas(nodes), [nodes])
  const { overrides, onDrag, onDragEnd } = useDragPositions(fitKey)
  const layout = useMemo(() => applyOverrides(base, overrides), [base, overrides])
  const viewport = useCanvasViewport(layout, fitKey)
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
        <EdgeLayer edges={edges} layout={layout} activeIds={activeIds} onHover={(next) => { setHovered(next) }} />
        <NodeLayer
          t={t} layout={layout} nodesById={nodesById} activeIds={activeIds}
          onDrag={onDrag} onDragEnd={onDragEnd}
        />
      </CanvasStage>
    </section>
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
