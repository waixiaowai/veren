/**
 * 纯映射层测试：状态色板、recovered 区分、条件边标注、output 取值契约、
 * 运行摘要与只读叠加。这里不启动浏览器，也不启动服务器。
 *
 * Pure mapping tests: status palettes, recovered distinction, conditional edge
 * labels, the output contract, the run digest and the read-only overlay. No
 * browser and no server are started here.
 */

import { describe, expect, it } from 'vitest';
import type {
    CanvasEdgeCondition,
    CanvasNodeRuntime,
    CanvasNodeStatusChange,
    CanvasRunSnapshot,
} from '@deepseek-ai/dsh-graph-flow-canvas';
import {
    edgeVisual, nodeOutput, nodeStateDetail, statusVisual, withLiveChanges,
} from '../src/model.js';
import { runSummary } from '../src/summary.js';

/** 条件描述构造器 / condition factory */
function condition(overrides: Partial<CanvasEdgeCondition> & Pick<CanvasEdgeCondition, 'kind'>): CanvasEdgeCondition {
    return {
        hasPredicate: false,
        closedByErrorPort: false,
        summary: 'summary',
        ...overrides,
    };
}

/** 快照构造器 / snapshot factory */
function snapshot(overrides: Partial<CanvasRunSnapshot> = {}): CanvasRunSnapshot {
    return {
        schemaVersion: 1,
        flowId: 'demo' as CanvasRunSnapshot['flowId'],
        runId: 'run-1' as CanvasRunSnapshot['runId'],
        status: 'running',
        nodes: {},
        result: null,
        ...overrides,
    } as CanvasRunSnapshot;
}

describe('status → palette/marker', () => {
    it('maps every node status to a distinct tone, marker and class', () => {
        const statuses = ['pending', 'ready', 'running', 'completed', 'failed', 'skipped', 'cancelled'] as const;
        const visuals = statuses.map((status) => statusVisual(status));
        expect(visuals.map((visual) => visual.tone)).toEqual([...statuses]);
        expect(new Set(visuals.map((visual) => visual.className)).size).toBe(statuses.length);
        for (const visual of visuals) expect(visual.marker.length).toBeGreaterThan(0);
    });

    it('marks recovered failures differently from a clean completed node', () => {
        const clean = statusVisual('completed');
        const recovered = statusVisual('completed', { code: 'NODE_FAILED' });
        expect(clean.tone).toBe('completed');
        expect(recovered.tone).toBe('recovered');
        expect(recovered.className).not.toBe(clean.className);
        expect(recovered.marker).not.toBe(clean.marker);
        expect(recovered.label).toBe('completed · recovered');
    });

    it('puts the failure, recovered and skip facts on the node detail line', () => {
        const runtime = (extra: Partial<CanvasNodeRuntime>): CanvasNodeRuntime => ({ id: 'n' as never, status: 'failed', ...extra });
        expect(nodeStateDetail(runtime({ error: { code: 'NODE_FAILED', message: 'boom' } }))).toContain('NODE_FAILED: boom');
        expect(nodeStateDetail(runtime({ status: 'completed', recovered: { code: 'NODE_FAILED', message: 'caught' } }))).toBe('recovered NODE_FAILED');
        expect(nodeStateDetail(runtime({ status: 'skipped', skipReason: 'upstream-condition' }))).toBe('skip: upstream-condition');
        expect(nodeStateDetail(runtime({}))).toBeUndefined();
    });
});

describe('conditional edge → label', () => {
    it('labels port, predicate and errorBranch default edges differently', () => {
        const port = edgeVisual(condition({ kind: 'port', port: 'error' }));
        expect(port).toMatchObject({ tone: 'port', label: 'port: error', dashed: false });

        const predicate = edgeVisual(condition({ kind: 'predicate', hasPredicate: true }));
        expect(predicate).toMatchObject({ tone: 'predicate', label: 'predicate', dashed: false });

        const errorDefault = edgeVisual(condition({ kind: 'error-branch-default', closedByErrorPort: true }));
        expect(errorDefault.tone).toBe('error-branch-default');
        expect(errorDefault.dashed).toBe(true);
        expect(errorDefault.label).toContain('closes on error');
    });

    it('keeps unconditional edges unlabelled and explains ignored predicates', () => {
        expect(edgeVisual(condition({ kind: 'always' })).label).toBeNull();
        const portWithPredicate = edgeVisual(condition({ kind: 'port', port: 'error', hasPredicate: true }));
        expect(portWithPredicate.label).toContain('predicate ignored');
        const defaultWithPredicate = edgeVisual(condition({ kind: 'error-branch-default', hasPredicate: true }));
        expect(defaultWithPredicate.label).toContain('predicate');
        expect(defaultWithPredicate.label).toContain('closes on error');
    });
});

describe('node output contract', () => {
    /** 运行中 worker 的 result 里只有 output；canvas runtime 故意没有 output */
    const final = snapshot({
        status: 'failed',
        nodes: {
            gate: { id: 'gate' as never, status: 'completed', recovered: { code: 'NODE_FAILED', message: 'caught' } },
        },
        result: {
            flowId: 'demo',
            runId: 'run-1',
            status: 'failed',
            output: {},
            nodes: {
                gate: { status: 'completed', output: { error: { code: 'NODE_FAILED' }, message: 'caught' } },
            },
        } as unknown as NonNullable<CanvasRunSnapshot['result']>,
    });

    it('reads output only from snapshot.result.nodes[id].output', () => {
        const result = nodeOutput(final, 'gate');
        expect(result.available).toBe(true);
        if (result.available) expect(result.value).toEqual({ error: { code: 'NODE_FAILED' }, message: 'caught' });
        // canvas runtime 上即便被塞了 output 也不能读 / even a stray runtime output must not be read
        const contaminated = { ...final, nodes: { gate: { ...final.nodes.gate, output: 'WRONG' } } } as unknown as CanvasRunSnapshot;
        const still = nodeOutput(contaminated, 'gate');
        expect(still.available).toBe(true);
        if (still.available) expect(still.value).not.toBe('WRONG');
    });

    it('explains every unavailable case instead of inventing data', () => {
        expect(nodeOutput(null, 'gate')).toEqual({ available: false, reason: 'no-run' });
        expect(nodeOutput(snapshot(), 'gate')).toEqual({ available: false, reason: 'running' });
        const missing = snapshot({ result: { nodes: {} } as unknown as NonNullable<CanvasRunSnapshot['result']> });
        expect(nodeOutput(missing, 'gate')).toEqual({ available: false, reason: 'missing-node' });
        const noOutput = snapshot({ result: { nodes: { gate: { status: 'failed' } } } as unknown as NonNullable<CanvasRunSnapshot['result']> });
        expect(nodeOutput(noOutput, 'gate')).toEqual({ available: false, reason: 'no-output' });
    });

    it('treats falsy output values as available', () => {
        const value = snapshot({ result: { nodes: { gate: { status: 'completed', output: 0 } } } as unknown as NonNullable<CanvasRunSnapshot['result']> });
        expect(nodeOutput(value, 'gate')).toEqual({ available: true, value: 0 });
    });

    it('does not mutate the snapshot while reading output', () => {
        const before = JSON.stringify(final);
        nodeOutput(final, 'gate');
        expect(JSON.stringify(final)).toBe(before);
    });
});

describe('live changes overlay', () => {
    it('overlays on a copy and leaves the original snapshot untouched', () => {
        const base = snapshot({
            nodes: { gate: { id: 'gate' as never, status: 'pending' } },
            result: { nodes: {} } as unknown as NonNullable<CanvasRunSnapshot['result']>,
        });
        const change: CanvasNodeStatusChange = {
            flowId: 'demo' as never,
            runId: 'run-1' as never,
            nodeId: 'gate' as never,
            id: 'gate' as never,
            status: 'completed',
            recovered: { code: 'NODE_FAILED', message: 'caught' },
            startedAt: 10,
            endedAt: 20,
        };
        const live = withLiveChanges(base, [change]);
        expect(live?.nodes.gate.status).toBe('completed');
        expect(live?.nodes.gate.recovered?.code).toBe('NODE_FAILED');
        expect(live?.nodes.gate.startedAt).toBe(10);
        expect(live?.result).toBe(base.result);
        expect(base.nodes.gate.status).toBe('pending');
        expect(base.nodes.gate.recovered).toBeUndefined();
    });
});

describe('run summary', () => {
    it('names the first failure and counts recovered/skipped separately', () => {
        const failedRun = snapshot({
            status: 'failed',
            nodes: {
                start: { id: 'start' as never, status: 'completed' },
                gate: { id: 'gate' as never, status: 'completed', recovered: { code: 'NODE_FAILED', message: 'caught' } },
                recover: { id: 'recover' as never, status: 'completed' },
                normal: { id: 'normal' as never, status: 'skipped', skipReason: 'upstream-condition' },
                fatal: { id: 'fatal' as never, status: 'failed', error: { code: 'NODE_FAILED', message: 'fatal boom' } },
                join: { id: 'join' as never, status: 'skipped', skipReason: 'upstream-failure' },
            },
        });
        const summary = runSummary(failedRun);
        expect(summary.tone).toBe('failed');
        expect(summary.headline).toContain('fatal');
        expect(summary.headline).toContain('NODE_FAILED');
        expect(summary.counts.completed).toBe(3);
        expect(summary.counts.recovered).toBe(1);
        expect(summary.counts.failed).toBe(1);
        expect(summary.counts.skipped).toBe(2);
        expect(summary.counts.settled).toBe(6);
        expect(summary.failed).toEqual([{ id: 'fatal', code: 'NODE_FAILED', message: 'fatal boom' }]);
        expect(summary.recovered.map((node) => node.id)).toEqual(['gate']);
        expect(summary.skipped.map((node) => node.id)).toEqual(['normal', 'join']);
        expect(summary.detail).toContain('first failure');
    });

    it('describes an idle page and a running page honestly', () => {
        expect(runSummary(null).tone).toBe('idle');
        const running = runSummary(snapshot({
            nodes: {
                a: { id: 'a' as never, status: 'completed' },
                b: { id: 'b' as never, status: 'running' },
            },
        }));
        expect(running.tone).toBe('running');
        expect(running.headline).toContain('1/2');
        expect(running.counts.running).toBe(1);
    });

    it('calls out recovered failures on an otherwise completed run', () => {
        const summary = runSummary(snapshot({
            status: 'completed',
            nodes: {
                gate: { id: 'gate' as never, status: 'completed', recovered: { code: 'NODE_FAILED', message: 'caught' } },
            },
        }));
        expect(summary.tone).toBe('completed');
        expect(summary.headline).toContain('失败已兜底');
        expect(summary.counts.recovered).toBe(1);
    });
});
