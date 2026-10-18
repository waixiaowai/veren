/**
 * @deepseek-ai/dsh-graph-node-tool —— 通用 tool 节点：把 DSH 已注册工具（ctx.tools）
 * 变成 flow 节点类型。
 *
 * 两条授权路径（都不另造审批协议）：
 * 1. tools 管线的 `ask` 判据：本插件用 prepend 的 `tools/pre-execute` 监听器读到
 *    下游策略给出的 ask，转成 flow 节点授权卡的问题，再把人的决定翻译回 allow/deny；
 * 2. 节点 config 的显式 `approval.require`：调用前直接向节点授权面请求。
 * 两条路径共用 flow-api 的 FlowNodeApprovalPort：请求真正挂起运行，直到回答、
 * 超时或取消；授权只对这一 run 的这一次调用有效。
 *
 * @deepseek-ai/dsh-graph-node-tool — the generic tool node: every tool already
 * registered in the DSH tool registry (ctx.tools) becomes a flow node type.
 *
 * Two approval paths, neither inventing a new approval protocol:
 * 1. The tools pipeline's `ask` decision: a prepended `tools/pre-execute`
 *    listener reads the ask produced downstream, turns it into a flow-node
 *    approval question, and translates the human's answer back into allow/deny;
 * 2. The node config's explicit `approval.require`: ask the node approval face
 *    before the call.
 * Both paths share flow-api's FlowNodeApprovalPort: the request really suspends
 * the run until answered, timed out, or cancelled, and a grant covers only this
 * one call of this one run.
 */

import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
// 类型-only import：只为拉取 dsh-tools 的 declaration merge（ctx.tools 类型面）
// Type-only import: pulls in the dsh-tools declaration merge (the ctx.tools type surface).
import type { } from '@deepseek-ai/dsh-tools';
import type { PreToolDecision, ToolExecution, ToolExecutionInput } from '@deepseek-ai/dsh-tools';
import type { FlowApprovalOutcome } from '@deepseek-ai/dsh-graph-flow-api';
import z from '@deepseek-ai/schemastery';
import { isExternalCancel } from '@deepseek-ai/dsh-graph-core';
import { registerNodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import type { NodeExecuteContext, NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import type { ActiveToolCall, ToolInvoker, ToolNodeConfig } from './types.js';

export type { ActiveToolCall, ToolApprovalConfig, ToolExecutionInput, ToolExecutionResult, ToolInvoker, ToolNodeConfig } from './types.js';

/** 授权失败稳定码 / stable authorization failure codes */
export const APPROVAL_CODES = {
    denied: 'NODE_PERMISSION_DENIED',
    timeout: 'NODE_APPROVAL_TIMEOUT',
    unavailable: 'NODE_APPROVAL_UNAVAILABLE',
    cancelled: 'FLOW_CANCELLED',
} as const;

/** 归一化 config 的 schemastery schema / the schemastery schema for the config */
export const toolNodeConfigSchema: z<ToolNodeConfig> = z.object({
    tool: z.string(),
    approval: z.object({
        require: z.boolean().default(false),
        reason: z.string(),
        timeoutMs: z.number().min(0),
    }),
});

/** 参数摘要上限（字符）/ the argument-summary cap (characters) */
const SUMMARY_LIMIT = 1200;

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

/**
 * 把工具参数压成可读、有界的摘要（卡片上的"要做什么"）。
 * Turn tool arguments into a readable, bounded summary (the card's "what").
 * @param value - the canonical argument value.
 * @returns pretty JSON capped at {@link SUMMARY_LIMIT} characters.
 */
export function summarizeArguments(value: unknown): string {
    let text: string;
    try {
        text = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        text = String(value);
    }
    return text.length <= SUMMARY_LIMIT ? text : `${text.slice(0, SUMMARY_LIMIT)}…`;
}

/** 结果来源 → 稳定错误码 / outcome source → stable error code */
function codeOf(outcome: FlowApprovalOutcome): string {
    switch (outcome.via) {
        case 'timeout': return APPROVAL_CODES.timeout;
        case 'unavailable': return APPROVAL_CODES.unavailable;
        case 'cancel': return APPROVAL_CODES.cancelled;
        case 'user': return APPROVAL_CODES.denied;
    }
}

/** 结果 → 人可读消息 / outcome → human-readable message */
function messageOf(tool: string, outcome: FlowApprovalOutcome): string {
    switch (outcome.via) {
        case 'timeout': return `approval for tool "${tool}" timed out`;
        case 'unavailable': return `tool "${tool}" requires approval, but no approval channel is available`;
        case 'cancel': return `approval for tool "${tool}" was cancelled`;
        case 'user': return `the user rejected tool "${tool}"`;
    }
}

/** 构造带稳定 code 的授权失败 / build an authorization failure carrying its stable code */
function approvalError(tool: string, outcome: FlowApprovalOutcome): Error & { code: string } {
    return Object.assign(new Error(messageOf(tool, outcome)), { code: codeOf(outcome) });
}

/** 工具节点的授权请求输入（显式 require 与 ask 两条路径共用）/ the approval input shared by both paths */
function approvalInput(tool: string, reason: string | undefined, summary: string, timeoutMs?: number) {
    return {
        kind: 'tool',
        action: tool,
        ...reason === undefined ? {} : { reason },
        summary,
        ...timeoutMs === undefined ? {} : { timeoutMs },
    };
}

/** 显式授权：调用前挂起，直到同意 / explicit approval: suspend before the call until allowed */
async function requireApproval(nctx: NodeExecuteContext, config: ToolNodeConfig, input: unknown): Promise<void> {
    const outcome = await nctx.approval.request(approvalInput(
        config.tool,
        config.approval?.reason ?? `tool "${config.tool}" requires approval`,
        summarizeArguments(input),
        config.approval?.timeoutMs,
    ));
    if (outcome.decision === 'deny') throw approvalError(config.tool, outcome);
}

/**
 * `tools/pre-execute` 拦截器：本插件注册在最外层（prepend），先让下游策略跑完，
 * 只有拿到 `ask` 且该调用属于某个 flow 节点尝试时才向节点授权面提问。
 * 非 flow 调用（例如 agent 的工具调用）原样透传。
 * The `tools/pre-execute` interceptor: this plugin registers outermost
 * (prepend), lets downstream policies finish, and only turns an `ask` for a
 * flow node attempt's call into a node approval question. Non-flow calls (an
 * agent's tool call, for example) pass through untouched.
 * @param calls - the in-flight flow tool calls, keyed by their derived signal.
 * @returns the waterfall listener.
 */
export function createApprovalGate(
    calls: ReadonlyMap<AbortSignal, ActiveToolCall>,
): (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision> {
    return async (exec, next) => {
        const active = calls.get(exec.signal);
        if (active === undefined) return next();
        const decision = await next();
        if (decision.kind !== 'ask' || active.approval === undefined) return decision;
        const outcome = await active.approval.request(approvalInput(
            exec.name,
            decision.reason ?? decision.displayReason?.en,
            summarizeArguments(exec.arguments),
        ));
        if (outcome.decision === 'allow') return { kind: 'allow' };
        return {
            kind: 'deny',
            reason: messageOf(exec.name, outcome),
            info: { name: 'FlowApproval', code: codeOf(outcome) },
        };
    };
}

/**
 * tool 节点 handler（调用面与在途表经 apply 闭包注入）。
 * The tool node handler (the invoker and in-flight table injected via the apply closure).
 * @param execute - the tools pipeline entry (`ctx.tools.execute`).
 * @param calls - the shared in-flight table read by the approval gate.
 * @returns the `tool` node handler.
 */
export function createToolHandler(
    execute: ToolInvoker,
    calls: Map<AbortSignal, ActiveToolCall> = new Map(),
): NodeHandler {
    return {
        type: 'tool',
        version: 1,
        // schemastery schema 宽化到 NodeHandler.config 槽位 / widen the schema into the NodeHandler.config slot
        config: toolNodeConfigSchema as unknown as NodeHandler['config'],
        async execute(input, nctx) {
            const config = nctx.config as ToolNodeConfig;
            const derived = deriveToolSignal(nctx);
            calls.set(derived.signal, { approval: nctx.approval, tool: config.tool });
            try {
                if (config.approval?.require === true) await requireApproval(nctx, config, input);
                const result = await execute({
                    callId: randomUUID() as ToolExecutionInput['callId'],
                    name: config.tool,
                    arguments: input,
                    signal: derived.signal,
                });
                // 成功：canonical value 原样交引擎归一化为 slot；失败：转成带稳定 code 的错误
                // Success: hand the canonical value to the engine's slot normalization; failure: rethrow with the stable code.
                if (!result.isError) return result.value;
                const code = result.error.info?.code ?? 'TOOL_FAILED';
                // 授权拒绝已带完整原因，别再套一层 "tool failed" 前缀。
                // An approval denial already carries the full reason; do not wrap
                // it in a second "tool failed" prefix.
                const message = result.error.info?.name === 'FlowApproval'
                    ? result.error.message
                    : `tool "${config.tool}" failed: ${result.error.message}`;
                const error = new Error(message) as Error & { code: string };
                error.code = code;
                throw error;
            } finally {
                calls.delete(derived.signal);
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
    const calls = new Map<AbortSignal, ActiveToolCall>();
    // prepend = 最外层：先拿到下游策略的最终 ask，再决定是否向画布提问。
    // prepend = outermost: read downstream policies' final `ask` before asking the canvas.
    ctx.on('tools/pre-execute', createApprovalGate(calls), { prepend: true });
    registerNodeHandler(ctx, createToolHandler((call) => ctx.tools.execute(call), calls));
};
