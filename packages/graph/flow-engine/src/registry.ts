/**
 * 节点类型注册表实现与内置最简节点（noop / fail / echo / subflow）。
 *
 * The node-type registry implementation and the built-in minimal node types
 * (noop / fail / echo / subflow).
 *
 * 内置节点只作为参考实现与集成测试夹具，不承载任何业务语义。
 * The built-ins are reference implementations and integration-test fixtures
 * only; they carry no business semantics.
 */

import z from '@deepseek-ai/schemastery';
import { isExternalCancel } from '@deepseek-ai/dsh-graph-core';
import type { GExecutor, GraphRunContext } from '@deepseek-ai/dsh-graph-core';
import type {
    FlowBlackboard,
    FlowId,
    FlowNodeDef,
    NodeExecuteContext,
    NodeHandler,
    NodeId,
    NodeRegistry,
    RunId,
} from '@deepseek-ai/dsh-graph-flow-api';
import { flowError, resolveInputValue, toFlowError, toSlots } from './runtime.js';
import type { RunnerDeps } from './runtime.js';

/** (type, version) 二级索引 / the two-level (type, version) index */
export class NodeRegistryImpl implements NodeRegistry {
    private readonly byType = new Map<string, Map<number, NodeHandler>>();

    /** 注册一个版本；重复注册覆盖同版本（HMR 重载场景）/ register one version; re-registering replaces it (HMR reloads) */
    register(handler: NodeHandler): () => boolean {
        let versions = this.byType.get(handler.type);
        if (!versions) {
            versions = new Map<number, NodeHandler>();
            this.byType.set(handler.type, versions);
        }
        versions.set(handler.version, handler);
        // 身份校验：旧 fiber 的 disposer 晚于新注册执行时不得删掉新 handler
        // Identity check: an old fiber's disposer running after a newer registration must not delete the new handler.
        return () => {
            const current = this.byType.get(handler.type);
            if (!current || current.get(handler.version) !== handler) return false;
            current.delete(handler.version);
            if (current.size === 0) this.byType.delete(handler.type);
            return true;
        };
    }

    /** 取指定版本或最新版本 / resolve a pinned version or the latest */
    get(type: string, version?: number): NodeHandler | undefined {
        const versions = this.byType.get(type);
        if (!versions) return undefined;
        if (version !== undefined) return versions.get(version);
        const latest = Math.max(...versions.keys());
        return versions.get(latest);
    }

    has(type: string): boolean {
        return this.byType.has(type);
    }

    /** 类型与已注册版本列表（诊断面）/ types with their registered versions (diagnostics) */
    list(): ReadonlyArray<{ type: string; versions: readonly number[] }> {
        return [...this.byType.entries()]
            .map(([type, versions]) => ({ type, versions: [...versions.keys()].sort((a, b) => a - b) }))
            .sort((a, b) => a.type.localeCompare(b.type));
    }
}

/** schemastery schema 宽化到 NodeHandler.config 槽位（注册表按 unknown 存储）/
    widen a schemastery schema into the NodeHandler.config slot (the registry stores unknown) */
const asConfig = (schema: unknown): NodeHandler['config'] => schema as NodeHandler['config'];

/** noop：透传输入（集成夹具）/ noop: passes its input through (integration fixture) */
export const noopHandler: NodeHandler = {
    type: 'noop',
    version: 1,
    config: asConfig(z.object({})),
    execute: (input) => input,
};

/** fail：抛错（fail-fast / retry / onError 夹具）/ fail: throws (fail-fast / retry / onError fixture) */
export const failHandler: NodeHandler = {
    type: 'fail',
    version: 1,
    config: asConfig(z.object({ message: z.string().default('node failed') })),
    execute: (_input, nctx) => {
        const { message } = nctx.config as { message: string };
        throw new Error(message);
    },
};

/** echo：把配置与输入回显为命名 slot（blackboard / waterfall 夹具）/ echo: echoes config and input into slots */
export const echoHandler: NodeHandler = {
    type: 'echo',
    version: 1,
    config: asConfig(z.object({ message: z.string().default('echo') })),
    execute: (input, nctx) => {
        const { message } = nctx.config as { message: string };
        return { out: input, message };
    },
};

/** subflow 运行回调（由引擎注入，避免 registry → engine 依赖）/ the subflow run callback (injected by the engine) */
export type SubflowRunner = (
    flowId: FlowId,
    input: Record<string, unknown>,
    nctx: NodeExecuteContext,
) => Promise<unknown>;

/**
 * subflow：flow 即节点，引用另一个 FlowId 递归组合。
 * The subflow type: a flow used as a node, referencing another FlowId for
 * recursive composition.
 */
export function createSubflowHandler(run: SubflowRunner): NodeHandler {
    return {
        type: 'subflow',
        version: 1,
        config: asConfig(z.object({ flow: z.string() })),
        execute: async (input, nctx) => {
            const { flow } = nctx.config as { flow: string };
            const result = await run(flow as FlowId, input, nctx);
            return { out: result };
        },
    };
}

/** 内置节点集合（服务装载时注册）/ the built-in handler set (registered when the service mounts) */
export function createBuiltinHandlers(runSubflow: SubflowRunner): NodeHandler[] {
    return [noopHandler, failHandler, echoHandler, createSubflowHandler(runSubflow)];
}

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
    const entry = deps.compiled.handlers.get(nodeId)!;
    // 运行期重解析：节点类型被卸载时得到 NODE_TYPE_NOT_FOUND / re-resolve at run time
    const handler = deps.registry.get(entry.type, entry.version);
    if (!handler) {
        throw flowError('NODE_TYPE_NOT_FOUND', `node "${nodeId}" references unregistered type "${entry.type}@${entry.version}"`, runRef(deps, nodeId));
    }
    const nctx: NodeExecuteContext = {
        ctx: kctx,
        flowId: deps.flowId as FlowId,
        runId: deps.runId as RunId,
        nodeId,
        attempt,
        config: deps.compiled.configs.get(nodeId),
        blackboard: deps.blackboard,
        signal,
    };
    return withTimeout(Promise.resolve(handler.execute(input, nctx)), defNode.timeout ?? deps.defaultTimeoutMs, nodeId, deps.flowId, signal);
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

/** 带超时与取消的执行：只有外部取消才拒绝；fail-fast 通知交给执行方自然落定 /
    Execute with timeout and cancellation: only an external cancel rejects; a fail-fast notice lets the work settle. */
function withTimeout<T>(work: Promise<T>, timeoutMs: number, nodeId: NodeId, flowId: string, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = timeoutMs > 0
            ? setTimeout(() => reject(flowError('NODE_TIMEOUT', `node "${nodeId}" timed out after ${timeoutMs}ms`, { flowId, nodeId })), timeoutMs)
            : undefined;
        const onAbort = (): void => {
            if (isExternalCancel(signal)) reject(flowError('FLOW_CANCELLED', 'cancelled', { flowId, nodeId }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        const cleanup = (): void => {
            if (timer !== undefined) clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
        };
        work.then(
            (value) => { cleanup(); resolve(value); },
            (cause) => { cleanup(); reject(cause); },
        );
    });
}
