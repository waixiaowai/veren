/**
 * @veren/graph-node-tool —— 通用 tool 节点：把 DSH 已注册工具（ctx.tools）
 * 变成 flow 节点类型。
 *
 * @veren/graph-node-tool — the generic tool node: every tool already
 * registered in the DSH tool registry (ctx.tools) becomes a flow node type.
 *
 * 节点 config 只声明工具名；输入映射解析结果作为工具 arguments 走完整
 * tools 管线（沙箱/策略/超时/审批），成功的 canonical JSON value 摊平写入
 * 黑板 slot，失败以带稳定 code 的错误抛出（配合 retry / onError 策略）。
 * The node config names the tool; resolved flow inputs become the tool
 * arguments and run the full tools pipeline (sandbox, policies, timeout,
 * approval). The canonical JSON value of a success is spread into blackboard
 * slots; failures throw with a stable code so retry/onError policies apply.
 */

import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
// 类型-only import：只为拉取 dsh-tools 的 declaration merge（ctx.tools 类型面）
// Type-only import: pulls in the dsh-tools declaration merge (the ctx.tools type surface).
import type { } from '@deepseek-ai/dsh-tools';
import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import z from '@deepseek-ai/schemastery';
import { registerNodeHandler } from '@veren/graph-flow-api';
import type { NodeExecuteContext, NodeHandler } from '@veren/graph-flow-api';

export type { ToolExecutionInput, ToolExecutionResult };

/** 工具调用面：ctx.tools.execute 的函数形状 / the calling surface: the shape of ctx.tools.execute */
export type ToolInvoker = (call: ToolExecutionInput) => Promise<ToolExecutionResult>;

/** tool 节点的 config / the tool node's config */
export interface ToolNodeConfig {
    /** 已注册的工具名 / the registered tool name */
    tool: string;
}

/** 归一化 config 的 schemastery schema / the schemastery schema for the config */
export const toolNodeConfigSchema: z<ToolNodeConfig> = z.object({ tool: z.string() });

/** 归一化工具产出为命名 slot / normalize a tool value into named slots */
export function valueToSlots(value: JsonValue): Record<string, unknown> {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return { out: value };
}

/** 执行一次工具调用 / run one tool invocation */
export async function invokeTool(execute: ToolInvoker, config: ToolNodeConfig, input: Record<string, unknown>, nctx: NodeExecuteContext): Promise<Record<string, unknown>> {
    const result = await execute({
        callId: randomUUID() as ToolExecutionInput['callId'],
        name: config.tool,
        arguments: input,
        signal: nctx.signal,
    });
    if (!result.isError) return valueToSlots(result.value);
    const code = result.error.info?.code ?? 'TOOL_FAILED';
    const error = new Error(`tool "${config.tool}" failed: ${result.error.message}`) as Error & { code: string };
    error.code = code;
    throw error;
}

/** tool 节点 handler（调用面经 apply 闭包注入）/ the tool node handler (the invoker injected via the apply closure) */
export function createToolHandler(execute: ToolInvoker): NodeHandler {
    return {
        type: 'tool',
        version: 1,
        // schemastery schema 宽化到 NodeHandler.config 槽位 / widen the schema into the NodeHandler.config slot
        config: toolNodeConfigSchema as unknown as NodeHandler['config'],
        execute: (input, nctx) => invokeTool(execute, nctx.config as ToolNodeConfig, input, nctx),
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
