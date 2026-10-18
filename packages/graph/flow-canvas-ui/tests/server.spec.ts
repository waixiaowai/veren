/**
 * 真实组合的 HTTP 测试：启动本地画布服务，走真实 Loader/引擎/画布数据面，
 * 验证静态投影、一次完整运行的终态、SSE 状态流与 output 契约。
 *
 * Real-composition HTTP tests: start the local canvas server over the real
 * Loader/engine/canvas data plane and verify the static projection, one full
 * run's final state, the SSE stream and the output contract.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CanvasFlow, CanvasRunSnapshot, CanvasNodeStatusChange } from '@deepseek-ai/dsh-graph-flow-canvas';
import { createFlowCanvasServer, type FlowCanvasUiServer } from '../src/server.js';
import { nodeOutput, type FlowDescriptor, type RunStateMessage } from '../src/model.js';

let server: FlowCanvasUiServer;

beforeAll(async () => {
    server = await createFlowCanvasServer({ port: 0 });
});

afterAll(async () => {
    await server.close();
});

/** 拼 API URL / join an API URL */
function api(path: string): string {
    return new URL(path, server.url).toString();
}

/** 轮询一次运行直到 finished / poll a run until it finishes */
async function waitForRun(runId: string): Promise<RunStateMessage> {
    for (let attempt = 0; attempt < 250; attempt++) {
        const response = await fetch(api(`/api/runs/${encodeURIComponent(runId)}`));
        expect(response.status).toBe(200);
        const state = await response.json() as RunStateMessage;
        if (state.finished) return state;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`run ${runId} did not finish`);
}

/** 启动一次运行 / start one run */
async function startRun(flowId: string): Promise<string> {
    const response = await fetch(api('/api/runs'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flowId }),
    });
    expect(response.status).toBe(201);
    const payload = await response.json() as { runId: string; flowId: string };
    expect(payload.flowId).toBe(flowId);
    return payload.runId;
}

/** 读取 SSE 直到 finished / read SSE until finished */
async function readSseUntilFinished(runId: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(api(`/api/runs/${encodeURIComponent(runId)}/events`), { signal: controller.signal });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/event-stream');
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let text = '';
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            if (text.includes('event: finished')) {
                await reader.cancel();
                break;
            }
        }
        return text;
    } finally {
        clearTimeout(timer);
    }
}

describe('flow-canvas-ui server', () => {
    it('lists the canonical demo and its paced twin', async () => {
        const response = await fetch(api('/api/flows'));
        expect(response.status).toBe(200);
        const payload = await response.json() as { flows: FlowDescriptor[] };
        expect(payload.flows.map((flow) => flow.id)).toContain('canvas-demo');
        expect(payload.flows.map((flow) => flow.id)).toContain('canvas-demo-pacing');
        expect(payload.flows.map((flow) => flow.id)).toContain('canvas-demo-predicate');
        const canonical = payload.flows.find((flow) => flow.id === 'canvas-demo')!;
        expect(canonical.nodes).toBe(6);
        expect(canonical.edges).toBe(5);
        expect(canonical.note).toContain('examples/demo.flow.yaml');
    });

    it('projects the canonical flow with all three edge flavours', async () => {
        const response = await fetch(api('/api/flows/canvas-demo'));
        expect(response.status).toBe(200);
        const flow = await response.json() as CanvasFlow;
        expect(flow.nodes.map((node) => node.id)).toEqual(['start', 'gate', 'recover', 'normal', 'fatal', 'join']);
        const errorEdge = flow.edges.find((edge) => edge.id === 'gate:error->recover')!;
        expect(errorEdge.condition).toMatchObject({ kind: 'port', port: 'error' });
        const defaultEdge = flow.edges.find((edge) => edge.id === 'gate:out->normal')!;
        expect(defaultEdge.condition).toMatchObject({ kind: 'error-branch-default', closedByErrorPort: true });
        expect(flow.layout).toEqual({ viewport: null, nodes: {}, edges: {} });
    });

    it('projects a predicate edge for the predicate demo', async () => {
        const response = await fetch(api('/api/flows/canvas-demo-predicate'));
        expect(response.status).toBe(200);
        const flow = await response.json() as CanvasFlow;
        const predicateEdge = flow.edges.find((edge) => edge.id === 'recover:out->fatal')!;
        expect(predicateEdge.condition).toMatchObject({ kind: 'predicate', hasPredicate: true });
    });

    it('runs the demo and reports failed, skipped and recovered nodes without a refresh', async () => {
        const runId = await startRun('canvas-demo');
        const state = await waitForRun(runId);
        const snapshot: CanvasRunSnapshot = state.snapshot;
        expect(snapshot.status).toBe('failed');
        expect(snapshot.nodes.start!.status).toBe('completed');
        expect(snapshot.nodes.gate).toMatchObject({
            status: 'completed',
            recovered: { code: 'NODE_FAILED' },
        });
        expect(snapshot.nodes.recover!.status).toBe('completed');
        expect(snapshot.nodes.normal).toMatchObject({ status: 'skipped', skipReason: 'upstream-condition' });
        expect(snapshot.nodes.fatal).toMatchObject({ status: 'failed', error: { code: 'NODE_FAILED' } });
        expect(snapshot.nodes.join).toMatchObject({ status: 'skipped', skipReason: 'upstream-failure' });
        expect(snapshot.result?.status).toBe('failed');
        expect(state.changes.some((change: CanvasNodeStatusChange) => change.nodeId === 'normal' && change.status === 'skipped')).toBe(true);
        expect(state.changes.some((change: CanvasNodeStatusChange) => change.nodeId === 'fatal' && change.status === 'failed')).toBe(true);
    });

    it('keeps output on result.nodes, not on the canvas runtime', async () => {
        const runId = await startRun('canvas-demo');
        const state = await waitForRun(runId);
        const snapshot = state.snapshot;
        // 契约：canvas runtime 没有 output / contract: the canvas runtime has no output
        expect('output' in snapshot.nodes.gate!).toBe(false);
        expect('output' in snapshot.nodes.recover!).toBe(false);
        // result.nodes 才有 output / only result.nodes carries output
        expect('output' in snapshot.result!.nodes.gate!).toBe(true);
        expect('output' in snapshot.result!.nodes.recover!).toBe(true);
        const output = nodeOutput(snapshot, 'recover');
        expect(output.available).toBe(true);
        if (output.available) expect(output.value).toMatchObject({ message: 'RECOVERED' });
        expect(nodeOutput(snapshot, 'normal')).toEqual({ available: false, reason: 'no-output' });
    });

    it('streams the paced run over SSE, including node transitions', async () => {
        const runId = await startRun('canvas-demo-pacing');
        const text = await readSseUntilFinished(runId);
        expect(text).toContain('event: state');
        expect(text).toContain('event: node');
        expect(text).toContain('event: finished');
        const finishedPayload = /event: finished\ndata: (.+)\n/.exec(text)?.[1];
        expect(finishedPayload).toBeDefined();
        const finished = JSON.parse(finishedPayload!) as RunStateMessage;
        expect(finished.finished).toBe(true);
        expect(finished.snapshot.status).toBe('failed');
        expect(finished.snapshot.nodes.gate?.recovered?.code).toBe('NODE_FAILED');
    });

    it('reports unknown flows and runs with stable codes', async () => {
        const flow = await fetch(api('/api/flows/not-there'));
        expect(flow.status).toBe(404);
        expect(await flow.json()).toMatchObject({ code: 'FLOW_NOT_FOUND' });
        const run = await fetch(api('/api/runs/not-there'));
        expect(run.status).toBe(404);
        expect(await run.json()).toMatchObject({ code: 'RUN_NOT_FOUND' });
    });
});
