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
import { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api';
import type {
    FlowApprovalAudit,
    FlowApprovalOutcome,
    FlowApprovalRequest,
    FlowBlackboard,
    FlowDefinition,
    FlowId,
    NodeExecuteContext,
    NodeId,
    NodeRegistry,
    RunId,
} from '@deepseek-ai/dsh-graph-flow-api';
import { assertNoReferenceCycle, createBuiltinHandlers, createRunner, NodeRegistryImpl } from './registry.js';
import {
    cancelledRunResult, compileFlow, createBlackboard, flowError, recoveredFailure, rejectedRunResult,
    runnerDeps, toFlowResult, toKernelGraph, toSlots,
} from './runtime.js';
import type { DriveEnv, OutcomePorts } from './runtime.js';
import type {
    CompiledFlow, FlowNodeRecord, FlowNodeStatus, FlowNodeStatusPayload, FlowRunDetail, FlowRunHandle, FlowRunOptions,
    FlowRunResult, FlowRunSummary, FlowStorage, FlowSummary, RunEntry,
} from './types.js';

/** 引擎服务令牌 / the engine service token */
export const FlowEngineToken = defineToken<FlowEngineService>('graphFlowEngine');
/** 存储能力令牌（由 flow-storage 提供，可选）/ the storage capability token (provided by flow-storage, optional) */
export const FlowStorageToken = defineToken<FlowStorage>('graphFlowStorage');

/** 已落定的节点状态：授权事件不得把它们翻回运行中 / settled node states; approval events must not reopen them */
const TERMINAL: ReadonlySet<FlowNodeStatus> = new Set(['completed', 'failed', 'skipped', 'cancelled']);

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
        // 内核中性状态事件 → flow 语义事件（补 flowId；错误收缩为可序列化面）。
        // 节点记录保留授权审计：内核每次状态迁移只重写状态字段，不能把审批事实丢掉。
        // Kernel neutral status event → flow semantic event (adds flowId; the
        // error shrinks to its serializable surface). The node record keeps the
        // approval audit: a kernel transition rewrites status fields only and
        // must not drop approval facts.
        ctx.on('graph/node-status', (payload) => {
            const entry = this.runs.get(payload.runId as RunId);
            if (entry === undefined) return;
            const previous = entry.nodes[payload.nodeId];
            const flow = this.flows.get(entry.flowId);
            const node = flow?.definition.nodes.find((candidate) => candidate.id === payload.nodeId);
            const recovered = payload.status === 'completed' && node?.onError === 'errorBranch'
                ? recoveredFailure(entry.blackboard, payload.nodeId as NodeId)
                : undefined;
            const record: FlowNodeRecord = { status: payload.status };
            if (payload.skipReason !== undefined) record.skipReason = payload.skipReason;
            if (payload.startedAt !== undefined) record.startedAt = payload.startedAt;
            if (payload.endedAt !== undefined) record.endedAt = payload.endedAt;
            if (payload.error) record.error = { code: payload.error.code, message: payload.error.message };
            if (recovered) record.recovered = recovered;
            if (previous?.approvals !== undefined) record.approvals = previous.approvals;
            entry.nodes[payload.nodeId] = record;
            this.projectNode(entry, payload.nodeId);
        });
        // 授权挂起/落定 → 节点状态与审计（等待中的请求把节点标成 awaiting-approval）
        // Approval pending/settled → node status and audit (a pending request
        // marks the node awaiting-approval).
        ctx.on('flow/approval-requested', (request) => {
            this.beginApproval(request);
        });
        ctx.on('flow/approval-decided', (payload) => {
            this.finishApproval(payload.request, payload.outcome);
        });
    }

    /** 广播一条节点的当前记录（状态 + 审计）/ broadcast one node's current record (status + audit) */
    private projectNode(entry: RunEntry, nodeId: string): void {
        const record = entry.nodes[nodeId];
        if (record === undefined) return;
        const payload: FlowNodeStatusPayload = {
            flowId: entry.flowId,
            runId: entry.runId,
            nodeId: nodeId as NodeId,
            status: record.status,
            ...record.skipReason === undefined ? {} : { skipReason: record.skipReason },
            ...record.error === undefined ? {} : { error: record.error },
            ...record.recovered === undefined ? {} : { recovered: record.recovered },
            ...record.approvals === undefined ? {} : { approvals: record.approvals },
            ...record.startedAt === undefined ? {} : { startedAt: record.startedAt },
            ...record.endedAt === undefined ? {} : { endedAt: record.endedAt },
        };
        this.ownerCtx.emit('flow/node-status', payload);
    }

    /** 请求挂起：节点进入可辨识的等待授权状态，保留已有的起止时间；同一尝试的多个并发请求都记入审计 / a request is pending: the node enters awaiting-approval, keeping its timestamps; concurrent requests of the same attempt are all audited */
    private beginApproval(request: FlowApprovalRequest): void {
        const entry = this.runs.get(request.runId);
        const record = entry?.nodes[request.nodeId];
        if (entry === undefined || record === undefined || TERMINAL.has(record.status)) return;
        record.status = 'awaiting-approval';
        record.approvals = [...(record.approvals ?? []), { request }];
        this.projectNode(entry, request.nodeId);
    }

    /** 请求落定：写回结果与回答者/时间；只要还有挂起请求就保持等待 / a request settled: write back the outcome with actor/time; stay waiting while another request is still open */
    private finishApproval(request: FlowApprovalRequest, outcome: FlowApprovalOutcome): void {
        const entry = this.runs.get(request.runId);
        const record = entry?.nodes[request.nodeId];
        if (entry === undefined || record === undefined) return;
        const current = record.approvals ?? [];
        if (!current.some((audit) => audit.request.id === request.id)) return;
        const approvals: FlowApprovalAudit[] = current.map((audit) =>
            audit.request.id === request.id ? { request, outcome } : audit);
        record.approvals = approvals;
        if (record.status === 'awaiting-approval') {
            record.status = approvals.some((audit) => audit.outcome === undefined) ? 'awaiting-approval' : 'running';
        }
        this.projectNode(entry, request.nodeId);
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
        const nodes: Record<string, FlowNodeRecord> = {};
        for (const node of compiled.definition.nodes) nodes[node.id] = { status: 'pending' };
        const entry: RunEntry = { flowId, runId, status: 'running', startedAt: Date.now(), ancestry, blackboard, nodes };
        this.runs.set(runId, entry);
        const outcomePorts: OutcomePorts = new Map();
        let kernelCancel: (() => void) | undefined;
        // cancel 可能先于内核启动到达：先记意愿，内核启动后转发 signal / cancel may arrive before the kernel starts
        let cancelRequested = false;
        // 可选能力：未装载 flow-approval 时节点授权面按 unavailable 拒绝（fail-closed 保留）
        // Optional capability: without flow-approval the node approval face
        // denies as unavailable (fail-closed stays intact).
        const approval = get(this.ownerCtx, FlowApprovalToken);
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
            ...approval === undefined ? {} : { approval },
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
        if (await this.ownerCtx.serial('flow/run-starting', payload)) {
            return this.finalize(compiled, entry, env.blackboard, rejectedRunResult(compiled, flowId, runId));
        }
        if (env.isCancelled()) return this.finalize(compiled, entry, env.blackboard, cancelledRunResult(compiled, flowId, runId));
        this.ownerCtx.emit('flow/run-start', payload);
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
        const approvals = new Map(
            Object.entries(entry.nodes).map(([id, record]) => [id, record.approvals] as const),
        );
        const result = toFlowResult(compiled, entry, blackboard, kernelResult);
        // 授权审计是 flow 层事实：内核结果只带状态/错误，这里把它合回最终节点记录。
        // Approval audit is a flow-layer fact: the kernel result carries only
        // status/error, so merge it back into the final node records.
        for (const [id, record] of Object.entries(result.nodes)) {
            const audit = approvals.get(id);
            if (audit !== undefined) record.approvals = audit;
        }
        entry.status = result.status;
        // 结果回写运行条目（getRun 面）：实时 nodes 与最终 result.nodes 同源
        // Write the result back onto the run entry (the getRun surface); live nodes and result.nodes share one source.
        entry.result = result;
        entry.nodes = result.nodes;
        this.ownerCtx.emit('flow/run-end', { flowId: entry.flowId, runId: entry.runId, status: result.status, output: result.output, blackboard: blackboard.snapshot() });
        try {
            await this.resolveStorage()?.saveRun(result);
        } catch (cause) {
            this.ownerCtx.logger.error('flow run persist failed / flow 运行持久化失败', cause);
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
