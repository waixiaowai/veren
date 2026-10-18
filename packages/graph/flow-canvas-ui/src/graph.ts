/**
 * 图画布渲染：分层布局结果 → SVG 边与节点卡片。只读状态，不发请求。
 * Graph rendering: layered layout → SVG edges and node cards. Read-only over
 * state; no requests are made here.
 */

import type { CanvasFlow, CanvasNodeRuntime, CanvasRunSnapshot } from '@deepseek-ai/dsh-graph-flow-canvas';
import { durationMs, nodeStateDetail, statusVisual } from './model.js';
import type { EdgeRoute, FlowLayout, NodeBox } from './layout.js';
import { byId, element, svgElement, truncate } from './dom.js';

/** 图渲染所需状态 / state needed to render the graph */
export interface GraphState {
    flow: CanvasFlow | null;
    layout: FlowLayout | null;
    selectedNodeId: string | null;
    loading: boolean;
}

/** 画布：SVG 边 + 节点卡片 / canvas: SVG edges + node cards */
export function renderCanvas(state: GraphState, live: CanvasRunSnapshot | null): void {
    const host = byId<HTMLElement>('canvas');
    const layout = state.layout;
    const flow = state.flow;
    if (!layout || !flow) {
        host.replaceChildren(element('div', 'canvas-empty', state.loading ? '加载中… Loading…' : '没有可显示的 flow / no flow'));
        return;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
    svg.setAttribute('class', 'flow-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `flow ${flow.flowId}: ${flow.meta.nodeCount} nodes, ${flow.meta.edgeCount} edges`);
    svg.append(buildDefs());
    const edgeLayer = svgElement('g', { class: 'edge-layer' });
    for (const edge of layout.edges) edgeLayer.append(renderEdge(edge));
    svg.append(edgeLayer);
    const nodeLayer = svgElement('g', { class: 'node-layer' });
    for (const id of layout.order) {
        const node = flow.nodes.find((candidate) => candidate.id === id);
        const box = layout.nodes[id];
        if (!node || !box) continue;
        nodeLayer.append(renderNode(node, box, live?.nodes[id], state.selectedNodeId === id));
    }
    svg.append(nodeLayer);
    host.replaceChildren(svg);
}

/** 箭头 marker 定义（按条件色板）/ arrow marker defs (one per edge palette) */
function buildDefs(): SVGElement {
    const defs = svgElement('defs');
    for (const tone of ['always', 'port', 'predicate', 'error-branch-default'] as const) {
        const marker = svgElement('marker', {
            id: `arrow-${tone}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto',
        });
        marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: `arrowhead tone-${tone}` }));
        defs.append(marker);
    }
    return defs;
}

/** 一条边 / one edge */
function renderEdge(edge: EdgeRoute): SVGElement {
    const group = svgElement('g', { class: `edge tone-${edge.tone}${edge.dashed ? ' dashed' : ''}` });
    const title = svgElement('title');
    title.textContent = `${edge.from} → ${edge.to}: ${edge.title}`;
    group.append(title);
    group.append(svgElement('path', { d: edge.path, class: 'edge-path', 'marker-end': `url(#arrow-${edge.tone})` }));
    if (edge.label) group.append(renderEdgeLabel(edge));
    return group;
}

/** 多行条件标注 / multi-line condition label */
function renderEdgeLabel(edge: EdgeRoute): SVGElement {
    const lines = edge.label?.split('\n') ?? [];
    const width = Math.max(...lines.map((line) => line.length)) * 6.2 + 18;
    const lineHeight = 13;
    const height = lines.length * lineHeight + 6;
    const group = svgElement('g');
    group.append(svgElement('rect', {
        x: edge.labelX - width / 2, y: edge.labelY - height / 2, width, height, rx: 8, class: 'edge-label-bg',
    }));
    const text = svgElement('text', {
        x: edge.labelX, y: edge.labelY - ((lines.length - 1) * lineHeight) / 2, class: 'edge-label-text',
    });
    lines.forEach((line, index) => {
        const tspan = svgElement('tspan', { x: edge.labelX, dy: index === 0 ? 0 : lineHeight });
        tspan.textContent = line;
        text.append(tspan);
    });
    group.append(text);
    return group;
}

/** 一个节点卡片 / one node card */
function renderNode(
    node: CanvasFlow['nodes'][number],
    box: NodeBox,
    runtime: CanvasNodeRuntime | undefined,
    selected: boolean,
): SVGElement {
    const status = runtime?.status ?? 'pending';
    const visual = statusVisual(status, runtime?.recovered);
    const group = svgElement('g', {
        class: `node tone-${visual.tone}${selected ? ' is-selected' : ''}`,
        transform: `translate(${box.x}, ${box.y})`,
        'data-node-id': node.id,
        tabindex: 0,
        role: 'button',
        'aria-label': `${node.display.label}, ${node.type}, ${visual.label}`,
        'aria-pressed': selected ? 'true' : 'false',
    });
    const title = svgElement('title');
    title.textContent = `${node.id} · ${node.display.label} · ${node.display.subtitle} · ${visual.label}`;
    group.append(title);
    group.append(svgElement('rect', { width: box.width, height: box.height, rx: 12, class: 'node-card' }));
    group.append(svgElement('rect', { x: 0, y: 10, width: 5, height: box.height - 20, rx: 2.5, class: 'node-stripe' }));
    group.append(svgText(16, 22, 'node-type', nodeSubtitle(node)));
    group.append(svgText(16, 47, 'node-label', truncate(node.display.label, 26)));
    group.append(svgText(17, 71, 'node-marker', visual.marker));
    group.append(svgText(34, 71, 'node-status', visual.label));
    const detail = nodeStateDetail(runtime) ?? durationText(runtime);
    if (detail) group.append(svgText(16, 90, 'node-detail', truncate(detail, 30)));
    return group;
}

/** SVG 文本行 / one SVG text line */
function svgText(x: number, y: number, className: string, text: string): SVGTextElement {
    const node = svgElement('text', { x, y, class: className });
    node.textContent = text;
    return node;
}

/** 节点副标题：type@version · onError / node subtitle: type@version · onError */
export function nodeSubtitle(node: CanvasFlow['nodes'][number]): string {
    const version = node.version === undefined ? '' : `@${node.version}`;
    const policy = node.onError === 'failFast' ? '' : ` · ${node.onError}`;
    return `${node.type}${version}${policy}`;
}

/** 展示：耗时文字 / display: duration text */
function durationText(runtime: CanvasNodeRuntime | undefined): string | undefined {
    if (!runtime) return undefined;
    const duration = durationMs(runtime);
    return duration === undefined ? undefined : `${duration} ms`;
}
