/**
 * flow 引擎服务：注册/注销 FlowDefinition、启动运行（RunHandle）、运行清单；
 * 存储经可选注入的 FlowStorage 能力；子流程递归运行期防护。
 * The flow engine service: register/unregister flows, start runs (RunHandle),
 * list runs; storage via the optional FlowStorage capability; runtime subflow
 * recursion guarded (FLOW_REFERENCE_CYCLE).
 */

import { randomUUID } from 'node:crypto';
import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { defineToken, get } from '@veren/core';
import type { GraphKernelService, GraphRunResult } from '@deepseek-ai/dsh-graph-core';
import { isExternalCancel } from '@deepseek-ai/dsh-graph-core';
import type { FlowBlackboard, FlowDefinition, FlowId, NodeExecuteContext, NodeId, NodeRegistry, RunId } from '@deepseek-ai/dsh-graph-flow-api';
import { createBuiltinHandlers, createRunner, NodeRegistryImpl } from './registry.js';
import {
    cancelledRunResult, compileFlow, createBlackboard, flowError, rejectedRunResult,
    runnerDeps, toFlowResult, toKernelGraph, toSlots,
} from './runtime.js';
import type { DriveEnv, OutcomePorts } from './runtime.js';
import type {
    CompiledFlow, FlowRunDetail, FlowRunHandle, FlowRunOptions,
    FlowRunResult, FlowRunSummary, FlowStorage, FlowSummary, RunEntry,
} from './types.js';

/** 引擎服务令牌 / the engine service token */
export const FlowEngineToken = defineToken<FlowEngineService>('graphFlowEngine');
/** 存储能力令牌（由 flow-storage 提供，可选）/ the storage capability token (provided by flow-storage, optional) */
export const FlowStorageToken = defineToken<FlowStorage>('graphFlowStorage');

/** 引擎配置 / the engine config */
export interface FlowEngineConfig {
    /** 默认节点超时（毫秒）/ the default per-node timeout (ms) */
    nodeTimeoutMs: number;
}

/** 插件配置 schema / the plugin config schema */
export const Config: z<FlowEngineConfig> = z.object({ nodeTimeoutMs: z.number().min(0).default(30_000) });

export class FlowEngineService extends Service {
    private readonly flows = new Map<FlowId, CompiledFlow>();
    private readonly runs = new Map<RunId, RunEntry>();

    constructor(
        ctx: Context,
        /** 归一化配置 / the normalized config */
        readonly config: FlowEngineConfig = { nodeTimeoutMs: 30_000 },
        /** 内核能力 / the kernel capability */
        private readonly kernel: GraphKernelService,
        /** 节点类型注册表（引擎默认提供实现）/ the node-type registry (the engine provides the default) */
        private readonly registry: NodeRegistry = new NodeRegistryImpl(),
        /** 可选存储能力（装载时快照；晚到能力按次解析）/ the optional storage capability (snapshot at mount; late capabilities resolve per use) */
        private readonly storageCapability?: FlowStorage,
    ) {
        super(ctx, FlowEngineToken);
        // 内置节点随引擎 fiber 卸载逆序注销 / built-ins unregister in reverse order with the engine fiber
        ctx.effect(
            () => createBuiltinHandlers(this.runSubflow).map((handler) => this.registry.register(handler)),
            'flow-builtin-nodes',
        );
        // waterfall 改写同步：引擎监听器位于链最外层，next() 返回（全部加工
        // 完成后）再把最终产出覆盖黑板 slot。/ The engine listener is the
        // outermost link; after next() returns it writes the final output back.
        ctx.on('graph/node-post-execute', (meta, envelope, next) => {
            const final = next();
            const entry = this.runs.get(meta.runId as RunId);
            if (entry?.blackboard && meta.nodeId !== undefined) {
                for (const [slot, value] of Object.entries(toSlots(final ?? envelope.output))) entry.blackboard.write(meta.nodeId, slot, value);
            }
            return final;
        });
        // 内核中性状态事件 → flow 语义事件（补 flowId；错误收缩为可序列化面）
        // Kernel neutral status event → flow semantic event (adds flowId; the
        // error shrinks to its serializable surface).
        ctx.on('graph/node-status', (payload) => {
            this.ctx.emit('flow/node-status', {
                flowId: payload.graphId as FlowId,
                runId: payload.runId as RunId,
                nodeId: payload.nodeId as NodeId,
                status: payload.status,
                skipReason: payload.skipReason,
                error: payload.error ? { code: payload.error.code, message: payload.error.message } : undefined,
                startedAt: payload.startedAt,
                endedAt: payload.endedAt,
            });
        });
    }

    /**
     * 解析存储能力：可选能力可能晚于引擎装载到达（flow-storage 的异步
     * effect），因此每次使用时重新解析，而不是在 apply 时快照成 undefined。
     * Resolve the storage capability per use: the optional capability can arrive
     * after the engine mounts (flow-storage's async effect), so a snapshot taken
     * at apply time would silently stay undefined.
     */
    private resolveStorage(): FlowStorage | undefined {
        return this.storageCapability ?? get(this.ctx, FlowStorageToken);
    }

    /** 注册一个 flow：先编译 fail loud，再做引用环检测 / register a flow: compile loudly first, then check reference cycles */
    async registerFlow(definition: FlowDefinition): Promise<void> {
        const compiled = compileFlow(definition, this.registry);
        this.assertNoReferenceCycle(compiled);
        this.flows.set(definition.id, compiled);
        await this.resolveStorage()?.saveFlow(definition);
    }

    /** 注销一个 flow / unregister a flow */
    async unregisterFlow(flowId: FlowId): Promise<void> {
        this.flows.delete(flowId);
        await this.resolveStorage()?.deleteFlow(flowId);
    }

    hasFlow(flowId: FlowId): boolean {
        return this.flows.has(flowId);
    }

    /** 取已注册 flow 的原始定义（画布/CLI 投影用）/ the registered definition (for canvas/CLI projection) */
    getFlow(flowId: FlowId): FlowDefinition | undefined {
        return this.flows.get(flowId)?.definition;
    }

    /** 已注册 flow 摘要，按 id 升序（清单面稳定，便于模型/UI 消费）/ registered-flow summaries sorted by id */
    listFlows(): FlowSummary[] {
        return [...this.flows.values()]
            .map((compiled) => ({
                id: compiled.definition.id,
                nodes: compiled.definition.nodes.length,
                edges: compiled.definition.edges.length,
                outputs: Object.keys(compiled.definition.output ?? {}),
            }))
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    /** 按 runId 查运行详情；运行中只有状态，完成后带结果 / one run by id: status while running, result once finished */
    getRun(runId: RunId): FlowRunDetail | undefined {
        const entry = this.runs.get(runId);
        if (entry === undefined) return undefined;
        return { flowId: entry.flowId, runId: entry.runId, status: entry.status, startedAt: entry.startedAt, result: entry.result };
    }

    /** flow 引用图 DFS 找环 / find reference cycles in the flow reference graph */
    private assertNoReferenceCycle(compiled: CompiledFlow): void {
        const graph = new Map<FlowId, readonly FlowId[]>();
        for (const [id, flow] of this.flows) {
            if (id !== compiled.definition.id) graph.set(id, flow.references);
        }
        graph.set(compiled.definition.id, compiled.references);
        const visiting = new Set<FlowId>();
        const done = new Set<FlowId>();
        const stack: FlowId[] = [];
        const visit = (id: FlowId): void => {
            if (visiting.has(id)) {
                const start = Math.max(0, stack.indexOf(id));
                throw flowError('FLOW_REFERENCE_CYCLE', `flow reference cycle: ${[...stack.slice(start), id].join(' -> ')}`, { flowId: id });
            }
            if (done.has(id)) return;
            visiting.add(id);
            stack.push(id);
            for (const next of graph.get(id) ?? []) visit(next);
            stack.pop();
            visiting.delete(id);
            done.add(id);
        };
        for (const id of graph.keys()) visit(id);
    }

    /** 启动一次运行（非阻塞）；入参经 Start 签名校验 / start one run (non-blocking); input validated via the Start signature */
    run(flowId: FlowId, options: FlowRunOptions = {}): FlowRunHandle {
        return this.startRun(flowId, options, [flowId]);
    }

    /** 启动一次运行并记录祖先链（subflow 递归防护用）/ start a run and record its ancestor chain (subflow guard) */
    private startRun(flowId: FlowId, options: FlowRunOptions, ancestry: readonly FlowId[]): FlowRunHandle {
        const compiled = this.flows.get(flowId);
        if (!compiled) throw flowError('FLOW_NOT_FOUND', `flow "${flowId}" is not registered`, { flowId });
        let input = options.input ?? {};
        if (compiled.definition.input) {
            try {
                input = compiled.definition.input(input) as Record<string, unknown>;
            } catch (cause) {
                throw flowError('NODE_CONFIG_INVALID', `flow "${flowId}" input validation failed`, { flowId, cause });
            }
        }
        const runId = randomUUID() as RunId;
        const blackboard = createBlackboard();
        const entry: RunEntry = { flowId, runId, status: 'running', startedAt: Date.now(), ancestry, blackboard };
        this.runs.set(runId, entry);
        const outcomePorts: OutcomePorts = new Map();
        let kernelCancel: (() => void) | undefined;
        // cancel 可能先于内核启动到达：先记意愿，内核启动后转发 signal / cancel may arrive before the kernel starts
        let cancelRequested = false;
        const promise = this.drive(compiled, entry, {
            input,
            mocks: options.mocks,
            blackboard,
            outcomePorts,
            isCancelled: () => cancelRequested,
            setCancel: (cancel) => {
                kernelCancel = cancel;
                if (cancelRequested) cancel();
            },
        });
        return {
            flowId,
            runId,
            status: () => entry.status,
            cancel: () => {
                cancelRequested = true;
                kernelCancel?.();
            },
            awaitCompletion: () => promise,
        };
    }

    /** 运行主体：flow 拦截 → 内核调度 → 落盘与事件 / the run body: flow intercept → kernel scheduling → persistence and events */
    private async drive(compiled: CompiledFlow, entry: RunEntry, env: DriveEnv): Promise<FlowRunResult> {
        const { flowId, runId } = entry;
        const payload = { flowId, runId, input: env.input };
        if (env.isCancelled()) return this.finalize(compiled, entry, env.blackboard, cancelledRunResult(compiled, flowId, runId));
        if (await this.ctx.serial('flow/run-starting', payload)) {
            return this.finalize(compiled, entry, env.blackboard, rejectedRunResult(compiled, flowId, runId));
        }
        if (env.isCancelled()) return this.finalize(compiled, entry, env.blackboard, cancelledRunResult(compiled, flowId, runId));
        this.ctx.emit('flow/run-start', payload);
        const graph = toKernelGraph(compiled, env.blackboard, env.outcomePorts);
        const deps = runnerDeps(compiled, entry, env, this.registry, this.config.nodeTimeoutMs);
        const handle = this.kernel.run(graph, createRunner(deps), { runId });
        env.setCancel(() => handle.cancel());
        return this.finalize(compiled, entry, env.blackboard, await handle.result);
    }

    /** 汇总结果：输出变量、节点记录、事件与持久化 / aggregate the result: output vars, node records, events, persistence */
    private async finalize(
        compiled: CompiledFlow,
        entry: RunEntry,
        blackboard: FlowBlackboard,
        kernelResult: GraphRunResult,
    ): Promise<FlowRunResult> {
        const result = toFlowResult(compiled, entry, blackboard, kernelResult);
        entry.status = result.status;
        // 结果回写运行条目（getRun 面）：内存随运行清单一起增长，与 listRuns 同生命周期
        // Write the result back onto the run entry (the getRun surface); it lives as long as the run list.
        entry.result = result;
        this.ctx.emit('flow/run-end', { flowId: entry.flowId, runId: entry.runId, status: result.status, output: result.output, blackboard: blackboard.snapshot() });
        try {
            await this.resolveStorage()?.saveRun(result);
        } catch (cause) {
            this.ctx.logger.error('flow run persist failed / flow 运行持久化失败', cause);
        }
        return result;
    }

    listRuns(): FlowRunSummary[] {
        return [...this.runs.values()]
            .sort((a, b) => a.startedAt - b.startedAt)
            .map(({ flowId, runId, status, startedAt }) => ({ flowId, runId, status, startedAt }));
    }

    /**
     * subflow 回调：按 run 的祖先链做递归防护（不是引擎级全局集合，
     * 否则同一子 flow 的并行引用会互相误伤），并传播父级取消。
     * The subflow callback: the recursion guard walks the run's own ancestor
     * chain (an engine-global set would make parallel references to the same
     * child flow collide) and propagates the parent cancel.
     */
    private runSubflow = async (flowId: FlowId, input: Record<string, unknown>, nctx: NodeExecuteContext): Promise<unknown> => {
        const ancestry = this.runs.get(nctx.runId)?.ancestry ?? [];
        if (ancestry.includes(flowId)) {
            throw flowError('FLOW_REFERENCE_CYCLE', `recursive subflow reference to "${flowId}" at runtime`, { flowId, nodeId: nctx.nodeId });
        }
        const handle = this.startRun(flowId, { input }, [...ancestry, flowId]);
        // 只有外部取消才取消子 flow；fail-fast 只是通知，子 flow 必须自然落定
        // Only an external cancel cancels the child run; a fail-fast notice lets it settle naturally.
        const onAbort = (): void => {
            if (isExternalCancel(nctx.signal)) handle.cancel();
        };
        if (isExternalCancel(nctx.signal)) handle.cancel();
        else nctx.signal.addEventListener('abort', onAbort, { once: true });
        try {
            const result = await handle.awaitCompletion();
            if (result.status !== 'completed') {
                throw flowError('NODE_FAILED', `subflow "${flowId}" ended with status ${result.status}`, {
                    flowId, runId: nctx.runId, nodeId: nctx.nodeId,
                });
            }
            return result;
        } finally {
            nctx.signal.removeEventListener('abort', onAbort);
        }
    };
}
