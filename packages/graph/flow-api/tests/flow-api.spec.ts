/**
 * flow-api 语义层 API 测试：brand 的零运行时契约、registerNodeHandler 的
 * 注册/卸载帮助函数、以及节点插件依赖的类型面（不依赖实现包）。
 * 每个用例自建 Context，保证并发安全。
 *
 * Tests for the flow-api semantic-layer API: the zero-runtime brand contract,
 * the registerNodeHandler registration/disposal helper, and the type surface
 * node plugins depend on (without importing the engine implementation). Every
 * case builds its own Context so specs stay concurrency-safe.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { provideValue } from '@veren/core';
import { NodeRegistryToken, registerNodeHandler } from '../src/index.js';
import type {
    Branded,
    FlowDefinition,
    FlowId,
    NodeHandler,
    NodeId,
    NodeRegistry,
    RunId,
    SlotRef,
} from '../src/index.js';

/** 注册表测试替身：实现 NodeRegistry 契约（含身份校验的 disposer）/ registry double implementing the NodeRegistry contract */
function createRegistry(): NodeRegistry {
    const byType = new Map<string, Map<number, NodeHandler>>();
    return {
        register(handler): () => boolean {
            let versions = byType.get(handler.type);
            if (!versions) {
                versions = new Map<number, NodeHandler>();
                byType.set(handler.type, versions);
            }
            versions.set(handler.version, handler);
            return () => {
                const current = byType.get(handler.type);
                if (!current || current.get(handler.version) !== handler) return false;
                current.delete(handler.version);
                if (current.size === 0) byType.delete(handler.type);
                return true;
            };
        },
        get(type, version) {
            const versions = byType.get(type);
            if (!versions) return undefined;
            if (version !== undefined) return versions.get(version);
            return versions.get(Math.max(...versions.keys()));
        },
        has: (type) => byType.has(type),
        list: () => [...byType.entries()].map(([type, versions]) => ({ type, versions: [...versions.keys()] })),
    };
}

/** 测试用 handler / a handler fixture */
const demoHandler: NodeHandler = {
    type: 'demo',
    version: 1,
    config: z.object({}) as NodeHandler['config'],
    execute: (input) => input,
};

describe('branded ids', () => {
    it('brands are zero-runtime markers over strings', () => {
        // 运行时就是普通字符串（brand 只有可选属性，无额外开销）/
        // At runtime they are plain strings (the brand is an optional property; no extra cost).
        const flowId: FlowId = 'demo';
        const runId: RunId = 'run-1';
        const nodeId: NodeId = 'node-1';
        const slotRef: SlotRef = 'node-1.out';
        expect([flowId, runId, nodeId, slotRef]).toEqual(['demo', 'run-1', 'node-1', 'node-1.out']);
        // 编译期：brand 化的 id 可当 string 用，不同 brand 名字携带不同标记
        // Compile-time: branded ids are usable as strings and keep distinct brand names.
        expectTypeOf<FlowId>().toMatchTypeOf<string>();
        expectTypeOf<RunId>().toMatchTypeOf<string>();
        expectTypeOf<NodeId>().toMatchTypeOf<string>();
        expectTypeOf<FlowId>().not.toEqualTypeOf<RunId>();
        expectTypeOf<FlowId>().toEqualTypeOf<Branded<'FlowId'>>();
    });
});

describe('registerNodeHandler', () => {
    it('registers through the injected NodeRegistryToken and disposes reversibly', async () => {
        const ctx = new Context();
        const registry = createRegistry();
        provideValue(ctx, NodeRegistryToken, registry);
        const dispose = registerNodeHandler(ctx, demoHandler);
        expect(registry.has('demo')).toBe(true);
        expect(registry.get('demo', 1)).toBe(demoHandler);
        await dispose();
        expect(registry.has('demo')).toBe(false);
    });

    it('fails loudly when the registry capability is not injected', () => {
        const ctx = new Context();
        expect(() => registerNodeHandler(ctx, demoHandler)).toThrowError(/graphNodeRegistry/);
    });

    it('unloads with the plugin fiber in reverse order (no leaks)', async () => {
        const ctx = new Context();
        const registry = createRegistry();
        provideValue(ctx, NodeRegistryToken, registry);
        const nodePlugin = {
            name: 'demoNodePlugin',
            inject: [NodeRegistryToken] as const,
            apply: (pluginCtx: Context) => void registerNodeHandler(pluginCtx, demoHandler),
        };
        const fiber = await ctx.plugin(nodePlugin as never);
        expect(registry.has('demo')).toBe(true);
        await fiber.dispose();
        expect(registry.has('demo')).toBe(false);
        expect(registry.list()).toEqual([]);
    });

    it('an old fiber disposer never deletes a handler registered by a newer fiber (HMR safe)', async () => {
        const ctx = new Context();
        const registry = createRegistry();
        provideValue(ctx, NodeRegistryToken, registry);
        const makePlugin = (handler: NodeHandler, name: string) => ({
            name,
            inject: [NodeRegistryToken] as const,
            apply: (pluginCtx: Context) => void registerNodeHandler(pluginCtx, handler),
        });
        const oldFiber = await ctx.plugin(makePlugin(demoHandler, 'demoNodeV1') as never);
        const replacement: NodeHandler = { ...demoHandler, execute: () => ({ v: 2 }) };
        const newFiber = await ctx.plugin(makePlugin(replacement, 'demoNodeV2') as never);
        expect(registry.get('demo', 1)).toBe(replacement);
        // 旧 fiber 晚卸载：身份校验让它成为 no-op / the old fiber unloads later: the identity check makes it a no-op
        await oldFiber.dispose();
        expect(registry.get('demo', 1)).toBe(replacement);
        await newFiber.dispose();
        expect(registry.has('demo')).toBe(false);
    });
});

describe('type surface', () => {
    it('a FlowDefinition is writable with branded literals and slot references', () => {
        const definition: FlowDefinition = {
            id: 'pipeline',
            nodes: [
                { id: 'source', type: 'echo', config: { message: 'hi' } },
                { id: 'sink', type: 'noop', input: { said: '${source.message}' } },
            ],
            edges: [{ from: 'source', to: 'sink' }],
            output: { said: '${sink.said}' },
        };
        expect(definition.nodes).toHaveLength(2);
        expect(definition.edges[0]).toEqual({ from: 'source', to: 'sink' });
        // 节点插件的 handler 只需实现类型面，不依赖引擎实现
        // Node plugins implement the type surface only, never the engine implementation.
        expectTypeOf<NodeHandler>().toMatchTypeOf<{ type: string; version: number; execute: unknown }>();
        expectTypeOf(definition).toMatchTypeOf<FlowDefinition>();
    });
});
