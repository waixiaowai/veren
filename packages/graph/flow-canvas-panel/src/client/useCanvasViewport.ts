/**
 * Canvas viewport controller: pan, cursor-anchored zoom, fit-to-screen, the
 * one-time fit per flow, keeping the selected node visible, and re-centering
 * when a side panel shrinks the viewport but the graph still fits.
 *
 * Kept as a hook so `FlowGraph` stays a small rendering component and the
 * viewport rules remain in one place.
 *
 * 画布视口控制器：平移、以光标为锚点缩放、适应屏幕、每个 flow 只自动适应一次、
 * 保持选中节点可见，以及侧栏使视口变窄但图仍放得下时重新居中。做成 hook，
 * 让 `FlowGraph` 保持为小渲染组件，视口规则集中在一处。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/useCanvasViewport
 */

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
} from 'react'
import type { FlowLayout } from './layout.ts'
import {
    clampZoom,
    ensureVisible,
    fitView,
    panBy,
    resetZoom,
    zoomAt,
    type Viewport,
} from './view.ts'

/** What `FlowGraph` binds to the viewport element and controls. */
export interface CanvasViewportController {
    /** Attach to the scroll/pan surface. */
    readonly ref: { current: HTMLDivElement | null }
    /** Current transform. */
    readonly view: Viewport
    /** Measured viewport size in px. */
    readonly size: { readonly width: number; readonly height: number }
    /** Whether a pan drag is active. */
    readonly dragging: boolean
    /** Zoom by a factor around the viewport center. */
    readonly zoomBy: (factor: number) => void
    /** Back to 100% around the viewport center. */
    readonly reset: () => void
    /** Fit the whole graph with padding. */
    readonly fit: () => void
    readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
    readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
    readonly onPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void
    readonly onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void
}

/** A pointer drag in progress. */
interface DragState {
    readonly pointerId: number
    readonly startX: number
    readonly startY: number
    readonly origin: Viewport
    moved: boolean
}

/** Elements that own their own click and must not start a pan. */
const INTERACTIVE = '[data-flow-node], [data-canvas-control]'

/**
 * Own the viewport transform for one laid-out graph.
 * @param layout - current graph layout.
 * @param flowId - used to fit once per flow.
 * @param selectedNodeId - node to keep visible.
 * @param onClearSelection - called for a click on empty canvas.
 * @returns the controller bound by the graph component.
 */
export function useCanvasViewport(
    layout: FlowLayout,
    flowId: string,
    selectedNodeId: string | undefined,
    onClearSelection: (() => void) | undefined,
): CanvasViewportController {
    const ref = useRef<HTMLDivElement>(null)
    const dragRef = useRef<DragState>()
    const fittedRef = useRef<string>()
    const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
    const [size, setSize] = useState({ width: 0, height: 0 })
    const [dragging, setDragging] = useState(false)

    const fit = useCallback((): void => {
        const element = ref.current
        const width = element?.clientWidth ?? 0
        const height = element?.clientHeight ?? 0
        if (width <= 0 || height <= 0) return
        setView(fitView(layout.width, layout.height, width, height))
    }, [layout.width, layout.height])

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
    }, [])

    // Fit once per flow/layout size. A later viewport resize (for example the
    // inspector opening) must not silently shrink a graph the operator zoomed.
    useLayoutEffect(() => {
        if (size.width <= 0 || size.height <= 0) return
        const key = `${flowId}:${layout.width}x${layout.height}`
        if (fittedRef.current === key) return
        fittedRef.current = key
        setView(fitView(layout.width, layout.height, size.width, size.height))
    }, [flowId, layout.width, layout.height, size.width, size.height])

    useLayoutEffect(() => {
        if (selectedNodeId === undefined || size.width <= 0) return
        const box = layout.nodes[selectedNodeId]
        if (box === undefined) return
        setView(current => ensureVisible(current, box, size.width, size.height, 32))
    }, [selectedNodeId, layout, size.width, size.height])

    // When a side panel opens the viewport shrinks. If the graph still fits at
    // the current zoom, center it instead of leaving the right edge clipped;
    // otherwise keep the zoom and just keep the selected node in view.
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
    }, [])

    const zoomBy = useCallback((factor: number): void => {
        setView(current => zoomAt(current, size.width / 2, size.height / 2, clampZoom(current.zoom * factor)))
    }, [size.width, size.height])

    const reset = useCallback((): void => {
        setView(current => resetZoom(current, size.width, size.height))
    }, [size.width, size.height])

    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0) return
        const target = event.target as Element
        if (target.closest(INTERACTIVE) !== null) return
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            origin: view,
            moved: false,
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        setDragging(true)
    }

    const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
        const drag = dragRef.current
        if (drag === undefined || drag.pointerId !== event.pointerId) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return
        drag.moved = true
        setView(panBy(drag.origin, dx, dy))
    }

    const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
        const drag = dragRef.current
        if (drag === undefined || drag.pointerId !== event.pointerId) return
        dragRef.current = undefined
        setDragging(false)
        try {
            event.currentTarget.releasePointerCapture?.(event.pointerId)
        } catch {
            // The pointer may already be released; losing capture is harmless.
        }
        const target = event.target as Element
        if (!drag.moved && target.closest(INTERACTIVE) === null) onClearSelection?.()
    }

    const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
        const target = event.target as Element
        if (target.closest(INTERACTIVE) !== null) return
        fit()
    }

    return {
        ref,
        view,
        size,
        dragging,
        zoomBy,
        reset,
        fit,
        onPointerDown,
        onPointerMove,
        onPointerEnd,
        onDoubleClick,
    }
}
