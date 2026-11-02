/**
 * The viewport controller's auto-adjust halves, split out of
 * `canvas-viewport.ts` so every function stays small (the flow-canvas
 * precedent's own viewportAuto split): the measured viewport size, the
 * non-passive wheel zoom, the pointer pan, and the zoom actions with the
 * one-time fit.
 *
 * 视口控制器的自动调整半边，自 `canvas-viewport.ts` 拆出，让每个函数保持短小
 * （flow-canvas 先例自己的 viewportAuto 拆分）：量得的视口尺寸、非 passive 的
 * 滚轮缩放、指针平移，以及带一次性适配的缩放动作。
 *
 * @module @veren/notebook-ui/client/canvas-viewport-auto
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import type { CanvasLayout } from './canvas-layout.ts'
import type { Viewport } from './canvas-viewport.ts'

/** Zoom bounds: far enough out to see a big box, close enough to read a card. 缩放边界：远能看全大盒，远能读清单卡。 */
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2

/** Padding kept around the drawing when fitting. 适配时图幅四周留白。 */
const FIT_PAD = 48

/** A drag must move this many px (Manhattan) before it counts as a pan. 拖动 Manhattan 距离超过此值才算平移。 */
const PAN_THRESHOLD = 4

/** Clamp a zoom factor into the legal range. 把缩放值钳进合法区间。 */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** Measure the stage element with a ResizeObserver. 用 ResizeObserver 量舞台元素。 */
export function useViewportSize(ref: { current: HTMLDivElement | null }): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect !== undefined) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [ref])
  return size
}

/** Cursor-anchored wheel zoom on a native non-passive listener (React's wheel prop is passive). 原生非 passive 监听上的光标锚定滚轮缩放（React 的 wheel prop 是 passive 的）。 */
export function useWheelZoom(ref: { current: HTMLDivElement | null }, setView: Dispatch<SetStateAction<Viewport>>): void {
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const handler = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
      const factor = Math.exp(-event.deltaY * 0.0015)
      setView(current => {
        const zoom = clampZoom(current.zoom * factor)
        const ratio = zoom / current.zoom
        const cx = event.clientX - rect.left
        const cy = event.clientY - rect.top
        return { zoom, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio }
      })
    }
    element.addEventListener('wheel', handler, { passive: false })
    return () => { element.removeEventListener('wheel', handler) }
  }, [ref, setView])
}

/** One in-flight pointer pan. 一次进行中的指针平移。 */
interface DragState {
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  readonly origin: Viewport
  moved: boolean
}

/** The pointer pan's three handlers and its dragging flag. 指针平移的三个处理器与拖拽标记。 */
export interface PointerPan {
  readonly dragging: boolean
  readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  readonly onPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void
}

/** Begin a pan candidate on primary-button press: no capture yet — a plain
 * click must reach its real target (nodes, edge hit lines); capture only
 * starts once the drag crosses the threshold. 主键按下只立平移候选：先不捕获
 * ——纯点击必须落到真目标（节点、边命中线）；越过阈值才开捕获。 */
function beginPan(dragRef: { current: DragState | undefined }, origin: Viewport, event: ReactPointerEvent<HTMLDivElement>): void {
  if (event.button !== 0) return
  if ((event.target as Element).closest('button, a, [data-canvas-control]') !== null) return
  dragRef.current = {
    pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, moved: false,
  }
}

/** Track a drag already past the threshold: capture now and pan. 越阈后的拖拽：此刻捕获并平移。 */
function panBy(drag: DragState, setDragging: Dispatch<SetStateAction<boolean>>, setView: Dispatch<SetStateAction<Viewport>>, event: ReactPointerEvent<HTMLDivElement>): void {
  if (!drag.moved) {
    // The drag is real: capture now, so the rest of the gesture is ours and
    // plain clicks stay untouched.
    // 拖拽成立：此刻才捕获——后续手势归我们，纯点击不受影响。
    drag.moved = true
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  setView(current => ({ ...current, x: drag.origin.x + dx, y: drag.origin.y + dy }))
}

/** Own the pointer pan for one stage element; `onBackgroundClick` fires from
 * the stage's own onClick for clicks that hit nothing interactive. 为一个舞台
 * 元素持有指针平移；空白处的点击由舞台自身 onClick 经 `onBackgroundClick` 发出。 */
export function usePointerPan(view: Viewport, setView: Dispatch<SetStateAction<Viewport>>): PointerPan {
  const dragRef = useRef<DragState | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    beginPan(dragRef, view, event)
  }, [view])
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === undefined || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < PAN_THRESHOLD) return
    panBy(drag, setDragging, setView, event)
  }, [setView])
  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === undefined || drag.pointerId !== event.pointerId) return
    dragRef.current = undefined
    setDragging(false)
    if (!drag.moved) return
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    } catch {
      // The pointer may already be released; losing capture is harmless.
      // 指针可能早已释放；丢捕获无害。
    }
  }, [])
  return { dragging, onPointerDown, onPointerMove, onPointerEnd }
}

/** The zoom actions: center-anchored zoom buttons and the fit-to-screen call. 缩放动作：以中心为锚的缩放按钮与适配调用。 */
export interface ZoomActions {
  readonly zoomBy: (factor: number) => void
  readonly fit: () => void
}

/** Fit the whole drawing with padding, anchored at the viewport center. 留白适配整幅图，锚在视口中心。 */
export function fitViewport(layout: CanvasLayout, size: { width: number; height: number }): Viewport {
  const zoom = clampZoom(Math.min(
    (size.width - FIT_PAD) / Math.max(1, layout.width),
    (size.height - FIT_PAD) / Math.max(1, layout.height),
    1,
  ))
  const safe = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return { x: size.width / 2, y: size.height / 2, zoom: safe }
}

/** Mint the zoom actions from the measured size and the current layout. 由量得的尺寸与当前布局铸造缩放动作。 */
export function useZoomActions(layout: CanvasLayout, size: { width: number; height: number }, setView: Dispatch<SetStateAction<Viewport>>): ZoomActions {
  const zoomBy = useCallback((factor: number): void => {
    setView(current => {
      const zoom = clampZoom(current.zoom * factor)
      // Anchor at the viewport center: x' = cx − (cx − x)·(nz/oz).
      // 以视口中心为锚：x' = cx − (cx − x)·(nz/oz)。
      const ratio = zoom / current.zoom
      return {
        zoom,
        x: size.width / 2 - (size.width / 2 - current.x) * ratio,
        y: size.height / 2 - (size.height / 2 - current.y) * ratio,
      }
    })
  }, [size.width, size.height, setView])
  const fit = useCallback((): void => {
    if (size.width !== 0) setView(fitViewport(layout, size))
  }, [layout, size.width, setView])
  return { zoomBy, fit }
}

/** Refit when `fitKey` changes (the owner id): each box opens fitted once. `fitKey` 变化即重新适配（归属 id）：每盒只适配一次。 */
export function useFitPerKey(layout: CanvasLayout, fitKey: string, size: { width: number; height: number }, setView: Dispatch<SetStateAction<Viewport>>): void {
  const fittedKey = useRef('')
  useEffect(() => {
    if (size.width === 0 || fittedKey.current === fitKey) return
    fittedKey.current = fitKey
    setView(fitViewport(layout, size))
  }, [fitKey, size.width, layout, setView])
}

/**
 * Whether the viewport is at least `minWidth` px wide, re-evaluated on resize —
 * the narrow-viewport fallback's switch (below it the canvas yields to the list).
 * @param minWidth - the inclusive lower bound.
 * @returns whether the viewport is wide enough.
 *
 * 视口宽度是否不小于 `minWidth` px，随尺寸重估——窄视口回退的开关（低于它画布
 * 让位给列表）。
 */
export function useMinWidth(minWidth: number): boolean {
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const query = globalThis.matchMedia(`(min-width: ${String(minWidth)}px)`)
    const update = (): void => { setWide(query.matches) }
    update()
    query.addEventListener('change', update)
    return () => { query.removeEventListener('change', update) }
  }, [minWidth])
  return wide
}
