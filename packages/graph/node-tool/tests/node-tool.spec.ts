/**
 * tool 节点测试：handler 面（成功原样返回 / 失败带稳定 code / signal 转发）
 * + 走真实 Loader 的组合面（内核 + 引擎 + tool 插件，mock 工具调用面）。
 *
 * Tool node tests: the handler surface (verbatim success / stable failure
 * codes / signal forwarding) plus a real-Loader composition (kernel + engine
 * + the tool plugin against a mocked tool invoker).
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { provideValue } from '@veren/core';
import { apply as kernelPlugin } from '@veren/graph-core';
import { NodeRegistryToken, registerNodeHandler } from '@veren/graph-flow-api';
import type { FlowDefinition, NodeExecuteContext } from '@veren/graph-flow-api';
import { apply as enginePlugin, FlowEngineToken, NodeRegistryImpl } from '@veren/graph-flow-engine';
import * as nodeTool from '../src/index.js';
import { createToolHandler } from '../src/index.js';
import type { ToolExecutionInput, ToolExecutionResult, ToolInvoker } from '../src/index.js';

/** 成功结果构造（补齐必填 content）/ build a success result (content required) */
const success = (value: unknown): ToolExecutionResult => ({ isError: false, value, content: [] } as ToolExecutionResult);

/** 失败结果构造（补齐必填 content）/ build a failure result (content required) */
const failure = (message: string, code?: string): ToolExecutionResult => ({
    isError: true,
    error: { message, info: code ? { name: 'bash', code } : undefined },
    content: [],
} as ToolExecutionResult);

/** 可编程的 mock 调用面 / a programmable tool invoker mock */
function mockInvoker(impl: (call: ToolExecutionInput) => Promise<ToolExecutionResult>): ToolInvoker & { calls: ToolExecutionInput[] } {
    const calls: ToolExecutionInput[] = [];
    const invoker = (async (call) => {
        calls.push(call);
        return impl(call);
    }) as ToolInvoker & { calls: ToolExecutionInput[] };
    invoker.calls = calls;
    return invoker;
}

/** 节点作用域（config 预解析）/ a node scope with a pre-parsed config */
const nctxWith = (config: unknown, signal: AbortSignal): NodeExecuteContext =>
    ({ config, signal, attempt: 1 }) as NodeExecuteContext;

describe('tool node handler', () => {
    it('returns the canonical value verbatim (the engine normalizes slots)', async () => {
        const invoker = mockInvoker(async () => success({ ok: true }));
        const handler = createToolHandler(invoker);
        const controller = new AbortController();
        const result = await handler.execute({ command: 'ls' }, nctxWith({ tool: 'bash' }, controller.signal));
        // 非对象 value 原样返回，`out` 包装由引擎统一做 / non-object values pass through; `out` wrapping is the engine's job
        expect(result).toEqual({ ok: true });
        expect(invoker.calls.length).toBe(1);
        expect(invoker.calls[0]!.name).toBe('bash');
        expect(invoker.calls[0]!.arguments).toEqual({ command: 'ls' });
        expect(invoker.calls[0]!.signal).toBe(controller.signal);
        expect(typeof invoker.calls[0]!.callId).toBe('string');
    });

    it('throws with the tool-reported stable code on failure', async () => {
        const invoker = mockInvoker(async () => failure('boom', 'SANDBOX_DENIED'));
        const handler = createToolHandler(invoker);
        await expect(handler.execute({}, nctxWith({ tool: 'bash' }, new AbortController().signal)))
            .rejects.toMatchObject({ code: 'SANDBOX_DENIED' });
    });

    it('falls back to TOOL_FAILED when the tool reports no code', async () => {
        const invoker = mockInvoker(async () => failure('boom'));
        const handler = createToolHandler(invoker);
        await expect(handler.execute({}, nctxWith({ tool: 'bash' }, new AbortController().signal)))
            .rejects.toMatchObject({ code: 'TOOL_FAILED' });
    });

    it('binds the config-declared tool name per call', async () => {
        const invoker = mockInvoker(async () => success(42));
        const handler = createToolHandler(invoker);
        const config = (handler.config as unknown as (data: unknown) => unknown)({ tool: 'calc' });
        const result = await handler.execute({}, nctxWith(config, new AbortController().signal));
        // 标量由引擎归一化进 out / scalars are normalized into `out` by the engine
        expect(result).toBe(42);
        expect(invoker.calls[0]!.name).toBe('calc');
    });
});

/** 真实 Loader 组合 / the real-Loader composition */
async function makeStack(invoker: ToolInvoker) {
    const ctx = new Context();
    // 能力先于节点插件提供：inject ['tools'] 等待其可用 / provide the capability first; inject ['tools'] waits for it
    provideValue(ctx, 'tools' as never, { execute: invoker } as never);
    await ctx.plugin(kernelPlugin);
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5000 });
    // 命名空间对象保留 inject / the namespace object preserves the inject declaration
    await ctx.plugin({ inject: nodeTool.inject, apply: nodeTool.apply } as never);
    expect(ctx.get(NodeRegistryToken)).toBeDefined();
    return { ctx, engine: ctx.get(FlowEngineToken)! };
}

describe('tool node composition (real Loader)', () => {
    it('runs a flow that invokes a registered tool and reads its slots downstream', async () => {
        const invoker = mockInvoker(async (call) => success({ command: call.arguments, exitCode: 0 }));
        const { engine } = await makeStack(invoker);
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
        const invoker = mockInvoker(async () => failure('denied', 'SANDBOX_DENIED'));
        const { engine } = await makeStack(invoker);
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
        const invoker = mockInvoker(async () => success('ok'));
        const { ctx, engine } = await makeStack(invoker);
        await engine.registerFlow({ id: 'needs-tool', nodes: [{ id: 't', type: 'tool' }], edges: [] } as FlowDefinition);
        ctx.registry.delete({ inject: nodeTool.inject, apply: nodeTool.apply } as never);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const result = await engine.run('needs-tool').awaitCompletion();
        expect(result.status).toBe('failed');
        expect(result.nodes['t']!.error!.code).toBe('NODE_TYPE_NOT_FOUND');
    });

    it('keeps the registration disposable without leaking (dispose test)', async () => {
        const ctx = new Context();
        const invoker = mockInvoker(async () => success(1));
        const registry = new NodeRegistryImpl();
        provideValue(ctx, 'tools' as never, { execute: invoker } as never);
        provideValue(ctx, NodeRegistryToken, registry);
        const plugin = {
            inject: [NodeRegistryToken] as const,
            apply: (pluginCtx: Parameters<typeof registerNodeHandler>[0]) => {
                registerNodeHandler(pluginCtx, createToolHandler(invoker));
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
