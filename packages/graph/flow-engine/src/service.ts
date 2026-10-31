/**
 * flow 引擎服务：注册/注销 FlowDefinition、启动运行（RunHandle）、运行清单；
 * 存储经可选注入的 FlowStorage 能力；子流程递归运行期防护。
 * The flow engine service: register/unregister flows, start runs (RunHandle),
 * list runs; storage via the optional FlowStorage capability; runtime subflow
 * recursion guarded (FLOW_REFERENCE_CYCLE).
 *
 * 本文件是服务装配入口：授权审计、事件接线与运行驱动拆分在各自模块
 * （approval-audit / engine-events / run-driver）。
 * This file is the service assembly entry: the approval audit, the event
 * wiring and the run driver live in their own modules (approval-audit /
 * engine-events / run-driver).
 */

import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { defineToken, get } from '@veren/core';
import type { GraphKernelService } from '@deepseek-ai/dsh-graph-core';
import type {
    FlowDefinition,
    FlowId,
    NodeExecuteContext,
    NodeRegistry,
    RunId,
} from '@deepseek-ai/dsh-graph-flow-api';
import { assertNoReferenceCycle, createBuiltinHandlers, NodeRegistryImpl } from './registry.js';
import { compileFlow } from './runtime.js';
import { wireEngineEvents } from './engine-events.js';
import { runSubflow, startEngineRun } from './run-driver.js';
import type { EngineRunPorts } from './run-driver.js';
import type {
    CompiledFlow,
    FlowEngine,
    FlowRunDetail,
    FlowRunHandle,
    FlowRunOptions,
    FlowRunSummary,
    FlowStorage,
    FlowSummary,
    RunEntry,
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

export class FlowEngineService extends Service implements FlowEngine {
    private readonly flows = new Map<FlowId, CompiledFlow>();
    private readonly runs = new Map<RunId, RunEntry>();
    /**
     * The context that owns this engine's events.
     *
     * Cordis rebinds `this.ctx` to the caller when a Remote/child context calls
     * a service view. Emitting `flow/node-status` on that transient context
     * makes a canvas projection listening on the service's owner context miss
     * every change. Emit on the construction context instead.
     *
     * 引擎事件所属的 context。Cordis 在 Remote/子 context 调用服务视图时把 `this.ctx`
     * 重绑到调用方；在该瞬态 context 上 emit `flow/node-status`，会让监听服务归属
     * context 的画布投影漏掉所有变更。改为在构造 context 上 emit。
     */
    private readonly ownerCtx: Context;

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
        this.ownerCtx = ctx;
        // 内置节点随引擎 fiber 卸载逆序注销 / built-ins unregister in reverse order with the engine fiber
        ctx.effect(
            () => createBuiltinHandlers(this.subflowRunner()).map((handler) => this.registry.register(handler)),
            'flow-builtin-nodes',
        );
        // 事件接线（内核状态 / waterfall 改写 / 授权挂起与落定）集中在一个模块。
        // The event wiring (kernel status / waterfall rewrite / approval
        // pending & settled) lives in one module.
        wireEngineEvents(this.ports());
    }

    /** 引擎状态与能力的只读端口面（驱动器/事件接线共用）/ the read-only ports face shared by the driver and the event wiring */
    private ports(): EngineRunPorts {
        return {
            flows: this.flows,
            runs: this.runs,
            ownerCtx: this.ownerCtx,
            kernel: this.kernel,
            registry: this.registry,
            nodeTimeoutMs: this.config.nodeTimeoutMs,
            resolveStorage: () => this.resolveStorage(),
        };
    }

    /** subflow 回调绑定本引擎端口 / bind the subflow callback to this engine's ports */
    private subflowRunner(): (flowId: FlowId, input: Record<string, unknown>, nctx: NodeExecuteContext) => Promise<unknown> {
        return (flowId, input, nctx) => runSubflow(this.ports(), flowId, input, nctx);
    }

    /**
     * 解析存储能力：可选能力可能晚于引擎装载到达（flow-storage 的异步
     * effect），因此每次使用时重新解析，而不是在 apply 时快照成 undefined。
     * Resolve the storage capability per use: the optional capability can arrive
     * after the engine mounts (flow-storage's async effect), so a snapshot taken
     * at apply time would silently stay undefined.
     */
    private resolveStorage(): FlowStorage | undefined {
        return this.storageCapability ?? get(this.ownerCtx, FlowStorageToken);
    }

    /** 注册一个 flow：先编译 fail loud，再做引用环检测 / register a flow: compile loudly first, then check reference cycles */
    async registerFlow(definition: FlowDefinition): Promise<void> {
        const compiled = compileFlow(definition, this.registry);
        assertNoReferenceCycle(this.flows, compiled);
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

    /** 按 runId 查运行详情；运行中带实时逐节点状态，完成后带结果 / one run by id: live node states while running, result when finished */
    getRun(runId: RunId): FlowRunDetail | undefined {
        const entry = this.runs.get(runId);
        if (entry === undefined) return undefined;
        const nodes = Object.fromEntries(Object.entries(entry.nodes).map(([id, record]) => [id, { ...record }]));
        return { flowId: entry.flowId, runId: entry.runId, status: entry.status, startedAt: entry.startedAt, nodes, result: entry.result };
    }

    /** 启动一次运行（非阻塞）；入参经 Start 签名校验 / start one run (non-blocking); input validated via the Start signature */
    run(flowId: FlowId, options: FlowRunOptions = {}): FlowRunHandle {
        return startEngineRun(this.ports(), flowId, options, [flowId]);
    }

    listRuns(): FlowRunSummary[] {
        return [...this.runs.values()]
            .sort((a, b) => a.startedAt - b.startedAt)
            .map(({ flowId, runId, status, startedAt }) => ({ flowId, runId, status, startedAt }));
    }
}
