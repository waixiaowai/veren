/**
 * Auto-adjust viewport effects, split out of `useCanvasViewport` by
 * responsibility: measuring the surface, the once-per-flow fit, keeping the
 * selected node visible, re-centering when a side panel shrinks the viewport
 * but the graph still fits, cursor-anchored wheel zoom, and the center-anchored
 * zoom actions. Each effect keeps its original dependency list and timing.
 *
 * 视口自动调整类副作用，按职责从 `useCanvasViewport` 拆出：表面测量、每 flow 一次的
 * fit、保持选中节点可见、侧栏使视口变窄但图仍放得下时重新居中、以光标为锚点的滚轮
 * 缩放，以及视口中心的缩放动作。每个 effect 保留原有的依赖列表与时序。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/viewportAuto
 */

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react'
import type { FlowLayout } from './layout.ts'
import { clampZoom, ensureVisible, fitView, resetZoom, zoomAt, type Viewport } from './view.ts'

/** The pan-surface element ref shape (structural, so both React ref typings fit). */
export type SurfaceRef = { readonly current: HTMLDivElement | null }

/** The measured viewport size in px. */
export interface ViewportSize {
    readonly width: number
    readonly height: number
}

/** The viewport state setter. */
export type ViewportSetter = Dispatch<SetStateAction<Viewport>>

/** The center-anchored zoom actions and the fit action. */
export interface ViewportZoomActions {
    zoomBy: (factor: number) => void
    reset: () => void
    fit: () => void
}

/**
 * Measure the pan surface: ResizeObserver plus a window-resize fallback.
 * 测量平移表面尺寸：ResizeObserver + window resize 兜底。
 */
export function useViewportSize(ref: SurfaceRef): ViewportSize {
    const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 })
    useLayoutEffect(() => {
        const element = ref.current
        if (element === null) return
        const measure = (): void => {
            const width = element.clientWidth
            const height = element.clientHeight
            setSize(previous => previous.width === width && previous.height === height
                ? previous
                : { width, height })
        }
        measure()
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
        observer?.observe(element)
        window.addEventListener('resize', measure)
        return () => {
            observer?.disconnect()
            window.removeEventListener('resize', measure)
        }
    }, [ref])
    return size
}

/**
 * Fit once per flow/layout size. A later viewport resize (for example the
 * inspector opening) must not silently shrink a graph the operator zoomed.
 * 每 flow/布局尺寸只 fit 一次：之后视口 resize（如检查器打开）不得悄悄缩小
 * 操作者已缩放过的图。
 */
export function useFitPerFlow(layout: FlowLayout, flowId: string, size: ViewportSize, setView: ViewportSetter): void {
    const fittedRef = useRef<string>()
    useLayoutEffect(() => {
        if (size.width <= 0 || size.height <= 0) return
        const key = `${flowId}:${layout.width}x${layout.height}`
        if (fittedRef.current === key) return
        fittedRef.current = key
        setView(fitView(layout.width, layout.height, size.width, size.height))
    }, [flowId, layout.width, layout.height, size.width, size.height])
}

/** Keep the selected node visible while the selection changes. / 选中节点变化时保持其可见。 */
export function useKeepNodeVisible(
    layout: FlowLayout,
    selectedNodeId: string | undefined,
    size: ViewportSize,
    setView: ViewportSetter,
): void {
    useLayoutEffect(() => {
        if (selectedNodeId === undefined || size.width <= 0) return
        const box = layout.nodes[selectedNodeId]
        if (box === undefined) return
        setView(current => ensureVisible(current, box, size.width, size.height, 32))
    }, [selectedNodeId, layout, size.width, size.height])
}

/**
 * When a side panel opens the viewport shrinks. If the graph still fits at
 * the current zoom, center it instead of leaving the right edge clipped;
 * otherwise keep the zoom and just keep the selected node in view.
 * 侧栏打开使视口变窄时：图在当前缩放下仍放得下就居中，否则保持缩放，
 * 只保证选中节点可见。
 */
export function useCenterWhenFits(layout: FlowLayout, size: ViewportSize, setView: ViewportSetter): void {
    useLayoutEffect(() => {
        if (size.width <= 0 || size.height <= 0) return
        setView(current => {
            const scaledWidth = layout.width * current.zoom
            const scaledHeight = layout.height * current.zoom
            if (scaledWidth > size.width || scaledHeight > size.height) return current
            const x = (size.width - scaledWidth) / 2
            const y = (size.height - scaledHeight) / 2
            return x === current.x && y === current.y ? current : { ...current, x, y }
        })
    }, [size.width, size.height, layout.width, layout.height])
}

/** Cursor-anchored wheel zoom; non-passive so the page never scrolls. / 以光标为锚点的滚轮缩放；非被动监听，页面不滚动。 */
export function useWheelZoom(ref: SurfaceRef, setView: ViewportSetter): void {
    useEffect(() => {
        const element = ref.current
        if (element === null) return
        const onWheel = (event: WheelEvent): void => {
            event.preventDefault()
            const rect = element.getBoundingClientRect()
            const px = event.clientX - rect.left
            const py = event.clientY - rect.top
            const factor = Math.exp(-event.deltaY * 0.0015)
            setView(current => zoomAt(current, px, py, current.zoom * factor))
        }
        element.addEventListener('wheel', onWheel, { passive: false })
        return () => { element.removeEventListener('wheel', onWheel) }
    }, [ref, setView])
}

/** Center-anchored zoom actions (controls) plus the fit action. / 视口中心的缩放动作（控件）与 fit。 */
export function useZoomActions(ref: SurfaceRef, layout: FlowLayout, size: ViewportSize, setView: ViewportSetter): ViewportZoomActions {
    const fit = useCallback((): void => {
        const element = ref.current
        const width = element?.clientWidth ?? 0
        const height = element?.clientHeight ?? 0
        if (width <= 0 || height <= 0) return
        setView(fitView(layout.width, layout.height, width, height))
    }, [layout.width, layout.height, ref, setView])
    const zoomBy = useCallback((factor: number): void => {
        setView(current => zoomAt(current, size.width / 2, size.height / 2, clampZoom(current.zoom * factor)))
    }, [size.width, size.height])
    const reset = useCallback((): void => {
        setView(current => resetZoom(current, size.width, size.height))
    }, [size.width, size.height])
    return { zoomBy, reset, fit }
}
