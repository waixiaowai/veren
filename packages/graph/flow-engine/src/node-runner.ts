/**
 * The GExecutor adapter: mock passthrough, explicit input-mapping resolution,
 * retry with backoff, and the onError policy (failFast / fallback / errorBranch)
 * with blackboard writes and outcome-port conclusions.
 *
 * GExecutor 适配器：mock 直出、显式输入映射解析、带退避的重试，以及 onError 策略
 * （failFast / fallback / errorBranch）下的黑板写入与端口结论。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/node-runner
 */

import { isExternalCancel } from '@deepseek-ai/dsh-graph-core';
import type { GExecutor, GraphRunContext } from '@deepseek-ai/dsh-graph-core';
import type {
    FlowBlackboard,
    FlowId,
    FlowNodeDef,
    NodeExecuteContext,
    NodeHandler,
    NodeId,
    RunId,
} from '@deepseek-ai/dsh-graph-flow-api';
import { flowError, toFlowError } from './flow-error.js';
import { resolveInputValue, toSlots } from './blackboard.js';
import { nodeApprovalPort } from './run-env.js';
import type { RunnerDeps } from './run-env.js';
import { withTimeout } from './node-timeout.js';

/**
 * 构造 GExecutor 适配器：mock 直出、输入映射解析、重试、超时、onError
 * 策略（failFast / fallback / errorBranch）、黑板写入与端口结论。
 * Build the GExecutor adapter: mock passthrough, input-mapping resolution,
 * retry, timeout, the onError policy (failFast / fallback / errorBranch),
 * blackboard writes and outcome ports.
 */
export function createRunner(deps: RunnerDeps): GExecutor {
    return {
        async execute(node, kctx): Promise<unknown> {
            const nodeId = node.id as NodeId;
            const signal = kctx.signal;
            const defNode = deps.nodeDefs.get(nodeId)!;
            if (deps.mocks && nodeId in deps.mocks) return settle(deps, nodeId, deps.mocks[nodeId]);
            const input = resolveInputs(defNode, deps.blackboard);
            const tries = Math.max(1, defNode.retry?.tries ?? 1);
            for (let attempt = 1; attempt <= tries; attempt++) {
                // 只有外部取消才抛出取消错误；fail-fast 的通知让在跑节点自然结束
                // Only an external cancel throws FLOW_CANCELLED; a fail-fast notice lets the running node finish.
                if (isExternalCancel(signal)) throw flowError('FLOW_CANCELLED', 'cancelled before execution', runRef(deps, nodeId));
                try {
                    const output = await runOnce(deps, nodeId, defNode, input, kctx, signal, attempt);
                    return settle(deps, nodeId, output);
                } catch (cause) {
                    if (attempt < tries) await retrySleep(defNode.retry?.backoffMs ?? 0, signal);
                    else return settleFailure(deps, nodeId, defNode, cause);
                }
            }
            throw flowError('NODE_FAILED', 'unreachable', runRef(deps, nodeId));
        },
    };
}

/** 运行引用三元组 / the run reference triple */
function runRef(deps: RunnerDeps, nodeId: NodeId): { flowId: string; runId: string; nodeId: NodeId } {
    return { flowId: deps.flowId, runId: deps.runId, nodeId };
}

/** 解析显式输入映射 / resolve the explicit input mapping */
function resolveInputs(defNode: FlowNodeDef, blackboard: FlowBlackboard): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(defNode.input ?? {}).map(([key, value]) => [key, resolveInputValue(value, blackboard)]),
    );
}

/** 单次尝试：nctx 组装 + 超时包裹 / one attempt: build nctx and wrap with a timeout */
async function runOnce(
    deps: RunnerDeps,
    nodeId: NodeId,
    defNode: FlowNodeDef,
    input: Record<string, unknown>,
    kctx: GraphRunContext,
    signal: AbortSignal,
    attempt: number,
): Promise<unknown> {
    const handler = resolveHandler(deps, nodeId);
    const nctx = nodeContext(deps, nodeId, kctx, signal, attempt);
    return withTimeout(
        () => handler.execute(input, nctx),
        defNode.timeout ?? deps.defaultTimeoutMs,
        nodeId,
        deps,
        attempt,
        signal,
        kctx,
    );
}

/** 运行期重解析 handler：节点类型被卸载时得到 NODE_TYPE_NOT_FOUND / re-resolve the handler at run time; unloaded types fail loudly */
function resolveHandler(deps: RunnerDeps, nodeId: NodeId): NodeHandler {
    const entry = deps.compiled.handlers.get(nodeId)!;
    const handler = deps.registry.get(entry.type, entry.version);
    if (!handler) {
        throw flowError('NODE_TYPE_NOT_FOUND', `node "${nodeId}" references unregistered type "${entry.type}@${entry.version}"`, runRef(deps, nodeId));
    }
    return handler;
}

/** 组装 NodeExecuteContext（含节点级授权面）/ build the NodeExecuteContext (with the node-scoped approval face) */
function nodeContext(
    deps: RunnerDeps,
    nodeId: NodeId,
    kctx: GraphRunContext,
    signal: AbortSignal,
    attempt: number,
): NodeExecuteContext {
    return {
        ctx: kctx,
        flowId: deps.flowId as FlowId,
        runId: deps.runId as RunId,
        nodeId,
        attempt,
        config: deps.compiled.configs.get(nodeId),
        blackboard: deps.blackboard,
        signal,
        approval: nodeApprovalPort(
            deps.approval,
            { flowId: deps.flowId as FlowId, runId: deps.runId as RunId, nodeId, attempt },
            signal,
        ),
    };
}

/** 成功落定：写黑板并记录端口结论 / settle success: write the blackboard and record outcome ports */
function settle(deps: RunnerDeps, nodeId: NodeId, output: unknown): Record<string, unknown> {
    const slots = toSlots(output);
    for (const [slot, value] of Object.entries(slots)) deps.blackboard.write(nodeId, slot, value);
    deps.outcomePorts.set(nodeId, new Set(Object.keys(slots)));
    return slots;
}

/** 失败落定：按 onError 策略 / settle failure according to the onError policy */
function settleFailure(deps: RunnerDeps, nodeId: NodeId, defNode: FlowNodeDef, cause: unknown): Record<string, unknown> {
    const policy = defNode.onError ?? 'failFast';
    if (policy === 'fallback') return settle(deps, nodeId, defNode.fallbackValue);
    const error = toFlowError(cause, runRef(deps, nodeId));
    if (policy === 'errorBranch') {
        const summary = { code: error.code, message: error.message };
        deps.blackboard.write(nodeId, 'error', summary);
        deps.outcomePorts.set(nodeId, new Set(['error']));
        return { error: summary };
    }
    throw error;
}

/** 可中止的重试间隔；fail-fast 通知不打断（兄弟分支自然跑完）/
    An abortable retry backoff; a fail-fast notice does not interrupt it (the sibling finishes naturally). */
async function retrySleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            if (isExternalCancel(signal)) reject(flowError('FLOW_CANCELLED', 'cancelled during backoff'));
            else resolve();
        }, { once: true });
    });
}
