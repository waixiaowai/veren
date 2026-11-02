/**
 * The canvas viewport controller: cursor-anchored wheel zoom, pointer pan with
 * a 4px threshold, one fit per box, and center-anchored zoom buttons.
 *
 * Replicated from the flow-canvas-panel precedent
 * (packages/graph/flow-canvas-panel/src/client/useCanvasViewport.ts) and cut to
 * what the box canvas needs — no per-flow auto-fit rules, no keep-node-visible
 * follower, no re-centering. The content is centered on the origin, so fit is
 * one arithmetic line and pan needs no clamping. The auto-adjust halves live in
 * `canvas-viewport-auto.ts`; this file keeps only the assembly.
 *
 * 画布视口控制器：以光标为锚的滚轮缩放、带 4px 阈值的指针平移、每盒一次的适
 * 配，以及以视口中心为锚的缩放按钮。
 *
 * 自 flow-canvas-panel 先例（packages/graph/flow-canvas-panel/src/client/
 * useCanvasViewport.ts）复刻，裁剪到盒画布所需——没有逐 flow 的自动适配规则、
 * 没有选中跟随、没有重居中。内容以原点为中心，因此适配只是一行算术，平移也无
 * 需钳制。自动调整半边在 `canvas-viewport-auto.ts`；本文件只留装配。
 *
 * @module @veren/notebook-ui/client/canvas-viewport
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasLayout } from './canvas-layout.ts'
import { useFitPerKey, usePointerPan, useViewportSize, useWheelZoom, useZoomActions } from './canvas-viewport-auto.ts'

/** The viewport transform: content point p lands at screen p·zoom + (x, y). 视口变换：内容点 p 落在屏幕 p·zoom + (x, y)。 */
export interface Viewport {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

/** The controller `CanvasGraph` binds to the stage element. `CanvasGraph` 绑定到舞台元素的控制器。 */
export interface CanvasViewportController {
  readonly ref: { current: HTMLDivElement | null }
  readonly view: Viewport
  readonly dragging: boolean
  readonly zoomBy: (factor: number) => void
  readonly fit: () => void
  readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  readonly onPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void
}

/**
 * Own the viewport transform for one laid-out box.
 * @param layout - the current layout (its bounds drive fit).
 * @param fitKey - refit when this changes (the owner id): each box opens fitted.
 * @param onBackgroundClick - a click that moved nothing and hit no node clears the selection.
 * @returns the controller the stage element binds.
 *
 * 为一幅已布局的盒持有视口变换。fitKey 变化即重新适配（归属 id）：每盒打开即
 * 适配。未移动且未命中节点的点击清除选中。
 */
export function useCanvasViewport(layout: CanvasLayout, fitKey: string, onBackgroundClick: () => void): CanvasViewportController {
  const ref = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const size = useViewportSize(ref)
  const pan = usePointerPan(view, setView, onBackgroundClick)
  const zoom = useZoomActions(layout, size, setView)
  useWheelZoom(ref, setView)
  useFitPerKey(layout, fitKey, size, setView)
  return {
    ref, view, dragging: pan.dragging,
    zoomBy: zoom.zoomBy, fit: zoom.fit,
    onPointerDown: pan.onPointerDown, onPointerMove: pan.onPointerMove, onPointerEnd: pan.onPointerEnd,
  }
}
