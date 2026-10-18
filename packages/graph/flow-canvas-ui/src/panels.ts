/**
 * 侧栏与摘要渲染：工具栏、运行摘要、节点详情、事件流与图例。
 * Sidebar and summary rendering: toolbar, run digest, node inspector, event
 * stream and legend. Read-only over state; no requests are made here.
 */

import type {
    CanvasFlow,
    CanvasNodeRuntime,
    CanvasNodeStatusChange,
    CanvasRunSnapshot,
} from '@deepseek-ai/dsh-graph-flow-canvas';
import {
    changeDetail, durationMs, edgeVisual, jsonText, nodeOutput, nodeStateDetail, statusVisual,
    type FlowDescriptor, type NodeStatus,
} from './model.js';
import { runSummary } from './summary.js';
import { nodeSubtitle, type GraphState } from './graph.js';
import { byId, element, formatTime } from './dom.js';

/** 侧栏渲染所需状态 / state needed by the toolbar and side panels */
export interface PanelState extends GraphState {
    descriptors: FlowDescriptor[];
    flowId: string;
    flow: CanvasFlow | null;
    snapshot: CanvasRunSnapshot | null;
    changes: CanvasNodeStatusChange[];
    running: boolean;
    error: string;
    runId: string | null;
}

const STATUS_ORDER: NodeStatus[] = ['pending', 'ready', 'running', 'completed', 'failed', 'skipped', 'cancelled'];

/** 工具栏：选择器与运行按钮 / toolbar: selector and run button */
export function renderToolbar(state: PanelState): void {
    const select = byId<HTMLSelectElement>('flow-select');
    select.disabled = state.running || state.descriptors.length === 0;
    select.value = state.flowId;
    const button = byId<HTMLButtonElement>('run-button');
    button.disabled = state.running || state.loading || state.flow === null;
    button.textContent = state.running ? '运行中… Running' : '运行 Run';
    const meta = byId<HTMLElement>('flow-meta');
    meta.textContent = state.flow
        ? `${state.flow.meta.nodeCount} nodes · ${state.flow.meta.edgeCount} edges · ${Object.keys(state.flow.output).length} outputs`
        : 'loading…';
}

/** 填充下拉框（一次）/ fill the selector (once) */
export function renderFlowSelect(state: PanelState, selected: string): void {
    const select = byId<HTMLSelectElement>('flow-select');
    select.replaceChildren();
    for (const flow of state.descriptors) {
        const option = document.createElement('option');
        option.value = flow.id;
        option.textContent = `${flow.label} · ${flow.nodes} nodes`;
        option.title = flow.note;
        select.append(option);
    }
    select.value = selected;
}

/** 总体摘要条：一眼看到 run 状态与失败位置 / run digest: status and failure at a glance */
export function renderSummary(state: PanelState, live: CanvasRunSnapshot | null): void {
    const summary = runSummary(live);
    const root = byId<HTMLElement>('summary');
    root.className = `summary tone-${summary.tone}`;
    const main = element('div', 'summary-main');
    main.append(
        element('h2', 'summary-title', summary.headline),
        element('p', 'summary-detail', summary.detail),
    );
    root.replaceChildren(main, summaryChips(summary));
    if (state.error) {
        const banner = element('div', 'error-banner');
        banner.setAttribute('role', 'alert');
        banner.append(element('strong', '', '⚠ '), document.createTextNode(state.error));
        root.append(banner);
    }
}

/** 摘要计数 chips / summary count chips */
function summaryChips(summary: ReturnType<typeof runSummary>): HTMLElement {
    const counts = element('div', 'summary-counts');
    const entries = [
        ['completed', summary.counts.completed, 'completed'],
        ['recovered', summary.counts.recovered, 'recovered'],
        ['failed', summary.counts.failed, 'failed'],
        ['skipped', summary.counts.skipped, 'skipped'],
        ['running', summary.counts.running, 'running'],
        ['waiting', summary.counts.pending + summary.counts.ready, 'pending'],
    ] as const;
    for (const [label, value, tone] of entries) {
        if (value === 0) continue;
        const chip = element('span', `count-chip tone-${tone}`);
        chip.append(element('strong', '', String(value)), document.createTextNode(` ${label}`));
        counts.append(chip);
    }
    return counts;
}

/** 详情面板 / the inspector panel */
export function renderInspector(state: PanelState, live: CanvasRunSnapshot | null): void {
    const host = byId<HTMLElement>('inspector');
    const node = state.flow?.nodes.find((candidate) => candidate.id === state.selectedNodeId);
    if (!node) {
        const empty = element('div', 'inspector-empty');
        empty.append(
            element('h3', '', '节点详情 Node inspector'),
            element('p', '', '点一个节点查看状态、错误与 output。 / Click a node to inspect status, errors and output.'),
            element('p', 'contract-note', 'output 读取路径：snapshot.result.nodes[id].output（不是 snapshot.nodes）。'),
        );
        host.replaceChildren(empty);
        return;
    }
    const runtime = live?.nodes[node.id];
    host.replaceChildren(
        inspectorHeader(node, statusVisual(runtime?.status ?? 'pending', runtime?.recovered)),
        inspectorCallout(runtime),
        inspectorOutput(state.snapshot, node.id),
        inspectorFacts(node, runtime),
    );
}

/** 详情头部 / inspector header */
function inspectorHeader(node: CanvasFlow['nodes'][number], visual: ReturnType<typeof statusVisual>): HTMLElement {
    const header = element('div', 'inspector-header');
    const title = element('div', 'inspector-title');
    title.append(
        element('h3', '', node.display.label),
        element('p', 'inspector-subtitle', `${node.id} · ${nodeSubtitle(node)}`),
    );
    header.append(title, element('span', `status-badge tone-${visual.tone}`, `${visual.marker} ${visual.label}`));
    return header;
}

/** 状态与策略字段 / status and policy facts */
function inspectorFacts(node: CanvasFlow['nodes'][number], runtime: CanvasNodeRuntime | undefined): HTMLElement {
    const list = element('dl', 'facts');
    addFact(list, 'status', runtime ? statusVisual(runtime.status, runtime.recovered).label : 'pending');
    const duration = runtime ? durationMs(runtime) : undefined;
    if (duration !== undefined) addFact(list, 'duration', `${duration} ms`);
    addFact(list, 'type', nodeSubtitle(node));
    addFact(list, 'onError', node.onError);
    if (node.retry) {
        const backoff = node.retry.backoffMs === undefined ? '' : ` · ${node.retry.backoffMs} ms backoff`;
        addFact(list, 'retry', `${node.retry.tries} tries${backoff}`);
    }
    if (node.timeout !== undefined) addFact(list, 'timeout', `${node.timeout} ms`);
    if (runtime?.startedAt !== undefined) addFact(list, 'started', formatTime(runtime.startedAt));
    if (runtime?.endedAt !== undefined) addFact(list, 'ended', formatTime(runtime.endedAt));
    return list;
}

/** 错误/兜底/跳过提示 / error, recovered and skip callout */
function inspectorCallout(runtime: CanvasNodeRuntime | undefined): HTMLElement {
    if (!runtime) return element('div', 'callout hidden');
    if (runtime.error) return callout('failed', '失败 Failed', `${runtime.error.code}: ${runtime.error.message}`);
    if (runtime.recovered) return callout('recovered', '失败已兜底 Recovered', `${runtime.recovered.code}: ${runtime.recovered.message}`);
    if (runtime.skipReason) return callout('skipped', '跳过 Skipped', `skipReason: ${runtime.skipReason}`);
    return element('div', 'callout hidden');
}

/** output 面板：唯一读取契约入口 / output panel: the only contract entry */
function inspectorOutput(snapshot: CanvasRunSnapshot | null, nodeId: string): HTMLElement {
    const section = element('section', 'output-section');
    section.append(element('h4', '', '节点 output'));
    const output = nodeOutput(snapshot, nodeId);
    if (output.available) {
        section.append(element('pre', 'json-block', jsonText(output.value)));
    } else {
        section.append(element('p', 'muted', outputReason(output.reason)));
    }
    section.append(element('p', 'contract-note', `source: snapshot.result.nodes["${nodeId}"].output`));
    return section;
}

/** output 不可用原因文案 / copy for an unavailable output */
function outputReason(reason: 'no-run' | 'running' | 'missing-node' | 'no-output'): string {
    switch (reason) {
        case 'no-run':
            return '尚未运行：点「运行」后，结束后才有 output。 / Not run yet; output appears after completion.';
        case 'running':
            return '运行中：output 只在运行结束后写入 snapshot.result。 / Running; output is written to snapshot.result when the run ends.';
        case 'missing-node':
            return 'result.nodes 中没有这个节点。 / This node has no record in result.nodes.';
        case 'no-output':
            return '该节点记录没有 output 键（失败/跳过节点通常如此）。 / No output key on this record (typical for failed/skipped nodes).';
        default:
            return 'output 不可用。 / output unavailable.';
    }
}

/** 事件流面板 / the event stream panel */
export function renderEvents(state: PanelState): void {
    const host = byId<HTMLElement>('events');
    const header = element('div', 'panel-heading');
    header.append(element('h3', '', '状态流 Status stream'));
    if (state.runId) header.append(element('code', 'run-id', state.runId.slice(0, 8)));
    const list = element('ol', 'event-list');
    const changes = [...state.changes].reverse().slice(0, 80);
    if (changes.length === 0) {
        list.append(element('li', 'event-empty', state.running ? '等待节点事件… / waiting for node events…' : '运行后这里会出现逐节点状态迁移。 / Node transitions appear here after a run.'));
    }
    for (const change of changes) list.append(eventRow(change));
    host.replaceChildren(header, list);
}

/** 一行状态迁移 / one transition row */
function eventRow(change: CanvasNodeStatusChange): HTMLElement {
    const visual = statusVisual(change.status, change.recovered);
    const item = element('li', `event tone-${visual.tone}`);
    const time = change.endedAt ?? change.startedAt;
    item.append(element('time', '', time === undefined ? '—' : formatTime(time)));
    item.append(element('span', 'event-node', change.nodeId));
    item.append(element('span', `event-status tone-${visual.tone}`, `${visual.marker} ${visual.label}`));
    const detail = changeDetail(change);
    if (detail) item.append(element('span', 'event-detail', detail));
    return item;
}

/** 图例 / legend */
export function renderLegend(): void {
    const host = byId<HTMLElement>('legend');
    const status = element('div', 'legend-group');
    status.append(element('span', 'legend-title', '状态 status'));
    for (const stateName of STATUS_ORDER) {
        const visual = statusVisual(stateName);
        status.append(element('span', `legend-item tone-${visual.tone}`, `${visual.marker} ${visual.label}`));
    }
    const recovered = statusVisual('completed', { code: 'NODE_FAILED' });
    status.append(element('span', `legend-item tone-${recovered.tone}`, `${recovered.marker} ${recovered.label}`));
    const edges = element('div', 'legend-group');
    edges.append(element('span', 'legend-title', '边 edges'));
    const samples = [
        edgeVisual({ kind: 'port', port: 'error', hasPredicate: false, closedByErrorPort: false, summary: '' }),
        edgeVisual({ kind: 'predicate', hasPredicate: true, closedByErrorPort: false, summary: '' }),
        edgeVisual({ kind: 'error-branch-default', hasPredicate: false, closedByErrorPort: true, summary: '' }),
        edgeVisual({ kind: 'always', hasPredicate: false, closedByErrorPort: false, summary: '' }),
    ];
    for (const sample of samples) {
        edges.append(element('span', `legend-item edge-item tone-${sample.tone}`, sample.label?.replace(/\n/g, ' ') ?? 'always (unlabelled)'));
    }
    host.replaceChildren(status, edges);
}

/** 详情事实项 / one fact row */
function addFact(list: HTMLDListElement, key: string, value: string): void {
    const term = document.createElement('dt');
    term.textContent = key;
    const detail = document.createElement('dd');
    detail.textContent = value;
    list.append(term, detail);
}

/** 提示块 / callout block */
function callout(tone: string, title: string, body: string): HTMLElement {
    const box = element('div', `callout callout-${tone}`);
    box.append(element('strong', '', title), element('p', '', body));
    return box;
}
