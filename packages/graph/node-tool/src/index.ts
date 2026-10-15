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
import z from '@deepseek-ai/schemastery';
import { defineToken } from '@veren/core';
import { registerNodeHandler } from '@veren/graph-flow-api';
import type { NodeExecuteContext, NodeHandler } from '@veren/graph-flow-api';
import type { JsonValue, ToolInvokeCapability } from './types.js';

export type { JsonValue, ToolCallInput, ToolFailureInfo, ToolInvokeCapability, ToolInvokeResult } from './types.js';

/**
 * 工具调用能力令牌：服务名与 DSH 的 `ctx.tools` 一致（'tools'）。测试或轻量
 * 装配方可用它提供一个满足契约的替身；生产装配直接装载 dsh-tools。
 * The tool invocation token: the service name matches DSH's `ctx.tools`
 * ('tools'). Tests or light assemblies may provide a stand-in under it; real
 * assemblies simply load dsh-tools.
 */
export const ToolsToken = defineToken<ToolInvokeCapability>('tools');

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
export async function invokeTool(capability: ToolInvokeCapability, config: ToolNodeConfig, input: Record<string, unknown>, nctx: NodeExecuteContext): Promise<Record<string, unknown>> {
    const result = await capability.execute({
        callId: randomUUID(),
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

/** tool 节点 handler（能力经 apply 闭包注入）/ the tool node handler (capability injected via the apply closure) */
export function createToolHandler(capability: ToolInvokeCapability): NodeHandler {
    return {
        type: 'tool',
        version: 1,
        // schemastery schema 宽化到 NodeHandler.config 槽位 / widen the schema into the NodeHandler.config slot
        config: toolNodeConfigSchema as unknown as NodeHandler['config'],
        execute: (input, nctx) => invokeTool(capability, nctx.config as ToolNodeConfig, input, nctx),
    };
}

/** 插件名 / the plugin name */
export const name = 'graphNodeTool';
/** 依赖 DSH 工具注册表能力 / requires the DSH tool registry capability */
export const inject = ['tools'] as const;
/** 注册 tool 节点类型（经 NodeRegistryToken）/ registers the tool node type */
export const provide = [] as const;

export const apply = (ctx: Context): void => {
    registerNodeHandler(ctx, createToolHandler(ctx.tools));
};
