/**
 * The viewport arithmetic: clamping, the fit-to-screen frame, and the readable
 * opening frame of one box. Pure functions only — no React, no DOM — so the
 * numbers a reader actually sees (zoom bounds, fit padding, the opening zoom)
 * are pinned by tests instead of by eyeballing the canvas. The React halves
 * that drive these live in `canvas-viewport-auto`.
 *
 * 视口算术：钳制、适配屏幕的视口，以及每盒可读的打开视口。只有纯函数——无 React、
 * 无 DOM——于是读者真正看到的数字（缩放边界、适配留白、打开缩放）由测试钉住，而不
 * 是靠肉眼看画布。驱动它们的 React 半边住在 `canvas-viewport-auto`。
 *
 * @module @veren/notebook-ui/client/canvas-viewport-math
 */

import type { CanvasLayout } from './canvas-layout.ts'

/** The viewport transform: content point p lands at screen p·zoom + (x, y). 视口变换：内容点 p 落在屏幕 p·zoom + (x, y)。 */
export interface Viewport {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

/** Zoom bounds: far enough out to see a big box, close enough to read a card. 缩放边界：远能看全大盒，近能读清单卡。 */
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2

/** Padding kept around the drawing when fitting. 适配时图幅四周留白。 */
export const FIT_PAD = 48

/** A drag must move this many px (Manhattan) before it counts as a pan. 拖动 Manhattan 距离超过此值才算平移。 */
export const PAN_THRESHOLD = 4

/** The zoom every box opens at: card detail stays readable (a 13px title is
 * 11.05px on screen). `Fit` remains an explicit toolbar action. 每个盒打开时的
 * 缩放：卡片细节保持可读（13px 标题在屏上为 11.05px）。「适配」仍是显式的
 * 工具条动作。 */
export const DEFAULT_ZOOM = 0.85

/** Clamp a zoom factor into the legal range. 把缩放值钳进合法区间。 */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * Fit the whole drawing with padding, anchored at the viewport center.
 * @param layout - the drawing bounds.
 * @param size - the measured viewport.
 * @returns the transform that shows everything, zoom clamped into range.
 *
 * 留白适配整幅图，锚在视口中心；缩放钳进合法区间。
 */
export function fitViewport(layout: CanvasLayout, size: { width: number; height: number }): Viewport {
  const zoom = clampZoom(Math.min(
    (size.width - FIT_PAD) / Math.max(1, layout.width),
    (size.height - FIT_PAD) / Math.max(1, layout.height),
    1,
  ))
  const safe = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return { x: size.width / 2, y: size.height / 2, zoom: safe }
}

/**
 * The view a box opens at: readable zoom on the hub ring's centroid, never a
 * fit-to-viewport squeeze. The old opening fit shrank nine cards to ~0.5,
 * turning a 12px title into 6px — the first thing a reader had to read was the
 * one thing they could not.
 *
 * @param layout - the laid-out box (its `focus` is the hub centroid).
 * @param size - the measured stage size.
 * @returns the viewport transform for the opening frame.
 *
 * 盒打开时的视口：可读缩放下对准枢纽环质心，绝不再做塞满视口的适配。旧的
 * 打开即适配把九张卡压到约 0.5，12px 标题变成 6px——读者最先要读的东西恰好
 * 读不了。
 */
export function initialView(layout: CanvasLayout, size: { width: number; height: number }): Viewport {
  const zoom = clampZoom(DEFAULT_ZOOM)
  return {
    zoom,
    x: size.width / 2 - layout.focus.x * zoom,
    y: size.height / 2 - layout.focus.y * zoom,
  }
}
