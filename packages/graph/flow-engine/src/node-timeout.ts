/**
 * Node execution timeout with an approval-aware budget: time spent waiting for
 * an approval does not consume the node's execution budget (the timer pauses
 * when a request opens and resumes when it settles); only an external cancel
 * rejects, a fail-fast notice lets the work settle.
 *
 * 节点执行超时与授权感知预算：等待授权的时段不计入节点执行预算（请求挂起时暂停
 * 计时器，落定时恢复）；只有外部取消才拒绝，fail-fast 通知交给执行方自然落定。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/node-timeout
 */

import { isExternalCancel } from '@deepseek-ai/dsh-graph-core';
import type { GraphRunContext } from '@deepseek-ai/dsh-graph-core';
import type { NodeId } from '@deepseek-ai/dsh-graph-flow-api';
import { flowError } from './flow-error.js';
import type { RunnerDeps } from './run-env.js';

/** The pausable execution budget of one node attempt. */
interface ExecutionBudget {
    pause(): void;
    resume(): void;
    /** Stop the armed timer without settling (final cleanup). */
    cancel(): void;
}

/**
 * Arm the timeout budget of one attempt; `onExpire` rejects with NODE_TIMEOUT.
 * 为一次尝试装配超时预算；到期经 `onExpire` 以 NODE_TIMEOUT 拒绝。
 */
function executionBudget(
    timeoutMs: number,
    nodeId: NodeId,
    deps: RunnerDeps,
    onExpire: (error: ReturnType<typeof flowError>) => void,
): ExecutionBudget {
    const limited = timeoutMs > 0;
    let remaining = timeoutMs;
    let armedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let paused = false;
    const arm = (): void => {
        armedAt = Date.now();
        timer = setTimeout(() => {
            timer = undefined;
            onExpire(flowError('NODE_TIMEOUT', `node "${nodeId}" timed out after ${timeoutMs}ms`, { flowId: deps.flowId, nodeId }));
        }, Math.max(0, remaining));
    };
    const pause = (): void => {
        if (!limited || paused || timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        remaining -= Date.now() - armedAt;
        paused = true;
    };
    const resume = (): void => {
        if (!limited || !paused) return;
        paused = false;
        arm();
    };
    if (limited) arm();
    return {
        pause,
        resume,
        cancel: () => {
            if (timer !== undefined) clearTimeout(timer);
        },
    };
}

/**
 * Wire the approval events that pause/resume the budget; both listeners are
 * installed before the node starts so a request raised before the first await
 * is not missed.
 * 接装暂停/恢复预算的授权事件；监听器先于节点启动装好，节点在第一个 await 前
 * 提问也不会漏掉。
 */
function wireApprovalTimer(
    kctx: GraphRunContext,
    matches: (request: { runId: string; nodeId: string; attempt: number }) => boolean,
    budget: ExecutionBudget,
): () => void {
    const offRequested = kctx.on('flow/approval-requested', (request) => {
        if (matches(request)) budget.pause();
    });
    const offDecided = kctx.on('flow/approval-decided', (payload) => {
        if (matches(payload.request)) budget.resume();
    });
    return () => {
        offRequested();
        offDecided();
    };
}

/**
 * 带超时与取消的执行：只有外部取消才拒绝；fail-fast 通知交给执行方自然落定。
 * Execute with timeout and cancellation: only an external cancel rejects; a
 * fail-fast notice lets the work settle.
 */
export function withTimeout<T>(
    work: () => T | Promise<T>,
    timeoutMs: number,
    nodeId: NodeId,
    deps: RunnerDeps,
    attempt: number,
    signal: AbortSignal,
    kctx: GraphRunContext,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const budget = executionBudget(timeoutMs, nodeId, deps, reject);
        const matches = (request: { runId: string; nodeId: string; attempt: number }): boolean =>
            request.runId === deps.runId && request.nodeId === nodeId && request.attempt === attempt;
        const offApproval = wireApprovalTimer(kctx, matches, budget);
        const onAbort = (): void => {
            if (isExternalCancel(signal)) reject(flowError('FLOW_CANCELLED', 'cancelled', { flowId: deps.flowId, nodeId }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        const cleanup = (): void => {
            budget.cancel();
            signal.removeEventListener('abort', onAbort);
            offApproval();
        };
        void Promise.resolve().then(work).then(
            (value) => { cleanup(); resolve(value); },
            (cause) => { cleanup(); reject(cause); },
        );
    });
}
