/**
 * Canvas viewport controller: pan, cursor-anchored zoom, fit-to-screen, the
 * one-time fit per flow, keeping the selected node visible, and re-centering
 * when a side panel shrinks the viewport but the graph still fits.
 *
 * Kept as a hook so `FlowGraph` stays a small rendering component and the
 * viewport rules remain in one place. The auto-adjust effects live in
 * `viewportAuto`; this file owns the pointer-driven interaction state.
 *
 * 画布视口控制器：平移、以光标为锚点缩放、适应屏幕、每个 flow 只自动适应一次、
 * 保持选中节点可见，以及侧栏使视口变窄但图仍放得下时重新居中。做成 hook，
 * 让 `FlowGraph` 保持为小渲染组件，视口规则集中在一处。自动调整类副作用在
 * `viewportAuto`；本文件只保留指针驱动的交互状态。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/useCanvasViewport
 */

import {
    useRef,
    useState,
    type Dispatch,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type SetStateAction,
} from 'react'
import type { FlowLayout } from './layout.ts'
import type { Viewport } from './view.ts'
import { panBy } from './view.ts'
import {
    useCenterWhenFits,
    useFitPerFlow,
    useKeepNodeVisible,
    useViewportSize,
    useWheelZoom,
    useZoomActions,
} from './viewportAuto.ts'

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

/** Shared mutable slot of the in-progress drag. / 在途拖拽的共享可变槽位 */
type DragRegistry = { current: DragState | undefined }

/** Elements that own their own click and must not start a pan. */
const INTERACTIVE = '[data-flow-node], [data-canvas-control]'
/** Controls own their pointer too; node cards may still start a pan. */
const PAN_BLOCKERS = '[data-canvas-control]'

/** Begin a pan drag: primary button only, never on a canvas control. */
function beginPan(
    dragRef: DragRegistry,
    origin: Viewport,
    setDragging: Dispatch<SetStateAction<boolean>>,
    event: ReactPointerEvent<HTMLDivElement>,
): void {
    if (event.button !== 0) return
    const target = event.target as Element
    // Node cards may start a pan too (with native drag suppressed a drag on
    // a node must not be a dead zone); only canvas controls are excluded.
    // 节点卡片也可以启动平移（原生拖拽被禁止后，节点上的拖拽不能是死区）；
    // 只排除画布控件。
    if (target.closest(PAN_BLOCKERS) !== null) return
    dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin,
        moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
}

/** Track a pan drag; below the 4px threshold nothing moves yet. */
function trackPan(
    dragRef: DragRegistry,
    setView: Dispatch<SetStateAction<Viewport>>,
    event: ReactPointerEvent<HTMLDivElement>,
): void {
    const drag = dragRef.current
    if (drag === undefined || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    drag.moved = true
    setView(panBy(drag.origin, dx, dy))
}

/** End a pan drag; a click without movement on empty canvas clears the selection. */
function endPan(
    dragRef: DragRegistry,
    setDragging: Dispatch<SetStateAction<boolean>>,
    onClearSelection: (() => void) | undefined,
    event: ReactPointerEvent<HTMLDivElement>,
): void {
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
    const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
    const [dragging, setDragging] = useState(false)
    const size = useViewportSize(ref)
    const { fit, zoomBy, reset } = useZoomActions(ref, layout, size, setView)
    useFitPerFlow(layout, flowId, size, setView)
    useKeepNodeVisible(layout, selectedNodeId, size, setView)
    useCenterWhenFits(layout, size, setView)
    useWheelZoom(ref, setView)
    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => beginPan(dragRef, view, setDragging, event)
    const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => trackPan(dragRef, setView, event)
    const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => endPan(dragRef, setDragging, onClearSelection, event)
    const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
        if ((event.target as Element).closest(INTERACTIVE) !== null) return
        fit()
    }
    return {
        ref, view, size, dragging,
        zoomBy, reset, fit,
        onPointerDown, onPointerMove, onPointerEnd, onDoubleClick,
    }
}
