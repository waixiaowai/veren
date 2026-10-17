/**
 * 节点类型注册表单测：版本索引、dispose / HMR 安全（卸载后无注册泄漏）。
 * Registry unit tests: the version index and dispose/HMR safety (no
 * registration leaks after unload).
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { provideValue } from '@veren/core';
import { NodeRegistryToken, registerNodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import { NodeRegistryImpl, type SubflowRunner } from '../src/registry.js';
import type { NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';

/** 计数 handler 工厂 / a counting-handler factory */
const makeHandler = (type: string, version: number): NodeHandler => ({
    type,
    version,
    config: z.object({}) as NodeHandler['config'],
    execute: (input) => input,
});

describe('NodeRegistryImpl', () => {
    it('indexes by (type, version) and resolves the latest by default', () => {
        const registry = new NodeRegistryImpl();
        registry.register(makeHandler('demo', 1));
        registry.register(makeHandler('demo', 2));
        expect(registry.get('demo')!.version).toBe(2);
        expect(registry.get('demo', 1)!.version).toBe(1);
        expect(registry.get('missing')).toBeUndefined();
        expect(registry.get('demo', 99)).toBeUndefined();
        expect(registry.has('demo')).toBe(true);
        expect(registry.list()).toEqual([{ type: 'demo', versions: [1, 2] }]);
    });

    it('re-registering a version replaces it (HMR reload)', () => {
        const registry = new NodeRegistryImpl();
        registry.register(makeHandler('demo', 1));
        const replacement = makeHandler('demo', 1);
        const dispose = registry.register(replacement);
        expect(registry.get('demo', 1)).toBe(replacement);
        expect(dispose()).toBe(true);
        // 替换者的 disposer 移除该版本 / the replacement's disposer removes the version
        expect(registry.get('demo', 1)).toBeUndefined();
    });

    it('an old disposer never deletes a handler registered after it (HMR safe)', () => {
        const registry = new NodeRegistryImpl();
        const disposeOld = registry.register(makeHandler('demo', 1));
        const replacement = makeHandler('demo', 1);
        registry.register(replacement);
        // 旧 fiber 的卸载晚于新注册：身份校验让旧 disposer 成为 no-op
        // The old fiber unloads after the new registration: the identity check makes the old disposer a no-op.
        expect(disposeOld()).toBe(false);
        expect(registry.get('demo', 1)).toBe(replacement);
        expect(registry.has('demo')).toBe(true);
    });

    it('dispose removes exactly its own version and cleans up empty types', () => {
        const registry = new NodeRegistryImpl();
        const disposeV1 = registry.register(makeHandler('demo', 1));
        registry.register(makeHandler('demo', 2));
        expect(disposeV1()).toBe(true);
        expect(registry.get('demo')!.version).toBe(2);
        expect(registry.has('demo')).toBe(true);
        const disposeV2 = registry.register(makeHandler('demo', 2));
        expect(disposeV2()).toBe(true);
        expect(registry.has('demo')).toBe(false);
        expect(disposeV1()).toBe(false);
    });

    it('registerNodeHandler cleans up in reverse order with the fiber (no leaks)', async () => {
        const ctx = new Context();
        const registry = new NodeRegistryImpl();
        // 与引擎一致的注册路径：ctx.effect 贡献，inject 等待能力可用
        // The same registration path as the engine: ctx.effect contribution, inject waits for the capability.
        const nodePlugin = {
            inject: [NodeRegistryToken] as const,
            apply: (pluginCtx: Parameters<typeof registerNodeHandler>[0]) => {
                registerNodeHandler(pluginCtx, makeHandler('pluginNode', 1));
            },
        };
        provideValue(ctx, NodeRegistryToken, registry);
        await ctx.plugin(nodePlugin as never);
        expect(registry.has('pluginNode')).toBe(true);
        // 卸载插件 fiber → 注册逆序清理（等待异步 disposal 落地）
        // Unloading the plugin fiber cleans registrations up (wait for async disposal).
        ctx.registry.delete(nodePlugin as never);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(registry.has('pluginNode')).toBe(false);
    });

    it('creates a subflow handler bound to the injected runner', async () => {
        const { createSubflowHandler } = await import('../src/registry.js');
        const calls: string[] = [];
        const runner: SubflowRunner = async (flowId) => {
            calls.push(flowId);
            return { output: { value: 42 } };
        };
        const handler = createSubflowHandler(runner);
        expect(handler.type).toBe('subflow');
        const config = (handler.config as unknown as (data: unknown) => { flow: string })({ flow: 'child' });
        const result = (await handler.execute({}, {
            config,
        } as never)) as { out: { output: { value: number } } };
        expect(calls).toEqual(['child']);
        expect(result.out.output.value).toBe(42);
    });
});
