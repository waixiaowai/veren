/**
 * 可运行演示（README 里的 `pnpm --filter ... demo` 指向本文件）：
 * 1) 用真实 Loader 装载 examples/demo.flow.yaml；
 * 2) 打印画布可直接绘制的 JSON；
 * 3) 打印一次运行中订阅到的按节点状态流与最终快照。
 *
 * The runnable demo behind the README's demo command: load the YAML flow
 * through the real Loader, print the canvas JSON, then print the per-node
 * status stream and final snapshot of one run.
 */

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core';
import { apply as enginePlugin, FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine';
import { apply as yamlPlugin, Config as yamlConfig, FlowYamlLoaderToken } from '@deepseek-ai/dsh-graph-flow-yaml';
import { apply as yamlParserPlugin } from '@veren/yaml-parser';
import { apply as canvasPlugin, FlowCanvasToken, type CanvasNodeStatusChange } from '../src/index.js';

const DEMO_FILE = fileURLToPath(new URL('../examples/demo.flow.yaml', import.meta.url));

/** 真实 Loader 组合并装载演示 YAML / the real-Loader composition loading the demo YAML */
async function loadDemo() {
    const ctx = new Context();
    await ctx.plugin(kernelPlugin);
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5000 });
    await ctx.plugin(yamlParserPlugin);
    await ctx.plugin(yamlPlugin as never, yamlConfig({ files: [] }));
    await ctx.plugin(canvasPlugin);
    const loader = ctx.get(FlowYamlLoaderToken)!;
    await loader.loadFile(DEMO_FILE);
    return { ctx, engine: ctx.get(FlowEngineToken)!, canvas: ctx.get(FlowCanvasToken)! };
}

/** 一行状态流文本 / one status-stream line */
function statusLine(change: CanvasNodeStatusChange): string {
    const details = [
        change.skipReason ? `skip=${change.skipReason}` : '',
        change.error ? `error=${change.error.code}` : '',
        change.startedAt !== undefined ? `startedAt=${change.startedAt}` : '',
        change.endedAt !== undefined ? `endedAt=${change.endedAt}` : '',
    ].filter(Boolean).join(' ');
    return `${change.nodeId}: ${change.status}${details ? ` (${details})` : ''}`;
}

describe('canvas demo', () => {
    it('prints the canvas JSON and the live per-node status stream of a YAML flow', async () => {
        const { ctx, engine, canvas } = await loadDemo();
        const projected = canvas.project('canvas-demo');
        expect(engine.hasFlow('canvas-demo')).toBe(true);
        expect(projected.nodes.map((node) => node.id)).toEqual(['start', 'gate', 'recover', 'normal', 'fatal', 'join']);
        const errorEdge = projected.edges.find((edge) => edge.id === 'gate:error->recover')!;
        expect(errorEdge.condition).toMatchObject({ kind: 'port', port: 'error' });
        expect(projected.layout).toEqual({ viewport: null, nodes: {}, edges: {} });
        expect(() => canvas.project('missing-flow')).toThrowError(
            expect.objectContaining({ code: 'CANVAS_FLOW_NOT_FOUND' }),
        );

        console.log('\n=== flow-canvas demo: static canvas JSON ===');
        console.log(JSON.stringify(projected, null, 2));

        const lines: string[] = [];
        const projection = canvas.run('canvas-demo', {}, (change) => {
            lines.push(statusLine(change));
            console.log(`status ${statusLine(change)}`);
        });
        const final = await projection.finished;
        console.log('\n=== flow-canvas demo: final snapshot ===');
        console.log(JSON.stringify(final, null, 2));

        // 一次运行里同时看到 completed / skipped / failed
        // One run shows completed, skipped and failed nodes at once.
        expect(lines.some((line) => line.startsWith('gate: completed'))).toBe(true);
        expect(lines.some((line) => line.startsWith('recover: completed'))).toBe(true);
        expect(lines).toContain('normal: skipped (skip=upstream-condition)');
        expect(lines.some((line) => line.startsWith('fatal: failed (error=NODE_FAILED'))).toBe(true);
        expect(lines).toContain('join: skipped (skip=upstream-failure)');
        expect(final.status).toBe('failed');
        expect(final.result).toEqual(await projection.handle.awaitCompletion());
        expect(canvas.project('canvas-demo').flowId).toBe('canvas-demo');
        expect(ctx.get(FlowCanvasToken)).toBeDefined();
    });
});
