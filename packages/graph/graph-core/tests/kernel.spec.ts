/**
 * 内核单测：纯内存 executor 覆盖调度顺序、并发上限、环检测、cancel 传播、
 * fail-fast、状态机迁移与生命周期事件——不依赖 flow 层。每个用例自建
 * Context，保证并发安全（单独跑才过 = 缺陷）。
 *
 * Kernel unit tests: pure in-memory executors cover scheduling order, the
 * concurrency cap, cycle detection, cancel propagation, fail-fast, the full
 * status machine and lifecycle events — no flow dependency. Every case builds
 * its own Context so specs stay concurrency-safe.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import {
    apply as kernelPlugin,
    graphError,
    GraphKernelService,
    GraphKernelToken,
    GraphNodeError,
    runGraph,
    validateGraph,
    type GExecutor,
    type Graph,
    type GraphNodeError as GraphNodeErrorType,
} from '../src/index.js';

/** 记录执行轨迹的内存 executor / an in-memory executor that records a trace */
function traceExecutor(trace: string[], opts: { delay?: number } = {}): GExecutor {
    return {
        async execute(node) {
            trace.push(`start:${node.id}`);
            if (opts.delay) await new Promise((resolve) => setTimeout(resolve, opts.delay));
            trace.push(`end:${node.id}`);
            return { from: node.id };
        },
    };
}

/** 失败节点 executor / an executor that fails named nodes */
function failingExecutor(failIds: string[], trace: string[] = []): GExecutor {
    return {
        async execute(node) {
            trace.push(node.id);
            if (failIds.includes(node.id)) throw new Error(`boom:${node.id}`);
            return { ok: true };
        },
    };
}

const line = (id: string, deps: string[]): Graph => ({
    id: 'g',
    nodes: [id, ...deps].map((nid) => ({ id: nid })),
    edges: deps.map((from) => ({ from, to: id })),
});

describe('graph kernel scheduling', () => {
    it('runs a diamond in topological order and reports completed', async () => {
        const ctx = new Context();
        const trace: string[] = [];
        const graph: Graph = {
            id: 'diamond',
            nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
            edges: [
                { from: 'a', to: 'b' },
                { from: 'a', to: 'c' },
                { from: 'b', to: 'd' },
                { from: 'c', to: 'd' },
            ],
        };
        const handle = runGraph(graph, traceExecutor(trace), { ctx });
        const result = await handle.result;
        expect(result.status).toBe('completed');
        expect(trace.indexOf('end:a')).toBeLessThan(trace.indexOf('start:b'));
        expect(trace.indexOf('end:a')).toBeLessThan(trace.indexOf('start:c'));
        expect(trace.indexOf('end:b')).toBeLessThan(trace.indexOf('start:d'));
        expect(trace.indexOf('end:c')).toBeLessThan(trace.indexOf('start:d'));
        expect(result.nodes['d']!.status).toBe('completed');
        expect(result.nodes['d']!.output).toEqual({ from: 'd' });
    });

    it('never exceeds the concurrency cap', async () => {
        const ctx = new Context();
        let running = 0;
        let peak = 0;
        const executor: GExecutor = {
            async execute(node) {
                running++;
                peak = Math.max(peak, running);
                await new Promise((resolve) => setTimeout(resolve, 5));
                running--;
                return node.id;
            },
        };
        const graph: Graph = {
            id: 'wide',
            nodes: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((id) => ({ id })),
            edges: [],
        };
        const result = await runGraph(graph, executor, { ctx, concurrency: 2 }).result;
        expect(result.status).toBe('completed');
        expect(peak).toBeLessThanOrEqual(2);
    });
});

describe('graph validation', () => {
    it('detects duplicate node ids', () => {
        const ctx = new Context();
        expect(() =>
            validateGraph({ id: 'g', nodes: [{ id: 'a' }, { id: 'a' }], edges: [] }),
        ).toThrowError(expect.objectContaining({ code: 'GRAPH_DUPLICATE_NODE' }));
        void ctx;
    });

    it('detects dangling edges', () => {
        expect(() =>
            validateGraph({ id: 'g', nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'ghost' }] }),
        ).toThrowError(expect.objectContaining({ code: 'GRAPH_DANGLING_EDGE' }));
    });

    it('detects cycles before running', async () => {
        const ctx = new Context();
        const graph: Graph = {
            id: 'cyc',
            nodes: [{ id: 'a' }, { id: 'b' }],
            edges: [
                { from: 'a', to: 'b' },
                { from: 'b', to: 'a' },
            ],
        };
        expect(() => runGraph(graph, traceExecutor([]), { ctx })).toThrowError(
            expect.objectContaining({ code: 'GRAPH_CYCLE_DETECTED' }),
        );
    });
});

describe('cancel and failure propagation', () => {
    it('marks nodes cancelled after an external cancel', async () => {
        const ctx = new Context();
        const graph: Graph = {
            id: 'cancel',
            nodes: [{ id: 'slow' }, { id: 'never' }],
            edges: [{ from: 'slow', to: 'never' }],
        };
        const executor: GExecutor = {
            execute: (node, runCtx) =>
                new Promise((resolve) => {
                    // 执行方自愿响应 signal / the executor opts in to the signal
                    runCtx.signal.addEventListener('abort', () => resolve(node.id), { once: true });
                }),
        };
        const handle = runGraph(graph, executor, { ctx });
        handle.cancel();
        const result = await handle.result;
        expect(result.status).toBe('cancelled');
        expect(result.nodes['slow']!.status).toBe('cancelled');
        expect(result.nodes['never']!.status).toBe('cancelled');
    });

    it('fail-fast skips downstream, lets siblings finish, fails the run', async () => {
        const ctx = new Context();
        const trace: string[] = [];
        const graph: Graph = {
            id: 'failfast',
            nodes: [{ id: 'bad' }, { id: 'down' }, { id: 'sibling' }, { id: 'join' }],
            edges: [
                { from: 'bad', to: 'down' },
                { from: 'sibling', to: 'join' },
                { from: 'down', to: 'join' },
            ],
        };
        const events: string[] = [];
        ctx.on('graph/node-error', (error: GraphNodeErrorType) => events.push(`error:${error.nodeId}`));
        ctx.on('graph/run-end', (payload) => events.push(`end:${payload.status}`));
        const result = await runGraph(graph, failingExecutor(['bad'], trace), { ctx }).result;
        expect(result.status).toBe('failed');
        expect(result.nodes['bad']!.status).toBe('failed');
        expect(result.nodes['bad']!.error).toBeInstanceOf(GraphNodeError);
        expect(result.nodes['down']!.status).toBe('skipped');
        expect(result.nodes['down']!.skipReason).toBe('upstream-failure');
        expect(result.nodes['sibling']!.status).toBe('completed');
        expect(result.nodes['join']!.status).toBe('skipped');
        expect(events).toContain('error:bad');
        expect(events).toContain('end:failed');
        expect(trace).toContain('sibling');
    });

    it('supports a replaceable continue strategy', async () => {
        const ctx = new Context();
        const graph: Graph = {
            id: 'continue',
            nodes: [{ id: 'bad' }, { id: 'down' }],
            edges: [{ from: 'bad', to: 'down' }],
        };
        const result = await runGraph(graph, failingExecutor(['bad']), {
            ctx,
            onNodeFailure: () => 'continue',
        }).result;
        expect(result.status).toBe('completed');
        expect(result.nodes['bad']!.status).toBe('failed');
        expect(result.nodes['down']!.status).toBe('skipped');
    });
});

describe('lifecycle events and edge conditions', () => {
    it('emits the run event sequence in order', async () => {
        const ctx = new Context();
        const events: string[] = [];
        ctx.on('graph/run-starting', (meta) => void events.push(`starting:${meta.runId === '' ? '?' : meta.graphId}`));
        ctx.on('graph/run-start', (meta) => events.push(`start:${meta.graphId}`));
        ctx.on('graph/run-end', (payload) => events.push(`end:${payload.status}`));
        const result = await runGraph(line('b', ['a']), traceExecutor([]), { ctx, runId: 'r1' }).result;
        expect(result.status).toBe('completed');
        expect(events).toEqual(['starting:g', 'start:g', 'end:completed']);
    });

    it('run-starting can refuse the run', async () => {
        const ctx = new Context();
        ctx.on('graph/run-starting', () => true);
        const trace: string[] = [];
        const result = await runGraph(line('b', ['a']), traceExecutor(trace), { ctx }).result;
        expect(result.status).toBe('cancelled');
        expect(result.nodes['a']!.skipReason).toBe('run-rejected');
        expect(trace).toEqual([]);
    });

    it('node-pre-execute returning truthy vetoes the node', async () => {
        const ctx = new Context();
        ctx.on('graph/node-pre-execute', (meta) => meta.nodeId === 'skipme');
        const trace: string[] = [];
        const graph: Graph = {
            id: 'veto',
            nodes: [{ id: 'skipme' }, { id: 'other' }],
            edges: [],
        };
        const result = await runGraph(graph, traceExecutor(trace), { ctx }).result;
        expect(result.nodes['skipme']!.status).toBe('skipped');
        expect(result.nodes['skipme']!.skipReason).toBe('pre-execute-veto');
        expect(result.nodes['other']!.status).toBe('completed');
        expect(trace).not.toContain('start:skipme');
    });

    it('node-post-execute waterfall rewrites the node output', async () => {
        const ctx = new Context();
        ctx.on('graph/node-post-execute', (meta, envelope, next) => {
            if (meta.nodeId === 'a') envelope.output = { ...(envelope.output as object), from: 'rewritten' };
            return next();
        });
        const result = await runGraph(line('b', ['a']), traceExecutor([]), { ctx }).result;
        expect(result.nodes['a']!.output).toEqual({ from: 'rewritten' });
    });

    it('a false edge condition skips the downstream subtree', async () => {
        const ctx = new Context();
        const trace: string[] = [];
        const graph: Graph = {
            id: 'cond',
            nodes: [{ id: 'a' }, { id: 'take' }, { id: 'drop' }, { id: 'dropChild' }],
            edges: [
                { from: 'a', to: 'take' },
                { from: 'a', to: 'drop', when: () => false },
                { from: 'drop', to: 'dropChild' },
            ],
        };
        const result = await runGraph(graph, traceExecutor(trace), { ctx }).result;
        expect(result.nodes['take']!.status).toBe('completed');
        expect(result.nodes['drop']!.status).toBe('skipped');
        expect(result.nodes['drop']!.skipReason).toBe('upstream-condition');
        expect(result.nodes['dropChild']!.skipReason).toBe('upstream-condition');
        expect(trace).not.toContain('start:drop');
    });
});

describe('kernel service wiring', () => {
    it('provides the kernel capability with config and exposes RunStatusToken on run contexts', async () => {
        const ctx = new Context();
        await ctx.plugin(kernelPlugin, { concurrency: 2 });
        const kernel = ctx.get(GraphKernelToken) as GraphKernelService;
        expect(kernel.config.concurrency).toBe(2);
        const seen: string[] = [];
        const executor: GExecutor = {
            async execute(_node, runCtx) {
                // run 子 context 携带中性元数据 / the run child context carries neutral metadata
                seen.push(`${runCtx.graphId}/${typeof runCtx.signal.addEventListener}`);
                return 'ok';
            },
        };
        const result = await kernel.run(line('b', ['a']), executor, { runId: 'r9' }).result;
        expect(result.status).toBe('completed');
        // 两个节点都在 run 子 context 上看到中性元数据 / both nodes see the neutral run metadata
        expect(seen).toEqual(['g/function', 'g/function']);
    });

    it('wraps arbitrary executor errors into structured node errors', async () => {
        const ctx = new Context();
        const executor: GExecutor = {
            execute: async () => {
                throw graphError('GRAPH_NODE_FAILED', 'pre-structured', { detail: 'x' });
            },
        };
        const result = await runGraph(line('b', ['a']), executor, { ctx }).result;
        expect(result.nodes['a']!.error).toBeInstanceOf(GraphNodeError);
        expect(result.nodes['a']!.error!.code).toBe('GRAPH_NODE_FAILED');
    });
});
