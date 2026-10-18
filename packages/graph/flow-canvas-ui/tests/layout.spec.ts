/**
 * 自动布局测试：分层顺序、同层对齐、节点不重叠、条件边标注位置与确定性。
 * Auto-layout tests: layer order, same-layer alignment, non-overlapping cards,
 * label positions and determinism.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasFlow, CanvasNode } from '@deepseek-ai/dsh-graph-flow-canvas';
import { layoutFlow, NODE_HEIGHT, NODE_WIDTH } from '../src/layout.js';

/** 演示 flow 的静态投影夹具（与 examples/demo.flow.yaml 同构）/
    static projection fixture matching examples/demo.flow.yaml */
function demoFlow(): CanvasFlow {
    const node = (id: string, type: string, onError: 'failFast' | 'errorBranch' = 'failFast'): CanvasNode => ({
        id: id as never,
        type,
        display: { label: id, subtitle: type },
        onError,
        layout: null,
    });
    const edge = (from: string, to: string, condition: CanvasEdge['condition'], port?: string): CanvasEdge => ({
        id: port ? `${from}:${port}->${to}` : `${from}:out->${to}`,
        from: from as never,
        to: to as never,
        port,
        condition,
        layout: null,
    });
    const always = { kind: 'always', hasPredicate: false, closedByErrorPort: false, summary: 'always' } as const;
    return {
        schemaVersion: 1,
        flowId: 'canvas-demo' as never,
        nodes: [
            node('start', 'noop'),
            node('gate', 'fail', 'errorBranch'),
            node('recover', 'echo'),
            node('normal', 'echo'),
            node('fatal', 'fail'),
            node('join', 'noop'),
        ],
        edges: [
            edge('start', 'gate', always),
            edge('gate', 'recover', { kind: 'port', port: 'error', hasPredicate: false, closedByErrorPort: false, summary: 'port "error"' }, 'error'),
            edge('gate', 'normal', { kind: 'error-branch-default', hasPredicate: false, closedByErrorPort: true, summary: 'default' }),
            edge('recover', 'fatal', always),
            edge('fatal', 'join', always),
        ],
        output: { recovered: 'recover.message' },
        hasInputSchema: false,
        layout: { viewport: null, nodes: {}, edges: {} },
        meta: { nodeCount: 6, edgeCount: 5 },
    } as CanvasFlow;
}

describe('layoutFlow', () => {
    it('lays the demo flow left-to-right in dependency order', () => {
        const layout = layoutFlow(demoFlow());
        expect(layout.order).toEqual(['start', 'gate', 'recover', 'normal', 'fatal', 'join']);
        expect(layout.nodes.start!.rank).toBe(0);
        expect(layout.nodes.gate!.rank).toBe(1);
        expect(layout.nodes.recover!.rank).toBe(2);
        expect(layout.nodes.normal!.rank).toBe(2);
        expect(layout.nodes.fatal!.rank).toBe(3);
        expect(layout.nodes.join!.rank).toBe(4);
        expect(layout.nodes.recover!.x).toBe(layout.nodes.normal!.x);
        expect(layout.nodes.start!.x).toBeLessThan(layout.nodes.gate!.x);
        expect(layout.nodes.gate!.x).toBeLessThan(layout.nodes.recover!.x);
        expect(layout.nodes.fatal!.y).toBeGreaterThan(layout.nodes.start!.y - NODE_HEIGHT);
        expect(layout.width).toBeGreaterThan(0);
        expect(layout.height).toBeGreaterThan(0);
    });

    it('never overlaps two node cards', () => {
        const layout = layoutFlow(demoFlow());
        const boxes = Object.values(layout.nodes);
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i]!;
                const b = boxes[j]!;
                const overlap = a.x < b.x + NODE_WIDTH && b.x < a.x + NODE_WIDTH
                    && a.y < b.y + NODE_HEIGHT && b.y < a.y + NODE_HEIGHT;
                expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
            }
        }
    });

    it('routes and labels every conditional edge', () => {
        const layout = layoutFlow(demoFlow());
        expect(layout.edges).toHaveLength(5);
        for (const edge of layout.edges) {
            expect(edge.path.startsWith('M ')).toBe(true);
            expect(Number.isFinite(edge.labelX)).toBe(true);
            expect(Number.isFinite(edge.labelY)).toBe(true);
        }
        const errorEdge = layout.edges.find((edge) => edge.id === 'gate:error->recover')!;
        expect(errorEdge.tone).toBe('port');
        expect(errorEdge.label).toBe('port: error');
        const defaultEdge = layout.edges.find((edge) => edge.id === 'gate:out->normal')!;
        expect(defaultEdge.tone).toBe('error-branch-default');
        expect(defaultEdge.dashed).toBe(true);
        expect(defaultEdge.label).toContain('closes on error');
        const alwaysEdge = layout.edges.find((edge) => edge.id === 'start:out->gate')!;
        expect(alwaysEdge.label).toBeNull();
        // 标注落在节点之外，避免压在卡片上 / labels sit outside the cards
        const gate = layout.nodes.gate!;
        expect(errorEdge.labelX).toBeGreaterThan(gate.x + gate.width);
    });

    it('is deterministic for the same projection', () => {
        const first = layoutFlow(demoFlow());
        const second = layoutFlow(demoFlow());
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it('offsets parallel edges instead of drawing one indistinguishable line', () => {
        const flow = demoFlow();
        flow.edges.push({
            id: 'start:out->gate~1',
            from: 'start' as never,
            to: 'gate' as never,
            condition: { kind: 'always', hasPredicate: false, closedByErrorPort: false, summary: 'always' },
            layout: null,
        });
        const layout = layoutFlow(flow);
        const paths = layout.edges.filter((edge) => edge.from === 'start' && edge.to === 'gate').map((edge) => edge.path);
        expect(new Set(paths).size).toBe(2);
    });
});
