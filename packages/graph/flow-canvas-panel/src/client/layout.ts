/**
 * Caller-owned auto-layout for the canvas panel: a left-to-right layered DAG
 * with Bézier edges, the convention operators already know from n8n / Dify /
 * Coze. Each rank is a column; columns are centered vertically so a two-node
 * branch stays next to the node it splits from. The projection's layout slots
 * stay empty and nothing is written back to the kernel.
 *
 * 画布面板自有的自动布局：从左到右的分层 DAG 与贝塞尔边，采用 n8n / Dify / Coze
 * 用户已经熟悉的习惯。每个 rank 是一列，列内垂直居中，让双节点分支紧邻分叉点。
 * 投影的 layout 槽位保持为空，也不会写回内核。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/layout
 */

import type { CanvasEdge, CanvasEdgeCondition, CanvasFlow } from '@deepseek-ai/dsh-graph-flow-canvas'

/** Node card dimensions shared with the stylesheet. */
export const NODE_WIDTH = 184
export const NODE_HEIGHT = 72

/** Gaps and page padding. */
const COLUMN_GAP = 80
const ROW_GAP = 24
const PAD_X = 28
const PAD_Y = 28

/** One laid-out node box. */
export interface NodeBox {
    readonly id: string
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
    readonly rank: number
}

/** One routed edge. */
export interface EdgeRoute {
    readonly id: string
    readonly from: string
    readonly to: string
    readonly path: string
    readonly condition: CanvasEdgeCondition
    /** Source anchor (right port) in graph coordinates / 起点锚点（右侧端口） */
    readonly fromX: number
    readonly fromY: number
    /** Target anchor (left port) in graph coordinates / 终点锚点（左侧端口） */
    readonly toX: number
    readonly toY: number
    /** Label anchor in graph coordinates / 标签锚点（图坐标） */
    readonly labelX: number
    readonly labelY: number
}

/** The whole-graph layout result. */
export interface FlowLayout {
    readonly width: number
    readonly height: number
    readonly nodes: Readonly<Record<string, NodeBox>>
    readonly edges: readonly EdgeRoute[]
}

/**
 * Lay out one static projection.
 * @param flow - the canvas projection.
 * @returns node boxes, routed edges and the canvas size.
 */
export function layoutFlow(flow: CanvasFlow): FlowLayout {
    const ranks = rankNodes(flow)
    const groups = groupNodesByRank(flow, ranks)
    const { width, height } = canvasSize(groups)
    const nodes = placeNodes(groups, height)
    const edges = routeEdges(flow, nodes)
    return { width, height, nodes, edges }
}

/** Group node ids by rank, keeping declaration order inside a group. */
function groupNodesByRank(flow: CanvasFlow, ranks: Map<string, number>): Map<number, string[]> {
    const groups = new Map<number, string[]>()
    for (const node of flow.nodes) {
        const rank = ranks.get(node.id) ?? 0
        const group = groups.get(rank) ?? []
        group.push(node.id)
        groups.set(rank, group)
    }
    return groups
}

/** Canvas size from the deepest rank and the widest column. */
function canvasSize(groups: Map<number, string[]>): { width: number; height: number } {
    const maxRank = groups.size === 0 ? 0 : Math.max(...groups.keys())
    const widest = Math.max(1, ...[...groups.values()].map(group => group.length))
    return {
        width: PAD_X * 2 + (maxRank + 1) * NODE_WIDTH + maxRank * COLUMN_GAP,
        height: PAD_Y * 2 + widest * NODE_HEIGHT + (widest - 1) * ROW_GAP,
    }
}

/** Place the node boxes, centering each column vertically. */
function placeNodes(groups: Map<number, string[]>, height: number): Record<string, NodeBox> {
    const nodes: Record<string, NodeBox> = {}
    for (const [rank, group] of [...groups.entries()].sort(([a], [b]) => a - b)) {
        const stack = group.length * NODE_HEIGHT + (group.length - 1) * ROW_GAP
        const offset = (height - PAD_Y * 2 - stack) / 2 + PAD_Y
        group.forEach((id, index) => {
            nodes[id] = {
                id,
                x: PAD_X + rank * (NODE_WIDTH + COLUMN_GAP),
                y: offset + index * (NODE_HEIGHT + ROW_GAP),
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
                rank,
            }
        })
    }
    return nodes
}

/** Route every edge with lane offsets so parallel branches fan out. */
function routeEdges(flow: CanvasFlow, nodes: Readonly<Record<string, NodeBox>>): EdgeRoute[] {
    const outgoing = groupEdges(flow, true, nodes)
    const incoming = groupEdges(flow, false, nodes)
    const edges: EdgeRoute[] = []
    for (const edge of flow.edges) {
        const from = nodes[edge.from]
        const to = nodes[edge.to]
        if (from === undefined || to === undefined) continue
        const out = outgoing.get(edge.from) ?? []
        const into = incoming.get(edge.to) ?? []
        const outOffset = laneOffset(out.indexOf(edge.id), out.length)
        const inOffset = laneOffset(into.indexOf(edge.id), into.length, 10)
        const route = routeEdge(from, to, outOffset, inOffset)
        edges.push({ id: edge.id, from: edge.from, to: edge.to, condition: edge.condition, ...route })
    }
    return edges
}

/**
 * Group edges by one endpoint, ordered by the opposite endpoint's vertical
 * position so branches fan out without crossing.
 * @param flow - the projection.
 * @param bySource - group by `from` when true, by `to` otherwise.
 * @param boxes - laid-out node boxes.
 * @returns edge ids per endpoint.
 */
function groupEdges(
    flow: CanvasFlow,
    bySource: boolean,
    boxes: Readonly<Record<string, NodeBox>>,
): Map<string, string[]> {
    const byId = new Map(flow.edges.map(edge => [edge.id, edge]))
    const groups = new Map<string, string[]>()
    for (const edge of flow.edges) {
        const endpoint = bySource ? edge.from : edge.to
        const group = groups.get(endpoint) ?? []
        group.push(edge.id)
        groups.set(endpoint, group)
    }
    for (const ids of groups.values()) {
        ids.sort((left, right) => {
            const leftEdge = byId.get(left)
            const rightEdge = byId.get(right)
            if (leftEdge === undefined || rightEdge === undefined) return left.localeCompare(right)
            const leftPeer = boxes[bySource ? leftEdge.to : leftEdge.from]
            const rightPeer = boxes[bySource ? rightEdge.to : rightEdge.from]
            return (leftPeer?.y ?? 0) - (rightPeer?.y ?? 0) || left.localeCompare(right)
        })
    }
    return groups
}

/** Symmetric offset for the k-th of n parallel edges. */
function laneOffset(index: number, count: number, spacing = 14): number {
    if (index < 0 || count < 2) return 0
    return (index - (count - 1) / 2) * spacing
}

/** Path, label position and port anchors of one edge. */
function routeEdge(
    from: NodeBox,
    to: NodeBox,
    outOffset: number,
    inOffset: number,
): { path: string; labelX: number; labelY: number; fromX: number; fromY: number; toX: number; toY: number } {
    const anchors = {
        x1: from.x + from.width,
        y1: from.y + from.height / 2 + outOffset,
        x2: to.x,
        y2: to.y + to.height / 2 + inOffset,
    }
    // Forward edge: a horizontal Bézier; same-rank or back edge: loop below both cards.
    // 前向边走水平贝塞尔；同层/回边绕到两卡片下方，避免压在节点上。
    return to.rank > from.rank ? forwardRoute(outOffset, anchors) : backRoute(from, to)
}

/** Anchors of one edge in graph coordinates / 一条边在图坐标里的端口锚点 */
interface EdgeAnchors {
    x1: number
    y1: number
    x2: number
    y2: number
}

/** A forward edge: one horizontal Bézier with the label at its midpoint. */
function forwardRoute(
    outOffset: number,
    anchors: EdgeAnchors,
): { path: string; labelX: number; labelY: number; fromX: number; fromY: number; toX: number; toY: number } {
    const { x1, y1, x2, y2 } = anchors
    const bend = Math.max(30, (x2 - x1) * 0.46)
    const path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
    const point = cubicAt(x1, y1, x1 + bend, y1, x2 - bend, y2, x2, y2, 0.5)
    const side = outOffset <= 0 ? -1 : 1
    return {
        path,
        labelX: point.x,
        labelY: point.y + side * 14,
        fromX: x1,
        fromY: y1,
        toX: x2,
        toY: y2,
    }
}

/** A same-rank or back edge: loop below both cards so it never crosses them. */
function backRoute(
    from: NodeBox,
    to: NodeBox,
): { path: string; labelX: number; labelY: number; fromX: number; fromY: number; toX: number; toY: number } {
    const bottom = Math.max(from.y + from.height, to.y + to.height) + 40
    const sx = from.x + from.width / 2
    const tx = to.x + to.width / 2
    const path = `M ${sx} ${from.y + from.height} C ${sx} ${bottom}, ${tx} ${bottom}, ${tx} ${to.y + to.height}`
    return {
        path,
        labelX: (sx + tx) / 2,
        labelY: bottom + 10,
        fromX: sx,
        fromY: from.y + from.height,
        toX: tx,
        toY: to.y + to.height,
    }
}

/** Sample a cubic Bézier at `t`. */
function cubicAt(
    x1: number, y1: number,
    cx1: number, cy1: number,
    cx2: number, cy2: number,
    x2: number, y2: number,
    t: number,
): { x: number; y: number } {
    const u = 1 - t
    const x = u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2
    const y = u * u * u * y1 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y2
    return { x, y }
}

/** Longest-path rank per node. */
function rankNodes(flow: CanvasFlow): Map<string, number> {
    const ids = flow.nodes.map(node => node.id)
    const indegree = new Map<string, number>(ids.map(id => [id, 0]))
    const outgoing = new Map<string, string[]>(ids.map(id => [id, []]))
    for (const edge of flow.edges) {
        if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue
        indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
        outgoing.get(edge.from)?.push(edge.to)
    }
    const queue = ids.filter(id => (indegree.get(id) ?? 0) === 0)
    const order: string[] = []
    while (queue.length > 0) {
        const id = queue.shift()
        if (id === undefined) break
        order.push(id)
        for (const next of outgoing.get(id) ?? []) {
            const left = (indegree.get(next) ?? 0) - 1
            indegree.set(next, left)
            if (left === 0) queue.push(next)
        }
    }
    // The engine rejects cycles, but a projection may come from an external
    // definition; append cycle members in declaration order.
    for (const id of ids) if (!order.includes(id)) order.push(id)
    const ranks = new Map<string, number>(ids.map(id => [id, 0]))
    for (const id of order) {
        for (const next of outgoing.get(id) ?? []) {
            ranks.set(next, Math.max(ranks.get(next) ?? 0, (ranks.get(id) ?? 0) + 1))
        }
    }
    return ranks
}

/**
 * Whether the flow projection declares any edge with a visible condition label.
 * 仅供测试/对外契约 / test-only / external contract.
 */
export function hasConditionalEdges(edges: readonly CanvasEdge[]): boolean {
    return edges.some(edge => edge.condition.kind !== 'always')
}
