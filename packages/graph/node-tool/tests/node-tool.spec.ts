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
import z from '@deepseek-ai/schemastery';
import { provideValue } from '@veren/core';
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core';
import { NodeRegistryToken, registerNodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import type { FlowDefinition, NodeExecuteContext, NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import { apply as enginePlugin, FlowEngineToken, NodeRegistryImpl } from '@deepseek-ai/dsh-graph-flow-engine';
import * as nodeTool from '../src/index.js';
import { createToolHandler } from '../src/index.js';
import type { ToolExecutionInput, ToolExecutionResult, ToolInvoker } from '../src/index.js';

/** 一次性放行信号（测试用）/ a one-shot gate for tests */
function gate(): { promise: Promise<void>; open: () => void } {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => { open = resolve; });
    return { promise, open };
}

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
        // 调用面拿到派生 signal（外部取消才中止工具）/ the call gets a derived signal (only an external cancel aborts the tool)
        expect(invoker.calls[0]!.signal).toBeInstanceOf(AbortSignal);
        expect(invoker.calls[0]!.signal.aborted).toBe(false);
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

    it('does not abort a running tool sibling on a fail-fast notice', async () => {
        let abortedAtEnd: boolean | undefined;
        const invoker = mockInvoker(async (call) => {
            await new Promise((resolve) => setTimeout(resolve, 80));
            abortedAtEnd = call.signal.aborted;
            return success({ ok: true });
        });
        const { ctx, engine } = await makeStack(invoker);
        // 慢失败兄弟：先于工具完成失败，触发 fail-fast / a slow-failing sibling fails before the tool finishes
        ctx.get(NodeRegistryToken)!.register({
            type: 'slowFail',
            version: 1,
            config: z.object({}) as NodeHandler['config'],
            execute: () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('branch failed')), 10)),
        });
        const events: string[] = [];
        ctx.on('graph/node-error', (error) => events.push(`error:${error.nodeId}`));
        await engine.registerFlow({
            id: 'tool-sibling',
            nodes: [
                { id: 'bad', type: 'slowFail' },
                { id: 'run', type: 'tool' },
                { id: 'join', type: 'noop' },
            ],
            edges: [
                { from: 'bad', to: 'join' },
                { from: 'run', to: 'join' },
            ],
        } as FlowDefinition);
        const result = await engine.run('tool-sibling').awaitCompletion();
        expect(result.status).toBe('failed');
        // 工具兄弟自然跑完，且工具调用期间 signal 未被 fail-fast 置位
        // The tool sibling finishes naturally and its call signal never flips under fail-fast.
        expect(result.nodes['run']!.status).toBe('completed');
        expect(result.nodes['run']!.error).toBeUndefined();
        expect(result.nodes['join']!.status).toBe('skipped');
        expect(abortedAtEnd).toBe(false);
        expect(events).toEqual(['error:bad']);
    });

    it('forwards an external cancel to the running tool call', async () => {
        const started = gate();
        let sawAbort = false;
        const invoker = mockInvoker(async (call) => {
            started.open();
            await new Promise<void>((resolve) => {
                call.signal.addEventListener('abort', () => { sawAbort = true; resolve(); }, { once: true });
            });
            return success({ ok: true });
        });
        const { engine } = await makeStack(invoker);
        await engine.registerFlow({ id: 'tool-cancel', nodes: [{ id: 'run', type: 'tool' }], edges: [] } as FlowDefinition);
        const handle = engine.run('tool-cancel');
        await started.promise;
        handle.cancel();
        const result = await handle.awaitCompletion();
        expect(result.status).toBe('cancelled');
        expect(result.nodes['run']!.status).toBe('cancelled');
        expect(sawAbort).toBe(true);
    });
});
