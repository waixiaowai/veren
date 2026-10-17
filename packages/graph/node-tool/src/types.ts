/**
 * @deepseek-ai/dsh-graph-node-tool 的类型面：tool 节点的 config 与工具调用面。
 * 只放类型；handler 实现与 schemastery schema 在 index.ts。
 *
 * Type surface of @deepseek-ai/dsh-graph-node-tool: the tool node config and
 * the tool calling surface. Types only; the handler and its schemastery schema
 * live in index.ts.
 */

import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools';

export type { ToolExecutionInput, ToolExecutionResult };

/** 工具调用面：ctx.tools.execute 的函数形状 / the calling surface: the shape of ctx.tools.execute */
export type ToolInvoker = (call: ToolExecutionInput) => Promise<ToolExecutionResult>;

/** tool 节点的 config / the tool node's config */
export interface ToolNodeConfig {
    /** 已注册的工具名 / the registered tool name */
    tool: string;
}
