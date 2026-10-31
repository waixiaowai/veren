/**
 * 图校验与拓扑排序：重复 id / 悬挂边 / 环检测，全部在 run 之前 fails loud。
 *
 * Graph validation and topological ordering: duplicate ids, dangling edges
 * and cycles are all detected loudly before any run.
 */

import type { GEdge, Graph, GraphNodeRecord } from './types.js';
import { graphError } from './errors.js';

/** 重复节点 id / duplicate node id */
export function assertUniqueNodes(graph: Graph): void {
    const seen = new Set<string>();
    for (const node of graph.nodes) {
        if (seen.has(node.id)) {
            throw graphError('GRAPH_DUPLICATE_NODE', `duplicate node id "${node.id}" in graph "${graph.id}"`, {
                graphId: graph.id,
                nodeId: node.id,
            });
        }
        seen.add(node.id);
    }
}

/** 悬挂边（端点不存在）/ dangling edge (an endpoint does not exist) */
export function assertEdgesAnchored(graph: Graph): void {
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
        for (const endpoint of [edge.from, edge.to]) {
            if (!ids.has(endpoint)) {
                throw graphError(
                    'GRAPH_DANGLING_EDGE',
                    `edge "${edge.from}" -> "${edge.to}" references missing node "${endpoint}"`,
                    { graphId: graph.id, detail: endpoint },
                );
            }
        }
    }
}

/**
 * 发现环：抛 GRAPH_CYCLE_DETECTED（携带环成员）。
 * A cycle exists: throw GRAPH_CYCLE_DETECTED (carrying the cycle members).
 */
function assertAcyclic(graph: Graph, indegree: ReadonlyMap<string, number>, order: readonly string[]): void {
    if (order.length === graph.nodes.length) return;
    const cycle = [...indegree.entries()].filter(([, degree]) => degree > 0).map(([id]) => id);
    throw graphError(
        'GRAPH_CYCLE_DETECTED',
        `graph "${graph.id}" contains a cycle among: ${cycle.join(', ')}`,
        { graphId: graph.id, detail: cycle.join(',') },
    );
}

/**
 * Kahn 拓扑排序；发现环时抛 GRAPH_CYCLE_DETECTED（携带环成员）。
 * Kahn topological sort; throws GRAPH_CYCLE_DETECTED (with the cycle members)
 * when a cycle exists.
 */
export function topoSort(graph: Graph): string[] {
    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const node of graph.nodes) {
        indegree.set(node.id, 0);
        outgoing.set(node.id, []);
    }
    for (const edge of graph.edges) {
        indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
        outgoing.get(edge.from)!.push(edge.to);
    }
    // 队列按入边表顺序稳定出队，保证同层顺序确定 / stable FIFO so same-tier order is deterministic
    const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
    const order: string[] = [];
    for (let head = 0; head < queue.length; head++) {
        const id = queue[head]!;
        order.push(id);
        for (const next of outgoing.get(id)!) {
            const degree = indegree.get(next)! - 1;
            indegree.set(next, degree);
            if (degree === 0) queue.push(next);
        }
    }
    assertAcyclic(graph, indegree, order);
    return order;
}

/** 一次性校验：重复 id → 悬挂边 → 环 / one-shot validation: duplicates → dangling → cycles */
export function validateGraph(graph: Graph): string[] {
    assertUniqueNodes(graph);
    assertEdgesAnchored(graph);
    return topoSort(graph);
}

/** 收集落定为 failed 的节点 / collect nodes that settled as failed */
export function failedIds(records: Record<string, GraphNodeRecord>): string[] {
    return Object.values(records).filter((record) => record.status === 'failed').map((record) => record.id);
}

/** 从失败节点沿边可达的节点集合 / nodes reachable from the failed set along edges */
export function reachableFrom(roots: string[], outgoing: Map<string, GEdge[]>): Set<string> {
    const seen = new Set<string>();
    const queue = [...roots];
    for (let head = 0; head < queue.length; head++) {
        for (const edge of outgoing.get(queue[head]!) ?? []) {
            if (!seen.has(edge.to)) {
                seen.add(edge.to);
                queue.push(edge.to);
            }
        }
    }
    return seen;
}
