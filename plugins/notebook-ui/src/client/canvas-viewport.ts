/**
 * The canvas viewport controller: cursor-anchored wheel zoom, one readable
 * opening view per box, and center-anchored zoom buttons. Panning is the Konva
 * stage's own drag gesture now, so the controller only publishes the transform
 * it holds and the setter the stage writes back through; the stage binds the
 * same element ref.
 *
 * Replicated from the flow-canvas-panel precedent
 * (packages/graph/flow-canvas-panel/src/client/useCanvasViewport.ts) and cut to
 * what the box canvas needs — no per-flow auto-fit rules, no keep-node-visible
 * follower. The content is centered on the origin, so pan needs no clamping.
 * The auto-adjust halves live in `canvas-viewport-auto.ts`; this file keeps
 * only the assembly.
 *
 * 画布视口控制器：以光标为锚的滚轮缩放、每盒一次的可读打开视口，以及以视口中心为
 * 锚的缩放按钮。平移现在是 Konva 舞台自带的拖拽手势，因此控制器只发布它持有的变换
 * 和舞台回写的 setter；舞台绑定同一个元素 ref。
 *
 * 自 flow-canvas-panel 先例复刻，裁剪到盒画布所需——没有逐 flow 的自动适配规则、
 * 没有选中跟随。内容以原点为中心，因此平移无需钳制。自动调整半边在
 * `canvas-viewport-auto.ts`；本文件只留装配。
 *
 * @module @veren/notebook-ui/client/canvas-viewport
 */

import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { CanvasLayout } from './canvas-layout.ts'
import { useInitialViewPerKey, useViewportSize, useWheelZoom, useZoomActions } from './canvas-viewport-auto.ts'
import type { Viewport } from './canvas-viewport-math.ts'

export type { Viewport } from './canvas-viewport-math.ts'

/** The controller the stage element binds to. 舞台元素绑定的控制器。 */
export interface CanvasViewportController {
  readonly ref: { current: HTMLDivElement | null }
  readonly view: Viewport
  /** Measured stage size in CSS px; the stage resizes to it. 量得的舞台尺寸（CSS px）；舞台按其调整大小。 */
  readonly size: { readonly width: number; readonly height: number }
  /** The stage writes its drag position back through this. 舞台经此回写自己的拖拽位置。 */
  readonly setView: Dispatch<SetStateAction<Viewport>>
  readonly zoomBy: (factor: number) => void
  readonly fit: () => void
}

/**
 * Own the viewport transform for one laid-out box.
 * @param layout - the current layout (its hub focus drives the opening frame).
 * @param viewKey - apply the opening view when this changes (the owner id).
 * @returns the controller the stage element binds.
 *
 * 为一幅已布局的盒持有视口变换。viewKey 变化即应用打开视口（归属 id）。
 */
export function useCanvasViewport(layout: CanvasLayout, viewKey: string): CanvasViewportController {
  const ref = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const size = useViewportSize(ref)
  const zoom = useZoomActions(layout, size, setView)
  useWheelZoom(ref, setView)
  useInitialViewPerKey(layout, viewKey, size, setView)
  return { ref, view, size, setView, zoomBy: zoom.zoomBy, fit: zoom.fit }
}
