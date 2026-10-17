/**
 * @deepseek-ai/dsh-graph-core —— 通用有向无环图执行内核。
 *
 * @deepseek-ai/dsh-graph-core — the general-purpose DAG execution kernel.
 *
 * 导出内核服务（GraphKernelService）、run 子 context 上的状态上报令牌
 * （RunStatusToken）与全部中性类型。对业务零认知：flow/pipeline 等语义层
 * 通过注入 GraphKernel 能力并适配 GExecutor 来复用同一个内核。
 * Exports the kernel service (GraphKernelService), the status-reporting token
 * on the run child context (RunStatusToken) and all neutral types.
 * Business-agnostic: flow/pipeline layers reuse the same kernel by injecting
 * the GraphKernel capability and adapting a GExecutor.
 */

import { randomUUID } from 'node:crypto';
import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { defineToken, provideValue } from '@veren/core';
import { CANCEL_REASON, DEFAULT_CONCURRENCY, emitNodeStatus, isExternalCancel, RunStatusToken, schedule } from './scheduler.js';
import type { ScheduleEnv } from './scheduler.js';
import { graphError, GraphNodeError } from './errors.js';
import { validateGraph } from './validate.js';
import type { GraphErrorCode, GraphErrorFields } from './errors.js';
import type {
    GEdge,
    GExecutor,
    GNode,
    Graph,
    GraphFailureStrategy,
    GraphNodeRecord,
    GraphNodeStatus,
    GraphRunContext,
    GraphRunEndPayload,
    GraphRunEventMeta,
    GraphRunMeta,
    GraphRunResult,
    GraphRunStatus,
    GraphRunStatusService,
    GraphSkipReason,
} from './types.js';

export { graphError, GraphNodeError } from './errors.js';
export type { GraphErrorCode, GraphErrorFields } from './errors.js';
export { DEFAULT_CONCURRENCY, emitNodeStatus, isExternalCancel, RunStatusToken } from './scheduler.js';
export { assertEdgesAnchored, assertUniqueNodes, failedIds, reachableFrom, topoSort, validateGraph } from './validate.js';
export type {
    GEdge,
    GExecutor,
    GNode,
    Graph,
    GraphFailureStrategy,
    GraphNodeRecord,
    GraphNodeStatus,
    GraphNodeStatusPayload,
    GraphRunContext,
    GraphRunEndPayload,
    GraphRunEventMeta,
    GraphRunMeta,
    GraphRunResult,
    GraphRunStatus,
    GraphRunStatusService,
    GraphSkipReason,
} from './types.js';

/** 一次内核 run 的句柄：等待结果 + 主动取消 / handle of one kernel run: await the result and cancel */
export interface GraphRunHandle {
    readonly runId: string;
    readonly result: Promise<GraphRunResult>;
    /** 通知式取消：signal 只置位，执行方自愿响应 / cooperative cancel: the signal is set, executors opt in */
    cancel(): void;
}

/**
 * 运行一次图：校验 → 拦截启动 → 并发调度 → 事件与状态机 → 汇总结果。
 * Run one graph: validate → intercept start → concurrent scheduling → events
 * and status machine → aggregate the result.
 */
export function runGraph(
    graph: Graph,
    executor: GExecutor,
    options: { ctx: Context; runId?: string; concurrency?: number; onNodeFailure?: GraphFailureStrategy },
): GraphRunHandle {
    validateGraph(graph);
    const runId = options.runId ?? randomUUID();
    const controller = new AbortController();
    // run 子 context + 状态上报服务的独立作用域（并发 run 互不冲突）
    // The run child context plus an isolated scope for the status service (concurrent runs never collide).
    const runCtx = options.ctx
        .extend({ graphId: graph.id, runId, signal: controller.signal })
        .isolate(RunStatusToken, Symbol(runId)) as GraphRunContext;
    const records: Record<string, GraphNodeRecord> = Object.fromEntries(
        graph.nodes.map((node) => [node.id, { id: node.id, status: 'pending' }]),
    );
    const status: GraphRunStatusService = {
        setStatus: (nodeId, nodeStatus, patch) => {
            Object.assign(records[nodeId]!, patch, { status: nodeStatus });
            emitNodeStatus(runCtx, records[nodeId]!);
        },
    };
    const disposeStatus = provideValue(runCtx, RunStatusToken, status);
    const env: ScheduleEnv = {
        runCtx,
        records,
        runId,
        controller,
        concurrency: Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY),
        strategy: options.onNodeFailure ?? (() => 'failFast'),
    };
    const result = schedule(graph, executor, env).finally(disposeStatus);
    return { runId, result, cancel: () => controller.abort(CANCEL_REASON) };
}

/** 内核服务令牌：语义层注入它以复用内核 / the kernel service token; semantic layers inject it to reuse the kernel */
export const GraphKernelToken = defineToken<GraphKernelService>('graphKernel');

/** 内核配置（schemastery 校验）/ the kernel config (validated with schemastery) */
export interface GraphKernelConfig {
    /** 就绪集并发上限 / ready-set concurrency cap */
    concurrency: number;
}

/** 插件配置 schema / the plugin config schema */
export const Config: z<GraphKernelConfig> = z.object({
    concurrency: z.number().min(1).default(DEFAULT_CONCURRENCY),
});

/**
 * 内核服务：构造即以 GraphKernelToken 注册，随 fiber 卸载注销。
 * run() 把服务配置作为并发上限缺省值，其余调度语义与 runGraph 一致。
 * The kernel service: constructing registers it under GraphKernelToken and it
 * unregisters with its fiber. run() uses the service config as the default
 * concurrency cap; scheduling semantics match runGraph.
 */
export class GraphKernelService extends Service {
    constructor(
        ctx: Context,
        /** 本实例的归一化配置 / the normalized config of this instance */
        readonly config: GraphKernelConfig = { concurrency: DEFAULT_CONCURRENCY },
    ) {
        super(ctx, GraphKernelToken);
    }

    /** 校验图并运行；返回可取消的句柄 / validate and run the graph; returns a cancellable handle */
    run(
        graph: Graph,
        executor: GExecutor,
        options: { runId?: string; concurrency?: number; onNodeFailure?: GraphFailureStrategy } = {},
    ): GraphRunHandle {
        return runGraph(graph, executor, { ctx: this.ctx, concurrency: this.config.concurrency, ...options });
    }

    /** 只校验不运行（注册期 fail loud 用）/ validate without running (for loud registration-time checks) */
    validate(graph: Graph): string[] {
        return validateGraph(graph);
    }
}

/** 插件名（即服务令牌）/ the plugin name (the service token) */
export const name = GraphKernelToken;
/** 无依赖 / no injected capabilities */
export const inject = [] as const;
/** 提供 GraphKernel 能力 / provides the GraphKernel capability */
export const provide = [GraphKernelToken] as const;

/** 插件入口：构造即注册（Service 随 fiber 卸载自动注销）/ the plugin entry: constructing registers the service; it unloads with its fiber */
export const apply = (ctx: Context, config: GraphKernelConfig) => {
    new GraphKernelService(ctx, config);
};
