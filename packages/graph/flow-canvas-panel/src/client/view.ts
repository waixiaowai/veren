/**
 * Pan/zoom viewport math for the canvas.
 *
 * The view is a pure mapping from graph coordinates to screen coordinates:
 * `screen = content * zoom + offset`. Keeping it free of React and DOM makes
 * fit, cursor-anchored zoom, and "scroll the selected node into view" testable
 * without a real browser.
 *
 * 画布的平移/缩放视口数学。视图是图坐标到屏幕坐标的纯映射：
 * `screen = content * zoom + offset`。不依赖 React 与 DOM，因此适应屏幕、
 * 以光标为锚点缩放、把选中节点带入视野都能在无浏览器环境测试。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/view
 */

/** Minimum and maximum zoom of the canvas. */
export const MIN_ZOOM = 0.35
export const MAX_ZOOM = 2.5

/** One viewport transform: graph space -> screen space. */
export interface Viewport {
    /** Horizontal screen offset in px / 屏幕水平偏移（px） */
    readonly x: number
    /** Vertical screen offset in px / 屏幕垂直偏移（px） */
    readonly y: number
    /** Scale factor / 缩放比例 */
    readonly zoom: number
}

/** A rectangle in graph coordinates. */
export interface ViewBox {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

/** Clamp a zoom factor into the supported range. */
export function clampZoom(zoom: number): number {
    if (!Number.isFinite(zoom)) return 1
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * Fit a graph into a viewport, centering it and never magnifying above 1.1.
 * A zero-sized viewport (jsdom, first paint) keeps the neutral view.
 * @param contentWidth - graph width in graph units.
 * @param contentHeight - graph height in graph units.
 * @param viewWidth - available viewport width.
 * @param viewHeight - available viewport height.
 * @param padding - breathing room on every side.
 * @returns the fitted viewport.
 */
export function fitView(
    contentWidth: number,
    contentHeight: number,
    viewWidth: number,
    viewHeight: number,
    padding = 48,
): Viewport {
    if (contentWidth <= 0 || contentHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) {
        return { x: 0, y: 0, zoom: 1 }
    }
    const usableWidth = Math.max(1, viewWidth - padding * 2)
    const usableHeight = Math.max(1, viewHeight - padding * 2)
    const zoom = clampZoom(Math.min(1.05, usableWidth / contentWidth, usableHeight / contentHeight))
    return {
        zoom,
        x: (viewWidth - contentWidth * zoom) / 2,
        y: (viewHeight - contentHeight * zoom) / 2,
    }
}

/**
 * Zoom while keeping the graph point under `(px, py)` fixed on screen.
 * @param view - current viewport.
 * @param px - anchor x in viewport space.
 * @param py - anchor y in viewport space.
 * @param zoom - requested zoom.
 * @returns the new viewport.
 */
export function zoomAt(view: Viewport, px: number, py: number, zoom: number): Viewport {
    const next = clampZoom(zoom)
    if (next === view.zoom) return view
    const ratio = next / view.zoom
    return {
        zoom: next,
        x: px - (px - view.x) * ratio,
        y: py - (py - view.y) * ratio,
    }
}

/** Translate the view by a screen-space delta. */
export function panBy(view: Viewport, dx: number, dy: number): Viewport {
    if (dx === 0 && dy === 0) return view
    return { ...view, x: view.x + dx, y: view.y + dy }
}

/**
 * Shift the view just enough to reveal a node box, leaving a margin.
 * Returns the same object when the box is already visible, so callers can
 * use it inside a state updater without causing render loops.
 * @param view - current viewport.
 * @param box - node box in graph coordinates.
 * @param viewWidth - viewport width.
 * @param viewHeight - viewport height.
 * @param margin - keep-out margin around the viewport edge.
 * @returns the new (or unchanged) viewport.
 */
export function ensureVisible(
    view: Viewport,
    box: ViewBox,
    viewWidth: number,
    viewHeight: number,
    margin = 24,
): Viewport {
    if (viewWidth <= 0 || viewHeight <= 0) return view
    const left = box.x * view.zoom + view.x
    const top = box.y * view.zoom + view.y
    const right = (box.x + box.width) * view.zoom + view.x
    const bottom = (box.y + box.height) * view.zoom + view.y
    let x = view.x
    let y = view.y
    if (right > viewWidth - margin) x -= right - (viewWidth - margin)
    if (left + (x - view.x) < margin) x += margin - (left + (x - view.x))
    if (bottom > viewHeight - margin) y -= bottom - (viewHeight - margin)
    if (top + (y - view.y) < margin) y += margin - (top + (y - view.y))
    return x === view.x && y === view.y ? view : { ...view, x, y }
}

/**
 * Zoom to 100% around the viewport center.
 * @param view - current viewport.
 * @param viewWidth - viewport width.
 * @param viewHeight - viewport height.
 * @returns a viewport at 100%, anchored at the center.
 */
export function resetZoom(view: Viewport, viewWidth: number, viewHeight: number): Viewport {
    return zoomAt(view, viewWidth / 2, viewHeight / 2, 1)
}

/** Human-readable zoom percentage / 可读的缩放百分比 */
export function zoomPercent(view: Viewport): number {
    return Math.round(view.zoom * 100)
}
