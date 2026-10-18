/**
 * 浏览器控制层：状态、加载、运行与 SSE。DOM 渲染委托给 graph.ts / panels.ts。
 * Browser control layer: state, loading, runs and SSE. DOM rendering is
 * delegated to graph.ts / panels.ts.
 */

import type { CanvasFlow, CanvasNodeStatusChange, CanvasRunSnapshot } from '@deepseek-ai/dsh-graph-flow-canvas';
import {
    withLiveChanges, type FlowDescriptor, type RunStateMessage, type StartRunResponse,
} from './model.js';
import { layoutFlow } from './layout.js';
import { byId } from './dom.js';
import { renderCanvas } from './graph.js';
import {
    renderEvents, renderFlowSelect, renderInspector, renderLegend, renderSummary, renderToolbar,
    type PanelState,
} from './panels.js';

/** 页面状态 / page state */
interface UiState extends PanelState {
    stream: EventSource | null;
}

const state: UiState = {
    descriptors: [],
    flowId: '',
    flow: null,
    layout: null,
    snapshot: null,
    changes: [],
    selectedNodeId: null,
    running: false,
    loading: true,
    error: '',
    stream: null,
    runId: null,
};

/** 启动页面 / boot the page */
async function main(): Promise<void> {
    bindShellEvents();
    renderLegend();
    try {
        const response = await fetch('/api/flows');
        if (!response.ok) throw new Error(await errorText(response));
        const payload = await response.json() as { flows: FlowDescriptor[] };
        state.descriptors = payload.flows;
        if (state.descriptors.length === 0) throw new Error('no flows are registered');
        const requested = new URLSearchParams(location.search).get('flow');
        const chosen = state.descriptors.find((flow) => flow.id === requested) ?? state.descriptors[0]!;
        renderFlowSelect(state, chosen.id);
        await loadFlow(chosen.id);
    } catch (error) {
        state.error = messageOf(error);
        state.loading = false;
        renderAll();
    }
}

/** 绑定只绑一次的壳层事件 / bind shell events once */
function bindShellEvents(): void {
    byId<HTMLSelectElement>('flow-select').addEventListener('change', (event) => {
        if (state.running) return;
        void loadFlow((event.target as HTMLSelectElement).value).catch(showError);
    });
    byId<HTMLButtonElement>('run-button').addEventListener('click', () => { void startRun(); });
    const canvas = byId<HTMLElement>('canvas');
    canvas.addEventListener('click', selectNodeFromEvent);
    canvas.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectNodeFromEvent(event);
        }
    });
}

/** 从节点卡片事件里选中节点 / select a node from a card event */
function selectNodeFromEvent(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-node-id]') : null;
    if (!target) return;
    const nodeId = target.dataset.nodeId ?? null;
    state.selectedNodeId = state.selectedNodeId === nodeId ? null : nodeId;
    renderAll();
}

/** 加载一个 flow 的静态投影 / load one flow's static projection */
async function loadFlow(flowId: string): Promise<void> {
    closeStream();
    state.flowId = flowId;
    state.flow = null;
    state.layout = null;
    state.snapshot = null;
    state.changes = [];
    state.selectedNodeId = null;
    state.running = false;
    state.loading = true;
    state.error = '';
    state.runId = null;
    renderAll();
    const response = await fetch(`/api/flows/${encodeURIComponent(flowId)}`);
    if (!response.ok) throw new Error(await errorText(response));
    const flow = await response.json() as CanvasFlow;
    state.flow = flow;
    state.layout = layoutFlow(flow);
    state.loading = false;
    const url = new URL(location.href);
    url.searchParams.set('flow', flowId);
    history.replaceState(null, '', url);
    renderAll();
}

/** 点「运行」：启动一次真实运行并打开 SSE / press Run: start a real run and open SSE */
async function startRun(): Promise<void> {
    if (state.running || state.flow === null) return;
    closeStream();
    state.snapshot = null;
    state.changes = [];
    state.selectedNodeId = null;
    state.error = '';
    state.running = true;
    state.runId = null;
    renderAll();
    try {
        const response = await fetch('/api/runs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ flowId: state.flowId }),
        });
        if (!response.ok) throw new Error(await errorText(response));
        const payload = await response.json() as StartRunResponse;
        state.runId = payload.runId;
        openStream(payload.runId);
    } catch (error) {
        state.running = false;
        showError(error);
    }
}

/** 打开一次运行的状态流 / open one run's status stream */
function openStream(runId: string): void {
    const stream = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    state.stream = stream;
    stream.addEventListener('state', (event) => applyRunState(parseEvent<RunStateMessage>(event)));
    stream.addEventListener('node', (event) => {
        const change = parseEvent<CanvasNodeStatusChange>(event);
        state.changes = [...state.changes, change].slice(-200);
        renderAll();
    });
    stream.addEventListener('finished', (event) => {
        applyRunState(parseEvent<RunStateMessage>(event));
        closeStream();
        state.running = false;
        renderAll();
    });
    stream.onerror = () => {
        if (!state.running) return;
        state.error = '状态流连接中断，浏览器会自动重连… / stream interrupted, reconnecting…';
        renderAll();
    };
}

/** 应用一次完整状态（连接时、结束时）/ apply a full state (on attach, on finish) */
function applyRunState(message: RunStateMessage): void {
    state.snapshot = message.snapshot;
    state.changes = message.changes;
    state.running = !message.finished;
    state.loading = false;
    state.error = '';
    if (message.finished) closeStream();
    renderAll();
}

/** 关闭 SSE（幂等）/ close SSE (idempotent) */
function closeStream(): void {
    if (!state.stream) return;
    state.stream.close();
    state.stream = null;
}

/** 当前实时快照：在快照副本上叠加增量 / live snapshot: overlay deltas on a copy */
function liveSnapshot(): CanvasRunSnapshot | null {
    return withLiveChanges(state.snapshot, state.changes);
}

/** 整体重绘 / redraw everything */
function renderAll(): void {
    const live = liveSnapshot();
    renderToolbar(state);
    renderSummary(state, live);
    renderCanvas(state, live);
    renderInspector(state, live);
    renderEvents(state);
}

/** 显示错误 / show an error */
function showError(error: unknown): void {
    state.error = messageOf(error);
    state.loading = false;
    renderAll();
}

/** 错误文案 / error text */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** fetch 错误文本 / fetch error text */
async function errorText(response: Response): Promise<string> {
    try {
        const payload = await response.json() as { error?: unknown };
        return typeof payload.error === 'string' ? payload.error : `${response.status} ${response.statusText}`;
    } catch {
        return `${response.status} ${response.statusText}`;
    }
}

/** 解析 SSE JSON / parse SSE JSON */
function parseEvent<T>(event: Event): T {
    return JSON.parse((event as MessageEvent<string>).data) as T;
}

void main();
