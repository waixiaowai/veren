/**
 * The viewport controller's React halves: the measured viewport size, the
 * non-passive wheel zoom, the opening view per box, and the zoom actions. Pan
 * itself lives in the Konva stage — the stage is the draggable surface — so the
 * pointer-pan hook the DOM world needed is gone. All arithmetic lives in
 * `canvas-viewport-math` (pure, testable); this file only binds it to React.
 *
 * 视口控制器的 React 半边：量得的视口尺寸、非 passive 的滚轮缩放、每盒的打开视口，
 * 以及缩放动作。平移本身住在 Konva 舞台——舞台就是可拖拽面——DOM 世界需要的指针
 * 平移钩子已删除。全部算术住在 `canvas-viewport-math`（纯函数、可测）；本文件只把它
 * 绑到 React。
 *
 * @module @veren/notebook-ui/client/canvas-viewport-auto
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { CanvasLayout } from './canvas-layout.ts'
import { clampZoom, fitViewport, initialView } from './canvas-viewport-math.ts'
import type { Viewport } from './canvas-viewport-math.ts'

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

/** The zoom actions: center-anchored zoom buttons and the fit-to-screen call. 缩放动作：以中心为锚的缩放按钮与适配调用。 */
export interface ZoomActions {
  readonly zoomBy: (factor: number) => void
  readonly fit: () => void
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

/** Apply the opening view when `viewKey` changes (the owner id): each box opens
 * once at the readable default, not fitted. `viewKey` 变化即应用打开视口
 * （归属 id）：每盒只以可读默认缩放打开一次，而非适配。 */
export function useInitialViewPerKey(layout: CanvasLayout, viewKey: string, size: { width: number; height: number }, setView: Dispatch<SetStateAction<Viewport>>): void {
  const appliedKey = useRef('')
  useEffect(() => {
    if (size.width === 0 || appliedKey.current === viewKey) return
    appliedKey.current = viewKey
    setView(initialView(layout, size))
  }, [viewKey, size.width, size.height, layout, setView])
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
