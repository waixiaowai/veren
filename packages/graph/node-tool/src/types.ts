/**
 * tool 节点的能力契约（面向 dsh-tools 的最小结构子集）。
 *
 * The tool node's capability contract: a minimal structural subset of
 * dsh-tools, so this plugin stays free of the heavy dsh-tools dependency
 * while remaining assignable from the real `ctx.tools` (ToolRuntime).
 */

/** 无损 JSON 值（与 dsh-tools 的 canonical value 对齐）/ lossless JSON value */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 工具调用入参（ctx.tools.execute 的结构子集）/ the structural subset of a tool call input */
export interface ToolCallInput {
    /** 调用标识（节点内生成）/ correlation id minted by the node */
    callId: string;
    /** 已注册工具名 / the registered tool name */
    name: string;
    /** 输入映射解析后的参数 / parsed arguments resolved from the flow input mapping */
    arguments: unknown;
    /** 取消信号（来自节点作用域）/ the cancellation signal from the node scope */
    signal: AbortSignal;
}

/** 工具失败详情 / structured tool failure detail */
export interface ToolFailureInfo {
    name: string;
    code: string;
    reason?: string;
}

/** 判别式执行结果 / the discriminated execution outcome */
export type ToolInvokeResult =
    | { readonly isError: false; readonly value: JsonValue }
    | { readonly isError: true; readonly error: { message: string; info?: ToolFailureInfo } };

/**
 * 工具调用能力：`ctx.tools`（ToolRuntime）的结构子集——真实实现可赋值给本接口。
 * The tool invocation capability: a structural subset of the real
 * `ctx.tools` (ToolRuntime); the real service assigns to this interface.
 */
export interface ToolInvokeCapability {
    execute(call: ToolCallInput): Promise<ToolInvokeResult>;
}
