/**
 * The canvas's card node: one draggable card-shaped surface plus its drag
 * gesture. Dragging rearranges the canvas; the box's data is never touched —
 * the dragged position flows up as an intent and comes back through the
 * layout, so a node never owns coordinates.
 *
 * 画布的卡节点：一张可拖拽的卡形表面及其拖拽手势。拖拽只重排画布，盒的数据
 * 分文不动——拖出的位置作为意图向上流，再经布局流回来，节点自己从不持有坐标。
 *
 * @module @veren/notebook-ui/client/canvas-node
 */

import { useCallback, useRef, useState } from 'react'
import { NODE_H, NODE_W } from './canvas-layout.ts'
import { agingLabelOf, agingText } from './aging.ts'
import type { CanvasNodeView } from './remote.ts'
import type { NotebookKey } from './locales.ts'

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

/** One draggable card node. 一枚可拖拽的卡形节点。 */
export function CanvasNode({ t, node, x, y, dimmed, onDrag, onDragEnd }: {
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
