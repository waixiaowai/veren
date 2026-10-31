/**
 * The run driver: starts runs (validating input through the flow's Start
 * signature), drives the kernel, finalizes results (merging the approval audit
 * back, emitting flow/run-end, persisting), and runs subflows with a per-run
 * recursion guard.
 *
 * 运行驱动器：启动运行（入参经 Start 签名校验）、驱动内核、汇总结果（合回授权审计、
 * 发 flow/run-end、落盘），并以 per-run 递归防护运行 subflow。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/run-driver
 */

import { randomUUID } from 'node:crypto';
import { isExternalCancel } from '@deepseek-ai/dsh-graph-core';
import type { GraphKernelService, GraphRunResult } from '@deepseek-ai/dsh-graph-core';
import { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api';
import type {
    FlowBlackboard,
    FlowId,
    NodeExecuteContext,
    NodeId,
    NodeRegistry,
    RunId,
} from '@deepseek-ai/dsh-graph-flow-api';
import { get } from '@veren/core';
import type { Context } from '@deepseek-ai/cordis';
import { createBlackboard } from './blackboard.js';
import { flowError } from './flow-error.js';
import {
    cancelledRunResult,
    rejectedRunResult,
    toFlowResult,
} from './run-result.js';
import { runnerDeps, toKernelGraph } from './run-env.js';
import type { DriveEnv, OutcomePorts } from './run-env.js';
import { createRunner } from './node-runner.js';
import type { CompiledFlow, FlowNodeRecord, FlowRunHandle, FlowRunOptions, FlowRunResult, FlowStorage, RunEntry } from './types.js';

/** The engine state and capabilities the run driver operates on. */
export interface EngineRunPorts {
    /** 已注册 flow（read-only 面）/ the registered flows (read-only face) */
    readonly flows: ReadonlyMap<FlowId, CompiledFlow>;
    /** 运行条目（驱动器写入）/ the run entries (written by the driver) */
    readonly runs: Map<RunId, RunEntry>;
    /** 引擎事件所属 context / the context that owns the engine's events */
    readonly ownerCtx: Context;
    /** 内核能力 / the kernel capability */
    readonly kernel: GraphKernelService;
    /** 节点类型注册表 / the node-type registry */
    readonly registry: NodeRegistry;
    /** 默认节点超时（毫秒）/ the default per-node timeout (ms) */
    readonly nodeTimeoutMs: number;
    /** 解析可选存储能力（每次使用重解析）/ resolve the optional storage capability per use */
    readonly resolveStorage: () => FlowStorage | undefined;
}

/**
 * 启动一次运行并记录祖先链（subflow 递归防护用）。
 * Start a run and record its ancestor chain (the subflow recursion guard).
 */
export function startEngineRun(
    ports: EngineRunPorts,
    flowId: FlowId,
    options: FlowRunOptions,
    ancestry: readonly FlowId[],
): FlowRunHandle {
    const compiled = ports.flows.get(flowId);
    if (!compiled) throw flowError('FLOW_NOT_FOUND', `flow "${flowId}" is not registered`, { flowId });
    const input = validatedInput(compiled, flowId, options.input ?? {});
    const { entry, blackboard } = createRun(ports, flowId, compiled, ancestry);
    const cell: CancelCell = { requested: false, kernelCancel: undefined };
    const env = buildDriveEnv(ports, input, options.mocks, blackboard, cell);
    const promise = drive(ports, compiled, entry, env);
    return runHandle(entry, cell, promise);
}

/** 入参经 Start 签名校验；失败 fail loud / validate the run input through the flow's Start signature */
function validatedInput(compiled: CompiledFlow, flowId: FlowId, input: Record<string, unknown>): Record<string, unknown> {
    if (!compiled.definition.input) return input;
    try {
        return compiled.definition.input(input) as Record<string, unknown>;
    } catch (cause) {
        throw flowError('NODE_CONFIG_INVALID', `flow "${flowId}" input validation failed`, { flowId, cause });
    }
}

/** 建运行条目：全节点 pending，登记进 runs / create the run entry: every node pending, registered in runs */
function createRun(
    ports: EngineRunPorts,
    flowId: FlowId,
    compiled: CompiledFlow,
    ancestry: readonly FlowId[],
): { entry: RunEntry; blackboard: FlowBlackboard } {
    const runId = randomUUID() as RunId;
    const blackboard = createBlackboard();
    const nodes: Record<string, FlowNodeRecord> = {};
    for (const node of compiled.definition.nodes) nodes[node.id] = { status: 'pending' };
    const entry: RunEntry = { flowId, runId, status: 'running', startedAt: Date.now(), ancestry, blackboard, nodes };
    ports.runs.set(runId, entry);
    return { entry, blackboard };
}

/** run 与句柄共享的取消状态 / the cancel state shared by the drive env and the run handle */
interface CancelCell {
    requested: boolean;
    kernelCancel: (() => void) | undefined;
}

/** 组装运行环境：协作取消管线 + 本 run 的授权服务快照 / build the drive env: cooperative-cancel plumbing + the run's approval snapshot */
function buildDriveEnv(
    ports: EngineRunPorts,
    input: Record<string, unknown>,
    mocks: Record<NodeId, unknown> | undefined,
    blackboard: FlowBlackboard,
    cell: CancelCell,
): DriveEnv {
    const outcomePorts: OutcomePorts = new Map();
    const approval = get(ports.ownerCtx, FlowApprovalToken);
    return {
        input,
        mocks,
        blackboard,
        outcomePorts,
        isCancelled: () => cell.requested,
        setCancel: (cancel) => {
            cell.kernelCancel = cancel;
            // cancel 可能先于内核启动到达：先记意愿，内核启动后转发 signal / cancel may arrive before the kernel starts
            if (cell.requested) cancel();
        },
        // 可选能力：未装载 flow-approval 时节点授权面按 unavailable 拒绝（fail-closed 保留）
        // Optional capability: without flow-approval the node approval face
        // denies as unavailable (fail-closed stays intact).
        ...approval === undefined ? {} : { approval },
    };
}

/** 运行句柄：状态查询 / 主动取消 / 等待完成 / the run handle: status, cooperative cancel, completion */
function runHandle(entry: RunEntry, cell: CancelCell, promise: Promise<FlowRunResult>): FlowRunHandle {
    return {
        flowId: entry.flowId,
        runId: entry.runId,
        status: () => entry.status,
        cancel: () => {
            cell.requested = true;
            cell.kernelCancel?.();
        },
        awaitCompletion: () => promise,
    };
}

/** 运行主体：flow 拦截 → 内核调度 → 汇总 / the run body: flow intercept → kernel scheduling → finalize */
async function drive(ports: EngineRunPorts, compiled: CompiledFlow, entry: RunEntry, env: DriveEnv): Promise<FlowRunResult> {
    const { flowId, runId } = entry;
    const payload = { flowId, runId, input: env.input };
    if (env.isCancelled()) return finalize(ports, compiled, entry, env.blackboard, cancelledRunResult(compiled, flowId, runId));
    if (await ports.ownerCtx.serial('flow/run-starting', payload)) {
        return finalize(ports, compiled, entry, env.blackboard, rejectedRunResult(compiled, flowId, runId));
    }
    if (env.isCancelled()) return finalize(ports, compiled, entry, env.blackboard, cancelledRunResult(compiled, flowId, runId));
    ports.ownerCtx.emit('flow/run-start', payload);
    const graph = toKernelGraph(compiled, env.blackboard, env.outcomePorts);
    const deps = runnerDeps(compiled, entry, env, ports.registry, ports.nodeTimeoutMs);
    const handle = ports.kernel.run(graph, createRunner(deps), { runId });
    env.setCancel(() => handle.cancel());
    return finalize(ports, compiled, entry, env.blackboard, await handle.result);
}

/** 汇总结果：输出变量、节点记录、事件与持久化 / aggregate the result: output vars, node records, events, persistence */
async function finalize(
    ports: EngineRunPorts,
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
    ports.ownerCtx.emit('flow/run-end', { flowId: entry.flowId, runId: entry.runId, status: result.status, output: result.output, blackboard: blackboard.snapshot() });
    try {
        await ports.resolveStorage()?.saveRun(result);
    } catch (cause) {
        ports.ownerCtx.logger.error('flow run persist failed / flow 运行持久化失败', cause);
    }
    return result;
}

/**
 * subflow 回调：按 run 的祖先链做递归防护（不是引擎级全局集合，
 * 否则同一子 flow 的并行引用会互相误伤），并传播父级取消。
 * The subflow callback: the recursion guard walks the run's own ancestor
 * chain (an engine-global set would make parallel references to the same
 * child flow collide) and propagates the parent cancel.
 */
export async function runSubflow(
    ports: EngineRunPorts,
    flowId: FlowId,
    input: Record<string, unknown>,
    nctx: NodeExecuteContext,
): Promise<unknown> {
    const ancestry = ports.runs.get(nctx.runId)?.ancestry ?? [];
    if (ancestry.includes(flowId)) {
        throw flowError('FLOW_REFERENCE_CYCLE', `recursive subflow reference to "${flowId}" at runtime`, { flowId, nodeId: nctx.nodeId });
    }
    const handle = startEngineRun(ports, flowId, { input }, [...ancestry, flowId]);
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
}
