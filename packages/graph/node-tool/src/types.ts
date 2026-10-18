/**
 * @deepseek-ai/dsh-graph-node-tool 的类型面：tool 节点的 config、授权配置与
 * 工具调用面。只放类型；handler 实现与 schemastery schema 在 index.ts。
 *
 * Type surface of @deepseek-ai/dsh-graph-node-tool: the tool node config, its
 * approval options and the tool calling surface. Types only; the handler and
 * its schemastery schema live in index.ts.
 */

import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools';

export type { ToolExecutionInput, ToolExecutionResult };

/** 工具调用面：ctx.tools.execute 的函数形状 / the calling surface: the shape of ctx.tools.execute */
export type ToolInvoker = (call: ToolExecutionInput) => Promise<ToolExecutionResult>;

/** tool 节点的授权配置 / the tool node's approval options */
export interface ToolApprovalConfig {
    /**
     * 调用前必须获得授权（即使 tools 管线本身没有 ask 策略）。
     * Require approval before the call even when the tools pipeline itself
     * raises no `ask` policy.
     */
    require?: boolean;
    /** 卡片上的原因 / the reason shown on the card */
    reason?: string;
    /** 本次请求的超时覆盖（毫秒，0 = 不超时）/ per-request timeout override (ms; 0 = none) */
    timeoutMs?: number;
}

/** tool 节点的 config / the tool node's config */
export interface ToolNodeConfig {
    /** 已注册的工具名 / the registered tool name */
    tool: string;
    /** 可选的显式授权要求 / optional explicit approval requirement */
    approval?: ToolApprovalConfig;
}

/**
 * 一次在途工具调用的授权面：pre-execute 拦截按调用 signal 精确匹配，
 * 并发 run/节点互不串号。
 * The approval face of one in-flight tool call: the pre-execute interception
 * matches by the exact call signal, so concurrent runs/nodes never collide.
 */
export interface ActiveToolCall {
    /** 该节点尝试的授权面；旧引擎没有时缺省 / that node attempt's approval face; absent on an older engine */
    readonly approval?: import('@deepseek-ai/dsh-graph-flow-api').FlowNodeApprovalPort;
    /** 本次调用的工具名 / the tool name of this call */
    readonly tool: string;
}
