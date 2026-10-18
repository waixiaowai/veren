/**
 * Edge-label geometry: width estimation and collision avoidance against node
 * cards and other labels. Kept separate from graph layout so the placement
 * policy can change without touching ranking or routing.
 *
 * 边标签几何：宽度估算，以及避开节点卡片与其他标签的碰撞处理。与图布局分离，
 * 让摆放策略可以独立变化，不影响分层与路由。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/edgeLabels
 */

/** A label rectangle candidate, positioned by its center. */
export interface LabelCandidate {
    readonly id: string
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

/** A label after collision avoidance. */
export interface LabelPlacement extends LabelCandidate {}

/** A rectangle obstacle in graph coordinates. */
export interface RectObstacle {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

/**
 * Width estimate for a short SVG pill label. CJK glyphs are roughly twice as
 * wide as Latin ones at the same font size.
 * @param text - rendered label text.
 * @returns the pill width in px.
 */
export function estimateEdgeLabelWidth(text: string): number {
    let width = 18
    for (const char of text) width += char.charCodeAt(0) > 255 ? 11 : 6.4
    return Math.ceil(width)
}

/**
 * Nudge labels vertically until they touch neither a node card nor another
 * label. Stable input order keeps the result deterministic across renders.
 * @param candidates - label rects at their preferred center.
 * @param obstacles - node boxes to avoid.
 * @param bounds - graph size used to keep labels inside the canvas.
 * @returns placed label rects, in input order.
 */
export function placeEdgeLabels(
    candidates: readonly LabelCandidate[],
    obstacles: readonly RectObstacle[],
    bounds: { readonly width: number; readonly height: number },
): readonly LabelPlacement[] {
    const placed: LabelCandidate[] = []
    const offsets = [0, -20, 20, -40, 40, -60, 60]
    for (const candidate of candidates) {
        const x = Math.min(
            Math.max(candidate.width / 2 + 8, candidate.x),
            Math.max(candidate.width / 2 + 8, bounds.width - candidate.width / 2 - 8),
        )
        let chosen: LabelCandidate | undefined
        for (const dy of offsets) {
            const next: LabelCandidate = { ...candidate, x, y: candidate.y + dy }
            if (!placed.some(other => labelsIntersect(next, other))
                && !obstacles.some(box => overlapsRect(next, box, 4))) {
                chosen = next
                break
            }
        }
        placed.push(chosen ?? { ...candidate, x })
    }
    return placed
}

/** Whether two center-positioned label rects overlap. */
function labelsIntersect(left: LabelCandidate, right: LabelCandidate): boolean {
    return Math.abs(left.x - right.x) * 2 < left.width + right.width + 6
        && Math.abs(left.y - right.y) * 2 < left.height + right.height + 6
}

/** Whether a center-positioned label overlaps a graph rectangle. */
function overlapsRect(label: LabelCandidate, rect: RectObstacle, padding: number): boolean {
    const left = rect.x - padding
    const right = rect.x + rect.width + padding
    const top = rect.y - padding
    const bottom = rect.y + rect.height + padding
    return label.x + label.width / 2 > left
        && label.x - label.width / 2 < right
        && label.y + label.height / 2 > top
        && label.y - label.height / 2 < bottom
}
