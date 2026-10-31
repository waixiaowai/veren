/**
 * 自动布局：把 CanvasFlow 摆成从左到右的分层 DAG，并给每条边算出可绘制的
 * 贝塞尔路径与标注位置。布局只存在于 UI 侧，投影里的 layout 槽位保持为空。
 *
 * Auto-layout: place a CanvasFlow as a left-to-right layered DAG and compute a
 * drawable Bézier path plus a label position per edge. Layout lives only in the
 * UI; the projection's layout slots stay empty.
 */

import type { CanvasFlow } from '@deepseek-ai/dsh-graph-flow-canvas';
import { edgeVisual, type EdgeTone } from './model.js';

/** 节点卡片尺寸 / node card size */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 104;
/** 列间距与行间距 / column and row gaps */
const COLUMN_GAP = 120;
const ROW_GAP = 44;
/** 画布内边距 / canvas padding */
const PAD_X = 40;
const PAD_TOP = 64;
const PAD_BOTTOM = 72;

/** 一个排好序的节点盒子 / one laid-out node box */
export interface NodeBox {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** 从左到右的层号 / layer index from left to right */
    rank: number;
}

/** 一条排好路径的边 / one routed edge */
export interface EdgeRoute {
    id: string;
    from: string;
    to: string;
    path: string;
    label: string | null;
    title: string;
    tone: EdgeTone;
    dashed: boolean;
    /** 标注中心 / label centre */
    labelX: number;
    labelY: number;
}

/** 整图布局结果 / the whole-graph layout result */
export interface FlowLayout {
    width: number;
    height: number;
    nodes: Record<string, NodeBox>;
    edges: EdgeRoute[];
    /** 节点绘制顺序（先边后点）/ node paint order (edges first, then nodes) */
    order: string[];
}

/**
 * 布局主入口：分层 + 层内按原定义顺序 + 居中对齐，边从左列右缘连到右列
 * 左缘；同层/回边绕到下方，避免压在节点上。
 *
 * Layout entry: rank layers, keep declaration order inside a layer, centre each
 * column, connect right edge of one column to the left edge of the next;
 * same-rank/back edges loop below the cards instead of crossing them.
 *
 * @param flow 静态画布投影 / the static canvas projection
 * @returns 可绘制的布局 / the drawable layout
 */
export function layoutFlow(flow: CanvasFlow): FlowLayout {
    const ranks = rankNodes(flow);
    const groups = groupNodesByRank(flow, ranks);
    const { width, height } = canvasSize(groups);
    const nodes = placeNodes(groups);
    const edges = routeEdges(flow, nodes);
    return { width, height, nodes, edges, order: flow.nodes.map((node) => node.id) };
}

/** 按 rank 分组，组内保持声明顺序 / group node ids by rank, declaration order kept inside a group */
function groupNodesByRank(flow: CanvasFlow, ranks: Map<string, number>): Map<number, string[]> {
    const groups = new Map<number, string[]>();
    for (const node of flow.nodes) {
        const rank = ranks.get(node.id) ?? 0;
        const group = groups.get(rank) ?? [];
        group.push(node.id);
        groups.set(rank, group);
    }
    return groups;
}

/** 画布尺寸：由最深的列数与最宽的行数决定 / canvas size from the deepest rank and the widest column */
function canvasSize(groups: Map<number, string[]>): { width: number; height: number } {
    const maxRank = groups.size === 0 ? 0 : Math.max(...groups.keys());
    const maxRows = Math.max(1, ...[...groups.values()].map((group) => group.length));
    return {
        width: PAD_X * 2 + (maxRank + 1) * NODE_WIDTH + maxRank * COLUMN_GAP,
        height: PAD_TOP + PAD_BOTTOM + maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP,
    };
}

/** 摆放节点盒子（列内垂直居中）/ place the node boxes (columns centred vertically) */
function placeNodes(groups: Map<number, string[]>): Record<string, NodeBox> {
    const maxRows = Math.max(1, ...[...groups.values()].map((group) => group.length));
    const nodes: Record<string, NodeBox> = {};
    for (const [rank, group] of [...groups.entries()].sort(([a], [b]) => a - b)) {
        // 列内垂直居中 / centre each column vertically
        const offset = ((maxRows - group.length) * (NODE_HEIGHT + ROW_GAP)) / 2;
        group.forEach((id, index) => {
            nodes[id] = {
                id,
                x: PAD_X + rank * (NODE_WIDTH + COLUMN_GAP),
                y: PAD_TOP + offset + index * (NODE_HEIGHT + ROW_GAP),
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
                rank,
            };
        });
    }
    return nodes;
}

/** 路由全部边并附着可视信息 / route every edge and attach its visual facts */
function routeEdges(flow: CanvasFlow, nodes: Record<string, NodeBox>): EdgeRoute[] {
    const laneCounts = countParallelEdges(flow);
    const seen = new Map<string, number>();
    const edges: EdgeRoute[] = [];
    for (const edge of flow.edges) {
        const from = nodes[edge.from];
        const to = nodes[edge.to];
        if (!from || !to) continue;
        const key = `${edge.from}->${edge.to}`;
        const lane = seen.get(key) ?? 0;
        seen.set(key, lane + 1);
        const route = routeEdge(from, to, lane, laneCounts.get(key) ?? 1);
        const visual = edgeVisual(edge.condition);
        edges.push({
            id: edge.id,
            from: edge.from,
            to: edge.to,
            path: route.path,
            label: visual.label,
            title: visual.title,
            tone: visual.tone,
            dashed: visual.dashed,
            labelX: route.labelX,
            labelY: route.labelY,
        });
    }
    return edges;
}

/** 计算每个节点的最长路径层号 / longest-path rank per node */
function rankNodes(flow: CanvasFlow): Map<string, number> {
    const ids = flow.nodes.map((node) => node.id);
    const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
    const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const edge of flow.edges) {
        if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
        indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
        outgoing.get(edge.from)?.push(edge.to);
    }
    const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
    const order: string[] = [];
    while (queue.length > 0) {
        const id = queue.shift()!;
        order.push(id);
        for (const next of outgoing.get(id) ?? []) {
            const left = (indegree.get(next) ?? 0) - 1;
            indegree.set(next, left);
            if (left === 0) queue.push(next);
        }
    }
    // 防御：运行时会拒绝环，但投影可能来自外部定义；环内节点按原顺序补层
    // Defensive: the engine rejects cycles, but a projection may come from an
    // external definition; append cycle members in declaration order.
    for (const id of ids) if (!order.includes(id)) order.push(id);
    const ranks = new Map<string, number>(ids.map((id) => [id, 0]));
    for (const id of order) {
        for (const next of outgoing.get(id) ?? []) {
            ranks.set(next, Math.max(ranks.get(next) ?? 0, (ranks.get(id) ?? 0) + 1));
        }
    }
    return ranks;
}

/** 同一对端点的边数量（用于并列边错开）/ number of edges per endpoint pair (for lanes) */
function countParallelEdges(flow: CanvasFlow): Map<string, number> {
    const counts = new Map<string, number>();
    for (const edge of flow.edges) {
        const key = `${edge.from}->${edge.to}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

/** 单条边的路径与标注位置 / path and label position of one edge */
function routeEdge(
    from: NodeBox,
    to: NodeBox,
    lane: number,
    laneCount: number,
): { path: string; labelX: number; labelY: number } {
    const laneOffset = (lane - (laneCount - 1) / 2) * 18;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    if (to.rank > from.rank && x2 > x1 + 20) {
        const bend = Math.max(48, (x2 - x1) * 0.45);
        const path = `M ${x1} ${y1} C ${x1 + bend} ${y1 + laneOffset}, ${x2 - bend} ${y2 + laneOffset}, ${x2} ${y2}`;
        const point = cubicAt(x1, y1, x1 + bend, y1 + laneOffset, x2 - bend, y2 + laneOffset, x2, y2, 0.5);
        return { path, labelX: point.x, labelY: point.y };
    }
    // 同层/回边：从节点下方绕行，标注放在底部弧线中央
    // Same-rank/back edge: loop below the cards; place the label at the bottom arc.
    const below = Math.max(from.y + from.height, to.y + to.height) + 58 + Math.abs(laneOffset);
    const midX = (x1 + x2) / 2;
    const path = `M ${x1} ${y1} C ${x1 + 70} ${below}, ${x2 - 70} ${below}, ${x2} ${y2}`;
    return { path, labelX: midX, labelY: below };
}

/** 三次贝塞尔取点 / sample a cubic Bézier */
function cubicAt(
    x1: number, y1: number,
    cx1: number, cy1: number,
    cx2: number, cy2: number,
    x2: number, y2: number,
    t: number,
): { x: number; y: number } {
    const u = 1 - t;
    const x = u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2;
    const y = u * u * u * y1 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y2;
    return { x, y };
}
