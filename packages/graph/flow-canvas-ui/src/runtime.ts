/**
 * 数据面组合：用真实插件栈创建 graph 引擎与画布服务，并注册演示 flow。
 * Data-plane composition: create the graph engine and canvas service from the
 * real plugin stack and register the demo flows.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core';
import { apply as enginePlugin, FlowEngineToken, type FlowEngineService } from '@deepseek-ai/dsh-graph-flow-engine';
import { apply as yamlPlugin, Config as yamlConfig, FlowYamlLoaderToken } from '@deepseek-ai/dsh-graph-flow-yaml';
import { apply as yamlParserPlugin } from '@veren/yaml-parser';
import { apply as canvasPlugin, FlowCanvasToken } from '@deepseek-ai/dsh-graph-flow-canvas';
import type { FlowCanvas } from '@deepseek-ai/dsh-graph-flow-canvas';
import { getOrThrow } from '@veren/core';
import type { FlowDescriptor } from './model.js';

/** 已组合好的数据面 / the composed data plane */
export interface CanvasRuntime {
    engine: FlowEngineService;
    canvas: FlowCanvas;
    close(): Promise<void>;
}

/** flow 的页面元数据 / page metadata for a flow */
const FLOW_META: Record<string, { label: string; note: string }> = {
    'canvas-demo': {
        label: 'canvas-demo',
        note: 'canonical examples/demo.flow.yaml · failed + skipped + recovered',
    },
    'canvas-demo-pacing': {
        label: 'canvas-demo · paced',
        note: 'identical graph; fail nodes retry so running states stay visible',
    },
    'canvas-demo-predicate': {
        label: 'canvas-demo · predicate',
        note: 'identical graph; one edge declares a predicate so its label is visible',
    },
};

/**
 * 启动真实数据面并装载演示 YAML。
 * Start the real data plane and load the demo YAML.
 *
 * @param options 可选演示文件覆盖 / optional demo-file override
 * @returns 引擎、画布服务与关闭函数 / engine, canvas service and close()
 */
export async function createCanvasRuntime(options: { demoFile?: string } = {}): Promise<CanvasRuntime> {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const demoFile = options.demoFile ?? resolve(packageRoot, '..', 'flow-canvas', 'examples', 'demo.flow.yaml');
    const disposers: Array<() => Promise<void>> = [];
    const ctx = new Context();
    const mount = async (plugin: unknown, config?: unknown): Promise<void> => {
        const fiber = await ctx.plugin(plugin as never, config as never);
        disposers.push(() => fiber.dispose());
    };
    await mount(kernelPlugin);
    await mount(enginePlugin, { nodeTimeoutMs: 5000 });
    await mount(yamlParserPlugin);
    await mount(yamlPlugin, yamlConfig({ files: [] }));
    await mount(canvasPlugin);

    const engine = getOrThrow(ctx, FlowEngineToken) as FlowEngineService;
    const canvas = getOrThrow(ctx, FlowCanvasToken) as FlowCanvas;
    await getOrThrow(ctx, FlowYamlLoaderToken).loadFile(demoFile);
    await registerPacedDemo(engine);
    await registerPredicateDemo(engine);

    return {
        engine,
        canvas,
        async close() {
            for (const dispose of disposers.reverse()) await dispose().catch(() => void 0);
        },
    };
}

/**
 * 注册一个「有节奏」的同图演示：只给 fail 节点加重试，让 running 状态可见，
 * 图结构与 status 语义不变。
 *
 * Register a paced copy of the same graph: only fail nodes get retries so the
 * running state is visible; graph structure and status semantics are unchanged.
 */
async function registerPacedDemo(engine: FlowEngineService): Promise<void> {
    const canonical = engine.getFlow('canvas-demo' as never);
    if (!canonical) return;
    const paced = structuredClone(canonical) as typeof canonical;
    paced.id = 'canvas-demo-pacing' as typeof canonical.id;
    for (const node of paced.nodes) {
        if (node.type === 'fail') node.retry = { tries: 3, backoffMs: 240 };
    }
    await engine.registerFlow(paced);
}

/**
 * 注册谓词演示：同一张图，只给 recover→fatal 加一个恒真谓词，让 predicate
 * 标注在画布上可见（YAML Loader 不承载函数谓词）。
 *
 * Register a predicate demo: the same graph, with one always-true predicate on
 * recover→fatal so the canvas shows the predicate label (the YAML Loader does
 * not carry function predicates).
 */
async function registerPredicateDemo(engine: FlowEngineService): Promise<void> {
    const canonical = engine.getFlow('canvas-demo' as never);
    if (!canonical) return;
    const predicate = structuredClone(canonical) as typeof canonical;
    predicate.id = 'canvas-demo-predicate' as typeof canonical.id;
    const edge = predicate.edges.find((candidate) => candidate.from === 'recover' && candidate.to === 'fatal');
    if (!edge) return;
    edge.when = () => true;
    await engine.registerFlow(predicate);
}

/** 已注册 flow → 页面下拉框 / registered flows → page selector entries */
export function flowDescriptors(engine: FlowEngineService): FlowDescriptor[] {
    return engine.listFlows().map((summary) => {
        const meta = FLOW_META[summary.id as string] ?? { label: summary.id as string, note: 'registered flow' };
        return {
            id: summary.id as string,
            label: meta.label,
            note: meta.note,
            nodes: summary.nodes,
            edges: summary.edges,
            outputs: summary.outputs,
        };
    });
}
