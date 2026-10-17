/**
 * @deepseek-ai/dsh-graph-node-tool —— 通用 tool 节点：把 DSH 已注册工具（ctx.tools）
 * 变成 flow 节点类型。
 *
 * @deepseek-ai/dsh-graph-node-tool — the generic tool node: every tool already
 * registered in the DSH tool registry (ctx.tools) becomes a flow node type.
 *
 * 节点 config 只声明工具名；输入映射解析结果作为工具 arguments 走完整
 * tools 管线（沙箱/策略/超时/审批）。成功的 canonical JSON value 原样返回，
 * 由引擎统一归一化为黑板 slot（非对象 → `out`）；失败以工具的稳定 code 抛出
 * （配合 retry / onError 策略）。
 * The node config names the tool; resolved flow inputs become the tool
 * arguments and run the full tools pipeline (sandbox, policies, timeout,
 * approval). A success returns the canonical JSON value verbatim — the engine
 * normalizes it into blackboard slots (non-objects → `out`); failures throw
 * with the tool's stable code so retry/onError policies apply.
 */

import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
// 类型-only import：只为拉取 dsh-tools 的 declaration merge（ctx.tools 类型面）
// Type-only import: pulls in the dsh-tools declaration merge (the ctx.tools type surface).
import type { } from '@deepseek-ai/dsh-tools';
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import { isExternalCancel } from '@deepseek-ai/dsh-graph-core';
import { registerNodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import type { NodeExecuteContext, NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import type { ToolInvoker, ToolNodeConfig } from './types.js';

export type { ToolExecutionInput, ToolExecutionResult, ToolInvoker, ToolNodeConfig } from './types.js';

/** 归一化 config 的 schemastery schema / the schemastery schema for the config */
export const toolNodeConfigSchema: z<ToolNodeConfig> = z.object({ tool: z.string() });

/**
 * 派生工具调用 signal：只有外部取消才中止工具；fail-fast 通知让工具自然跑完，
 * 兄弟分支才能在失败传播下正常结束。
 * Derive the tool-call signal: only an external cancel aborts the tool; a
 * fail-fast notice lets it finish, so siblings settle naturally under fail-fast.
 */
function deriveToolSignal(nctx: NodeExecuteContext): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const forward = (): void => {
        if (isExternalCancel(nctx.signal)) controller.abort();
    };
    if (isExternalCancel(nctx.signal)) controller.abort();
    else nctx.signal.addEventListener('abort', forward, { once: true });
    return { signal: controller.signal, dispose: () => nctx.signal.removeEventListener('abort', forward) };
}

/** tool 节点 handler（调用面经 apply 闭包注入）/ the tool node handler (the invoker injected via the apply closure) */
export function createToolHandler(execute: ToolInvoker): NodeHandler {
    return {
        type: 'tool',
        version: 1,
        // schemastery schema 宽化到 NodeHandler.config 槽位 / widen the schema into the NodeHandler.config slot
        config: toolNodeConfigSchema as unknown as NodeHandler['config'],
        async execute(input, nctx) {
            const derived = deriveToolSignal(nctx);
            try {
                const result = await execute({
                    callId: randomUUID() as ToolExecutionInput['callId'],
                    name: (nctx.config as ToolNodeConfig).tool,
                    arguments: input,
                    signal: derived.signal,
                });
                // 成功：canonical value 原样交引擎归一化为 slot；失败：转成带稳定 code 的错误
                // Success: hand the canonical value to the engine's slot normalization; failure: rethrow with the stable code.
                if (!result.isError) return result.value;
                const code = result.error.info?.code ?? 'TOOL_FAILED';
                const error = new Error(`tool "${(nctx.config as ToolNodeConfig).tool}" failed: ${result.error.message}`) as Error & { code: string };
                error.code = code;
                throw error;
            } finally {
                derived.dispose();
            }
        },
    };
}

/** 插件名 / the plugin name */
export const name = 'graphNodeTool';
/** 依赖 DSH 工具注册表能力 / requires the DSH tool registry capability */
export const inject = ['tools'] as const;
/** 注册 tool 节点类型（经 NodeRegistryToken）/ registers the tool node type */
export const provide = [] as const;

export const apply = (ctx: Context): void => {
    registerNodeHandler(ctx, createToolHandler((call) => ctx.tools.execute(call)));
};
