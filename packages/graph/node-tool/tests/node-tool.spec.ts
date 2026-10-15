/**
 * tool 节点测试：单元面（slot 摊平 / 错误码 / signal 转发）+ 走真实 Loader
 * 的组合面（内核 + 引擎 + tool 插件，mock 工具能力）。
 *
 * Tool node tests: unit surface (slot spreading / error codes / signal
 * forwarding) plus a real-Loader composition (kernel + engine + the tool
 * plugin against a mocked tool capability).
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { provideValue } from '@veren/core';
import { apply as kernelPlugin } from '@veren/graph-core';
import { NodeRegistryToken, registerNodeHandler } from '@veren/graph-flow-api';
import type { FlowDefinition, NodeExecuteContext } from '@veren/graph-flow-api';
import { apply as enginePlugin, FlowEngineToken, NodeRegistryImpl } from '@veren/graph-flow-engine';
import * as nodeTool from '../src/index.js';
import { apply as nodeToolPlugin, createToolHandler, invokeTool, ToolsToken, valueToSlots } from '../src/index.js';
import type { ToolCallInput, ToolInvokeCapability, ToolInvokeResult } from '../src/index.js';

/** 可编程的 mock 工具能力 / a programmable tool capability mock */
function mockCapability(impl: (call: ToolCallInput) => Promise<ToolInvokeResult>): ToolInvokeCapability & { calls: ToolCallInput[] } {
    const calls: ToolCallInput[] = [];
    return {
        calls,
        execute: async (call) => {
            calls.push(call);
            return impl(call);
        },
    };
}

describe('tool node unit surface', () => {
    it('spreads object values and wraps scalars into the out slot', () => {
        expect(valueToSlots({ a: 1 })).toEqual({ a: 1 });
        expect(valueToSlots('text')).toEqual({ out: 'text' });
        expect(valueToSlots([1, 2])).toEqual({ out: [1, 2] });
        expect(valueToSlots(null)).toEqual({ out: null });
    });

    it('forwards name, arguments and the node signal to the capability', async () => {
        const capability = mockCapability(async () => ({ isError: false, value: { ok: true } }));
        const controller = new AbortController();
        const nctx = { signal: controller.signal, attempt: 1 } as NodeExecuteContext;
        const slots = await invokeTool(capability, { tool: 'bash' }, { command: 'ls' }, nctx);
        expect(slots).toEqual({ ok: true });
        expect(capability.calls.length).toBe(1);
        expect(capability.calls[0]!.name).toBe('bash');
        expect(capability.calls[0]!.arguments).toEqual({ command: 'ls' });
        expect(capability.calls[0]!.signal).toBe(controller.signal);
        expect(typeof capability.calls[0]!.callId).toBe('string');
    });

    it('throws with the tool-reported stable code on failure', async () => {
        const capability = mockCapability(async () => ({
            isError: true,
            error: { message: 'boom', info: { name: 'bash', code: 'SANDBOX_DENIED' } },
        }));
        const promise = invokeTool(capability, { tool: 'bash' }, {}, { signal: new AbortController().signal } as NodeExecuteContext);
        await expect(promise).rejects.toMatchObject({ code: 'SANDBOX_DENIED' });
    });

    it('creates a handler bound to the given capability', async () => {
        const capability = mockCapability(async () => ({ isError: false, value: 42 }));
        const handler = createToolHandler(capability);
        expect(handler.type).toBe('tool');
        const config = (handler.config as unknown as (data: unknown) => unknown)({ tool: 'calc' });
        const result = await handler.execute({}, { config, signal: new AbortController().signal } as NodeExecuteContext);
        expect(result).toEqual({ out: 42 });
        expect(capability.calls[0]!.name).toBe('calc');
    });
});

/** 真实 Loader 组合 / the real-Loader composition */
async function makeStack(capability: ToolInvokeCapability) {
    const ctx = new Context();
    // 能力先于节点插件提供：inject ['tools'] 等待其可用 / provide the capability first; inject ['tools'] waits for it
    provideValue(ctx, ToolsToken, capability);
    await ctx.plugin(kernelPlugin);
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5000 });
    // 命名空间对象保留 inject / the namespace object preserves the inject declaration
    await ctx.plugin({ inject: nodeTool.inject, apply: nodeTool.apply } as never);
    expect(ctx.get(NodeRegistryToken)).toBeDefined();
    return { ctx, engine: ctx.get(FlowEngineToken)! };
}

describe('tool node composition (real Loader)', () => {
    it('runs a flow that invokes a registered tool and reads its slots downstream', async () => {
        const capability = mockCapability(async (call) => ({
            isError: false,
            value: { command: call.arguments, exitCode: 0 },
        }));
        const { engine } = await makeStack(capability);
        const def: FlowDefinition = {
            id: 'tool-flow',
            nodes: [
                { id: 'say', type: 'echo', config: { message: 'hi' } },
                { id: 'run', type: 'tool', input: { command: '${say.message}' } } as FlowDefinition['nodes'][number],
            ],
            edges: [{ from: 'say', to: 'run' }],
            output: { ran: '${run.command}' },
        } as never;
        await engine.registerFlow(def);
        const result = await engine.run('tool-flow').awaitCompletion();
        expect(result.status).toBe('completed');
        expect(result.nodes['run']!.output).toEqual({ command: { command: 'hi' }, exitCode: 0 });
        expect(result.output['ran']).toEqual({ command: 'hi' });
    });

    it('surfaces tool failures with their stable code through the flow result', async () => {
        const capability = mockCapability(async () => ({
            isError: true,
            error: { message: 'denied', info: { name: 'bash', code: 'SANDBOX_DENIED' } },
        }));
        const { engine } = await makeStack(capability);
        await engine.registerFlow({
            id: 'tool-fail',
            nodes: [{ id: 'run', type: 'tool' }],
            edges: [],
        } as FlowDefinition);
        const result = await engine.run('tool-fail').awaitCompletion();
        expect(result.status).toBe('failed');
        // 工具的稳定 code 透传到 flow 层 / the tool's stable code propagates to the flow layer
        expect(result.nodes['run']!.error!.code).toBe('SANDBOX_DENIED');
        expect(result.error!.code).toBe('SANDBOX_DENIED');
    });

    it('unregistering the tool node plugin makes later runs fail with NODE_TYPE_NOT_FOUND', async () => {
        const capability = mockCapability(async () => ({ isError: false, value: 'ok' }));
        const { ctx, engine } = await makeStack(capability);
        await engine.registerFlow({ id: 'needs-tool', nodes: [{ id: 't', type: 'tool' }], edges: [] } as FlowDefinition);
        ctx.registry.delete({ inject: nodeTool.inject, apply: nodeTool.apply } as never);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const result = await engine.run('needs-tool').awaitCompletion();
        expect(result.status).toBe('failed');
        expect(result.nodes['t']!.error!.code).toBe('NODE_TYPE_NOT_FOUND');
    });

    it('keeps the registration disposable without leaking (dispose test)', async () => {
        const ctx = new Context();
        const capability = mockCapability(async () => ({ isError: false, value: 1 }));
        const registry = new NodeRegistryImpl();
        provideValue(ctx, ToolsToken, capability);
        provideValue(ctx, NodeRegistryToken, registry);
        const plugin = {
            inject: [NodeRegistryToken] as const,
            apply: (pluginCtx: Parameters<typeof registerNodeHandler>[0]) => {
                registerNodeHandler(pluginCtx, createToolHandler(capability));
            },
        };
        await ctx.plugin(plugin as never);
        expect(registry.has('tool')).toBe(true);
        // 卸载插件 fiber → 节点类型逆序注销 / unloading the plugin fiber unregisters the type
        ctx.registry.delete(plugin as never);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(registry.has('tool')).toBe(false);
    });
});
