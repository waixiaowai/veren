/**
 * Shared fixtures for the tool-node approval specs: result constructors that
 * fill the required content face, a programmable approval face, and the
 * outcome shortcuts the specs answer with.
 *
 * tool 节点授权用例的共享夹具：补齐必填 content 面的结果构造器、可编程授权面，以及
 * 用例应答所用的结果快捷构造。
 */

import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import type { FlowApprovalOutcome, FlowApprovalRequest, FlowNodeApprovalPort } from '@deepseek-ai/dsh-graph-flow-api';

/** 成功结果构造（补齐必填 content）/ build a success result (content required) */
export const success = (value: unknown): ToolExecutionResult => ({ isError: false, value, content: [] } as ToolExecutionResult);

/** 失败结果构造（补齐必填 content）/ build a failure result (content required) */
export const failure = (message: string, code?: string): ToolExecutionResult => ({
    isError: true,
    error: { message, info: code ? { name: 'FlowApproval', code } : undefined },
    content: [],
} as ToolExecutionResult);

/** 可编程授权面 / a programmable approval face */
export function approvalPort(
    outcome: FlowApprovalOutcome | (() => Promise<FlowApprovalOutcome>),
    seen: FlowApprovalRequest['action'][] = [],
) {
    const request = async (input: { action: string }) => {
        seen.push(input.action);
        return typeof outcome === 'function' ? outcome() : outcome;
    };
    return { request } as FlowNodeApprovalPort & { request: typeof request };
}

/** 结果快捷构造 / outcome shortcuts */
export const allow = (): FlowApprovalOutcome => ({ decision: 'allow', via: 'user', decidedBy: 'alice', decidedAt: 1 });
export const deny = (): FlowApprovalOutcome => ({ decision: 'deny', via: 'user', decidedBy: 'bob', decidedAt: 2 });
export const timeout = (): FlowApprovalOutcome => ({ decision: 'deny', via: 'timeout', decidedAt: 3 });
