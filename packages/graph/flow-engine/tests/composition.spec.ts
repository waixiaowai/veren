/**
 * 组合测试（走真实 Loader）：内核插件 + 引擎插件 + 节点类型插件一起装载，
 * 覆盖 waterfall 改写产出（下游黑板读到改写值）与卸载节点插件后
 * NODE_TYPE_NOT_FOUND。
 *
 * Composition tests through the real Loader: kernel + engine + node-type
 * plugins mounted together, covering the post-execute rewrite (the downstream
 * blackboard reads the rewritten value) and NODE_TYPE_NOT_FOUND after the
 * node plugin unloads.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { apply as kernelPlugin, GraphKernelToken } from '@veren/graph-core';
import { NodeRegistryToken, registerNodeHandler } from '@veren/graph-flow-api';
import type { NodeHandler } from '@veren/graph-flow-api';
import { apply as enginePlugin, FlowEngineToken } from '../src/index.js';
import type { FlowDefinition } from '@veren/graph-flow-api';

/** 参考节点插件：把输入文本转大写 / the reference node plugin: upper-cases its text input */
const upperHandler: NodeHandler<{ upper?: boolean }> = {
    type: 'upper',
    version: 1,
    config: z.object({ upper: z.boolean().default(true) }),
    execute: (input) => {
        const text = typeof input['text'] === 'string' ? input['text'] : '';
        return { out: text.toUpperCase() };
    },
};

const upperPlugin = {
    name: 'upperNodePlugin',
    inject: [NodeRegistryToken] as const,
    apply: (ctx: Parameters<typeof registerNodeHandler>[0]) => {
        registerNodeHandler(ctx, upperHandler);
    },
};

/** 组装真实 Loader 组合 / assemble the stack through the real Loader */
async function makeStack() {
    const ctx = new Context();
    await ctx.plugin(kernelPlugin);
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5000 });
    await ctx.plugin(upperPlugin as never);
    const engine = ctx.get(FlowEngineToken);
    expect(ctx.get(GraphKernelToken)).toBeDefined();
    return { ctx, engine: engine! };
}

describe('flow engine composition (real Loader)', () => {
    it('runs a registered flow end to end with blackboard wiring', async () => {
        const { engine } = await makeStack();
        const def: FlowDefinition = {
            id: 'composed',
            nodes: [
                { id: 'src', type: 'echo', config: { message: 'hello' } },
                { id: 'up', type: 'upper', input: { text: '${src.message}' } },
            ],
            edges: [{ from: 'src', to: 'up' }],
            output: { shouted: '${up.out}' },
        };
        await engine.registerFlow(def);
        const result = await engine.run('composed').awaitCompletion();
        expect(result.status).toBe('completed');
        expect(result.output['shouted']).toBe('HELLO');
    });

    it('node-post-execute waterfall rewrites outputs and downstream blackboard reads see it', async () => {
        const { ctx, engine } = await makeStack();
        ctx.on('graph/node-post-execute', (meta, envelope, next) => {
            // 加工节点产出：改写 envelope.output / rewrite the node output via the envelope
            if (meta.nodeId === 'up') envelope.output = { out: 'REWRITTEN' };
            return next();
        });
        await engine.registerFlow({
            id: 'rewritten',
            nodes: [
                { id: 'up', type: 'upper', input: { text: 'ignored' } },
                { id: 'sink', type: 'noop', input: { v: '${up.out}' } },
            ],
            edges: [{ from: 'up', to: 'sink' }],
        } as FlowDefinition);
        const result = await engine.run('rewritten').awaitCompletion();
        expect(result.status).toBe('completed');
        expect(result.nodes['up']!.output).toEqual({ out: 'REWRITTEN' });
        // 下游黑板读到的是改写后的值 / the downstream blackboard sees the rewritten value
        expect(result.nodes['sink']!.output).toEqual({ v: 'REWRITTEN' });
    });

    it('uninstalling the node plugin makes later runs fail with NODE_TYPE_NOT_FOUND', async () => {
        const { ctx, engine } = await makeStack();
        await engine.registerFlow({
            id: 'depends-on-upper',
            nodes: [{ id: 'up', type: 'upper', input: { text: 'x' } }],
            edges: [],
        } as FlowDefinition);
        ctx.registry.delete(upperPlugin as never);
        await new Promise((resolve) => setTimeout(resolve, 0));
        // 运行期重解析 handler：引用已卸载类型 → NODE_TYPE_NOT_FOUND
        // Handlers re-resolve at run time: a run referencing the uninstalled type fails loudly.
        const result = await engine.run('depends-on-upper').awaitCompletion();
        expect(result.status).toBe('failed');
        expect(result.nodes['up']!.error!.code).toBe('NODE_TYPE_NOT_FOUND');
        expect(result.error!.code).toBe('NODE_TYPE_NOT_FOUND');
    });
});
