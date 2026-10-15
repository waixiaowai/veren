/**
 * flow 引擎服务：注册/注销 FlowDefinition、启动运行（RunHandle）、运行清单。
 * 引擎不直接碰存储——通过可选注入的 FlowStorage 能力持久化；子流程递归由
 * 运行期活跃引用集合防护（FLOW_REFERENCE_CYCLE）。
 *
 * The flow engine service: register/unregister FlowDefinitions, start runs
 * (RunHandle), list runs. The engine never touches storage directly — it
 * persists through the optionally injected FlowStorage capability; runtime
 * subflow recursion is guarded by an active-reference set
 * (FLOW_REFERENCE_CYCLE).
 */

import { randomUUID } from 'node:crypto';
import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { defineToken } from '@veren/core';
import type { GraphKernelService, GraphRunContext, GraphRunResult } from '@veren/graph-core';
import type { FlowBlackboard, FlowDefinition, FlowId, NodeExecuteContext, NodeId, NodeRegistry, RunId } from '@veren/graph-flow-api';
import { createBuiltinHandlers, NodeRegistryImpl } from './registry.js';
import { compileFlow, createBlackboard, createRunner, flowError, resolveInputValue, toSlots } from './runtime.js';
import type { OutcomePorts } from './runtime.js';
import type {
    CompiledFlow,
    FlowNodeDefMap,
    FlowNodeRecord,
    FlowRunHandle,
    FlowRunOptions,
    FlowRunResult,
    FlowRunStatus,
    FlowRunSummary,
    FlowStorage,
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
export const Config: z<FlowEngineConfig> = z.object({
    nodeTimeoutMs: z.number().min(0).default(30_000),
});

/** 引擎内存中的运行条目 / the in-memory run entry */
interface RunEntry {
    flowId: FlowId;
    runId: RunId;
    status: FlowRunStatus;
    startedAt: number;
    /** 该 run 的黑板（waterfall 改写同步用）/ the run's blackboard (waterfall rewrite sync) */
    blackboard?: FlowBlackboard;
}

export class FlowEngineService extends Service {
    private readonly flows = new Map<FlowId, CompiledFlow>();
    private readonly runs = new Map<RunId, RunEntry>();
    private readonly activeRefs = new Set<FlowId>();

    constructor(
        ctx: Context,
        /** 归一化配置 / the normalized config */
        readonly config: FlowEngineConfig = { nodeTimeoutMs: 30_000 },
        /** 内核能力 / the kernel capability */
        private readonly kernel: GraphKernelService,
        /** 节点类型注册表（引擎默认提供实现）/ the node-type registry (the engine provides the default) */
        private readonly registry: NodeRegistry = new NodeRegistryImpl(),
        /** 可选存储能力 / the optional storage capability */
        private readonly storage?: FlowStorage,
    ) {
        super(ctx, FlowEngineToken);
        // 内置节点随引擎 fiber 卸载逆序注销 / built-ins unregister in reverse order with the engine fiber
        ctx.effect(
            () => createBuiltinHandlers(this.runSubflow).map((handler) => this.registry.register(handler)),
            'flow-builtin-nodes',
        );
        // waterfall 改写同步：引擎监听器位于链最外层，next() 返回（全部加工
        // 完成后）再把最终产出覆盖黑板 slot。
        // Waterfall rewrite sync: the engine listener is the outermost link; after
        // next() returns (all rewrites applied) it writes the final output back.
        ctx.on('graph/node-post-execute', (meta, envelope, next) => {
            const final = next();
            const entry = this.runs.get(meta.runId as RunId);
            if (entry?.blackboard && meta.nodeId !== undefined) {
                for (const [slot, value] of Object.entries(toSlots(final ?? envelope.output))) {
                    entry.blackboard.write(meta.nodeId, slot, value);
                }
            }
            return final;
        });
    }

    /** 注册一个 flow：先编译 fail loud，再做引用环检测 / register a flow: compile loudly first, then check reference cycles */
    async registerFlow(definition: FlowDefinition): Promise<void> {
        const compiled = compileFlow(definition, this.registry);
        this.assertNoReferenceCycle(compiled);
        this.flows.set(definition.id, compiled);
        await this.storage?.saveFlow(definition);
    }

    /** 注销一个 flow / unregister a flow */
    async unregisterFlow(flowId: FlowId): Promise<void> {
        this.flows.delete(flowId);
        await this.storage?.deleteFlow(flowId);
    }

    hasFlow(flowId: FlowId): boolean {
        return this.flows.has(flowId);
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
                throw flowError('FLOW_REFERENCE_CYCLE', `flow reference cycle: ${[...stack.slice(start), id].join(' -> ')}`, {
                    flowId: id,
                });
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

    /** 启动一次运行（非阻塞）/ start one run (non-blocking) */
    run(flowId: FlowId, options: FlowRunOptions = {}): FlowRunHandle {
        const compiled = this.flows.get(flowId);
        if (!compiled) throw flowError('FLOW_NOT_FOUND', `flow "${flowId}" is not registered`, { flowId });
        const input = this.validateInput(compiled, options.input ?? {});
        const runId = randomUUID() as RunId;
        const entry: RunEntry = { flowId, runId, status: 'running', startedAt: Date.now() };
        this.runs.set(runId, entry);
        const blackboard = createBlackboard();
        entry.blackboard = blackboard;
        const outcomePorts: OutcomePorts = new Map();
        let kernelCancel: (() => void) | undefined;
        // cancel 可能先于内核启动到达：先记意愿，内核启动后再转发 signal
        // cancel may arrive before the kernel starts: record the intent first, forward the signal once started
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

    /** 入参校验（Start 签名）/ validate the run input (the Start signature) */
    private validateInput(compiled: CompiledFlow, input: Record<string, unknown>): Record<string, unknown> {
        const schema = compiled.definition.input;
        if (!schema) return input;
        try {
            return schema(input) as Record<string, unknown>;
        } catch (cause) {
            throw flowError('NODE_CONFIG_INVALID', `flow "${compiled.definition.id}" input validation failed`, {
                flowId: compiled.definition.id,
                cause,
            });
        }
    }

    /** 运行主体：flow 拦截 → 内核调度 → 落盘与事件 / the run body: flow intercept → kernel scheduling → persistence and events */
    private async drive(
        compiled: CompiledFlow,
        entry: RunEntry,
        env: {
            input: Record<string, unknown>;
            mocks?: Record<NodeId, unknown>;
            blackboard: FlowBlackboard;
            outcomePorts: OutcomePorts;
            isCancelled: () => boolean;
            setCancel: (cancel: () => void) => void;
        },
    ): Promise<FlowRunResult> {
        const { flowId, runId } = entry;
        const payload = { flowId, runId, input: env.input };
        const nodesCancelled = (): GraphRunResult => ({
            graphId: flowId,
            runId,
            status: 'cancelled',
            nodes: Object.fromEntries(
                compiled.definition.nodes.map((node) => [node.id, { id: node.id, status: 'cancelled', skipReason: 'upstream-cancel' }]),
            ),
        });
        if (env.isCancelled()) return this.finalize(compiled, entry, env.blackboard, nodesCancelled());
        if (await this.ctx.serial('flow/run-starting', payload)) {
            return this.finalize(compiled, entry, env.blackboard, {
                graphId: flowId,
                runId,
                status: 'cancelled',
                nodes: Object.fromEntries(
                    compiled.definition.nodes.map((node) => [node.id, { id: node.id, status: 'skipped', skipReason: 'run-rejected' }]),
                ),
            });
        }
        if (env.isCancelled()) return this.finalize(compiled, entry, env.blackboard, nodesCancelled());
        this.ctx.emit('flow/run-start', payload);
        const graph = this.toKernelGraph(compiled, env.blackboard, env.outcomePorts);
        const handle = this.kernel.run(graph, createRunner(this.runnerDeps(compiled, entry, env)), { runId });
        env.setCancel(() => handle.cancel());
        return this.finalize(compiled, entry, env.blackboard, await handle.result);
    }

    /** flow 图 → 内核图：边条件组合端口结论与声明谓词 / flow graph → kernel graph: edge conditions combine outcome ports and declared predicates */
    private toKernelGraph(compiled: CompiledFlow, blackboard: FlowBlackboard, outcomePorts: OutcomePorts) {
        const definition = compiled.definition;
        return {
            id: definition.id,
            nodes: definition.nodes.map((node) => ({ id: node.id })),
            edges: definition.edges.map((edge) => ({
                from: edge.from,
                to: edge.to,
                when: (kctx: GraphRunContext) => {
                    const ports = outcomePorts.get(edge.from);
                    if (edge.port) return ports?.has(edge.port) ?? false;
                    // 默认输出在 error 端口被激活时关闭 / the default output closes once the error port activates
                    if (ports?.has('error')) return false;
                    return edge.when ? edge.when(blackboard, kctx) : true;
                },
            })),
        };
    }

    /** 组装执行器依赖 / assemble the runner dependencies */
    private runnerDeps(
        compiled: CompiledFlow,
        entry: RunEntry,
        env: { mocks?: Record<NodeId, unknown>; blackboard: FlowBlackboard; outcomePorts: OutcomePorts },
    ) {
        const nodeDefs: FlowNodeDefMap = new Map(compiled.definition.nodes.map((node) => [node.id, node]));
        return {
            flowId: entry.flowId,
            runId: entry.runId,
            nodeDefs,
            compiled,
            registry: this.registry,
            blackboard: env.blackboard,
            outcomePorts: env.outcomePorts,
            mocks: env.mocks,
            defaultTimeoutMs: this.config.nodeTimeoutMs,
        };
    }

    /** 汇总结果：输出变量、节点记录、事件与持久化 / aggregate the result: output vars, node records, events, persistence */
    private async finalize(
        compiled: CompiledFlow,
        entry: RunEntry,
        blackboard: FlowBlackboard,
        kernelResult: GraphRunResult,
    ): Promise<FlowRunResult> {
        const nodes: Record<string, FlowNodeRecord> = Object.fromEntries(
            Object.entries(kernelResult.nodes).map(([id, record]) => [id, {
                status: record.status,
                skipReason: record.skipReason,
                startedAt: record.startedAt,
                endedAt: record.endedAt,
                error: record.error ? { code: record.error.code, message: record.error.message } : undefined,
                output: record.output,
            }]),
        );
        const output: Record<string, unknown> = {};
        for (const [name, ref] of Object.entries(compiled.definition.output ?? {})) {
            output[name] = resolveInputValue(ref, blackboard);
        }
        const failure = Object.values(kernelResult.nodes).find((record) => record.error);
        const status = kernelResult.status;
        const result: FlowRunResult = {
            flowId: entry.flowId,
            runId: entry.runId,
            status,
            output,
            nodes,
            error: failure ? { code: failure.error!.code, message: failure.error!.message } : undefined,
        };
        entry.status = status;
        this.ctx.emit('flow/run-end', {
            flowId: entry.flowId,
            runId: entry.runId,
            status,
            output,
            blackboard: blackboard.snapshot(),
        });
        try {
            await this.storage?.saveRun(result);
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

    /** subflow 回调：递归防护 + 父级取消传播 / the subflow callback: recursion guard + parent cancel propagation */
    private runSubflow = async (flowId: FlowId, input: Record<string, unknown>, nctx: NodeExecuteContext): Promise<unknown> => {
        if (this.activeRefs.has(flowId)) {
            throw flowError('FLOW_REFERENCE_CYCLE', `recursive subflow reference to "${flowId}" at runtime`, {
                flowId,
                nodeId: nctx.nodeId,
            });
        }
        this.activeRefs.add(flowId);
        try {
            const handle = this.run(flowId, { input });
            const onAbort = () => handle.cancel();
            nctx.signal.addEventListener('abort', onAbort, { once: true });
            try {
                const result = await handle.awaitCompletion();
                if (result.status !== 'completed') {
                    throw flowError('NODE_FAILED', `subflow "${flowId}" ended with status ${result.status}`, {
                        flowId,
                        runId: nctx.runId,
                        nodeId: nctx.nodeId,
                    });
                }
                return result;
            } finally {
                nctx.signal.removeEventListener('abort', onAbort);
            }
        } finally {
            this.activeRefs.delete(flowId);
        }
    };
}
