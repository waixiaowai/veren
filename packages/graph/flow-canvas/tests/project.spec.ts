/**
 * 静态投影测试：节点展示字段、边的端口/谓词条件、布局槽位、JSON 稳定性。
 * 每个用例只读 FlowDefinition，不依赖引擎。
 *
 * Static projection tests: node display fields, port/predicate edge
 * conditions, layout slots and JSON stability. Cases are read-only over a
 * FlowDefinition and need no engine.
 */

import { describe, expect, it } from 'vitest';
import type { FlowDefinition, FlowId, NodeId, SlotRef } from '@deepseek-ai/dsh-graph-flow-api';
import { CanvasError, projectFlow } from '../src/index.js';

/** 带三种边条件的测试 flow / a test flow with all three edge condition kinds */
function sampleFlow(): FlowDefinition {
    return {
        id: 'canvas-spec' as FlowId,
        output: { result: '${sink.v}' as SlotRef },
        nodes: [
            {
                id: 'src' as NodeId,
                type: 'echo',
                config: { message: 'hi', label: 'Source' },
                retry: { tries: 2, backoffMs: 5 },
                timeout: 1000,
            },
            { id: 'sink' as NodeId, type: 'noop', input: { v: '${src.message}' as SlotRef } },
            { id: 'side' as NodeId, type: 'noop', onError: 'fallback', fallbackValue: { safe: true } },
        ],
        edges: [
            { from: 'src' as NodeId, to: 'sink' as NodeId },
            { from: 'src' as NodeId, to: 'side' as NodeId, port: 'error' },
            { from: 'src' as NodeId, to: 'side' as NodeId, when: () => false },
        ],
    };
}

describe('canvas static projection', () => {
    it('projects nodes, edges, conditions and empty layout slots as stable JSON', () => {
        const canvas = projectFlow(sampleFlow());
        expect(canvas.schemaVersion).toBe(1);
        expect(canvas.flowId).toBe('canvas-spec');
        expect(canvas.meta).toEqual({ nodeCount: 3, edgeCount: 3 });
        expect(canvas.output).toEqual({ result: '${sink.v}' });
        expect(canvas.hasInputSchema).toBe(false);

        const source = canvas.nodes.find((node) => node.id === 'src')!;
        expect(source.display).toEqual({ label: 'Source', subtitle: 'echo' });
        expect(source.config).toEqual({ message: 'hi', label: 'Source' });
        expect(source.retry).toEqual({ tries: 2, backoffMs: 5 });
        expect(source.timeout).toBe(1000);
        expect(source.layout).toBeNull();

        const sink = canvas.nodes.find((node) => node.id === 'sink')!;
        expect(sink.display.label).toBe('sink');
        expect(sink.input).toEqual({ v: '${src.message}' });
        expect(sink.onError).toBe('failFast');

        // 布局容器存在但为空：坐标只能由调用方填 / layout container exists but is empty
        expect(canvas.layout).toEqual({ viewport: null, nodes: {}, edges: {} });
        expect(canvas.nodes.every((node) => node.layout === null)).toBe(true);
        expect(canvas.edges.every((edge) => edge.layout === null)).toBe(true);

        // 可序列化并且往返不变 / serializable and stable across a JSON round-trip
        const roundTrip = JSON.parse(JSON.stringify(canvas));
        expect(roundTrip).toEqual(canvas);
        expect(JSON.stringify(canvas)).not.toContain('function');
    });

    it('shows the effective condition: port first, predicate second, always last', () => {
        const canvas = projectFlow(sampleFlow());
        const always = canvas.edges.find((edge) => edge.id === 'src:out->sink')!;
        const port = canvas.edges.find((edge) => edge.port === 'error')!;
        const predicate = canvas.edges.find((edge) => edge.condition.kind === 'predicate')!;

        expect(always.condition).toEqual({ kind: 'always', hasPredicate: false, closedByErrorPort: false, summary: 'always' });
        expect(port.condition.kind).toBe('port');
        expect(port.condition.port).toBe('error');
        expect(port.condition.summary).toContain('port "error"');
        expect(predicate.condition).toMatchObject({ kind: 'predicate', hasPredicate: true });
        // 谓词函数不进 JSON / the predicate function never enters the projection
        expect(predicate.condition.summary).toBe('declared predicate');
    });

    it('marks the default output of an errorBranch node as closing on the error port', () => {
        const flow: FlowDefinition = {
            id: 'error-branch-spec' as FlowId,
            nodes: [
                { id: 'gate' as NodeId, type: 'fail', onError: 'errorBranch' },
                { id: 'normal' as NodeId, type: 'noop' },
            ],
            edges: [
                { from: 'gate' as NodeId, to: 'normal' as NodeId },
                { from: 'gate' as NodeId, to: 'normal' as NodeId, port: 'error' },
            ],
        };
        const canvas = projectFlow(flow);
        const fallback = canvas.edges.find((edge) => edge.id === 'gate:out->normal')!;
        const errorPort = canvas.edges.find((edge) => edge.id === 'gate:error->normal')!;
        expect(fallback.condition.kind).toBe('error-branch-default');
        expect(fallback.condition.summary).toContain('closed when the error port is active');
        expect(errorPort.condition).toMatchObject({ kind: 'port', port: 'error' });
    });

    it('keeps errorBranch default semantics when a predicate is also declared', () => {
        const flow: FlowDefinition = {
            id: 'error-branch-predicate' as FlowId,
            nodes: [
                { id: 'gate' as NodeId, type: 'fail', onError: 'errorBranch' },
                { id: 'target' as NodeId, type: 'noop' },
            ],
            edges: [{ from: 'gate' as NodeId, to: 'target' as NodeId, when: () => true }],
        };
        const canvas = projectFlow(flow);
        const condition = canvas.edges[0]!.condition;
        expect(condition).toMatchObject({
            kind: 'error-branch-default',
            hasPredicate: true,
            closedByErrorPort: true,
        });
        expect(condition.summary).toContain('predicate');
        // 序列化往返后仍必须认出这是 errorBranch 默认边 + 谓词
        // A JSON round-trip must still identify the errorBranch default edge plus predicate.
        const roundTrip = JSON.parse(JSON.stringify(canvas));
        expect(roundTrip.edges[0].condition).toEqual(condition);
    });

    it('keeps duplicate edge ids unique and deterministic', () => {
        const flow = sampleFlow();
        flow.edges.push({ from: 'src' as NodeId, to: 'sink' as NodeId });
        const canvas = projectFlow(flow);
        const ids = canvas.edges.map((edge) => edge.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain('src:out->sink');
        expect(ids).toContain('src:out->sink~1');
    });

    it('fails loud on non-JSON config instead of dropping it silently', () => {
        const flow = sampleFlow();
        (flow.nodes[0] as { config: unknown }).config = { callback: () => true };
        expect(() => projectFlow(flow)).toThrowError(
            expect.objectContaining({ code: 'CANVAS_NOT_SERIALIZABLE' }),
        );
    });

    it('fails loud on dangling edges', () => {
        const flow = sampleFlow();
        flow.edges.push({ from: 'ghost' as NodeId, to: 'sink' as NodeId });
        expect(() => projectFlow(flow)).toThrowError(CanvasError);
        expect(() => projectFlow(flow)).toThrowError(
            expect.objectContaining({ code: 'CANVAS_FLOW_INVALID' }),
        );
    });
});
