/**
 * Run result aggregation: kernel records mapped to flow node records, output
 * variables resolved from the blackboard, and the synthetic results for a
 * cancelled or rejected run.
 *
 * 运行结果聚合：内核节点记录映射为 flow 节点记录、输出变量从黑板解析，以及取消 /
 * 拒绝启动两种合成结果。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/run-result
 */

import type { GraphRunResult } from '@deepseek-ai/dsh-graph-core';
import type { FlowBlackboard, FlowId, RunId } from '@deepseek-ai/dsh-graph-flow-api';
import { recoveredFailure, resolveInputValue } from './blackboard.js';
import type { CompiledFlow, FlowNodeRecord, FlowRunResult, RunEntry } from './types.js';

/** 内核节点记录 → flow 节点记录；缺失的可选字段不落键 / map a kernel record; absent optional fields are omitted */
function toFlowRecord([id, record]: [string, GraphRunResult['nodes'][string]]): [string, FlowNodeRecord] {
    const node: FlowNodeRecord = { status: record.status };
    if (record.skipReason !== undefined) node.skipReason = record.skipReason;
    if (record.startedAt !== undefined) node.startedAt = record.startedAt;
    if (record.endedAt !== undefined) node.endedAt = record.endedAt;
    if (record.output !== undefined) node.output = record.output;
    if (record.error) node.error = { code: record.error.code, message: record.error.message };
    return [id, node];
}

/** 内核结果 → flow 结果：节点记录、解析后的输出变量、首个错误 / kernel result → flow result */
export function toFlowResult(
    compiled: CompiledFlow,
    entry: RunEntry,
    blackboard: FlowBlackboard,
    kernelResult: GraphRunResult,
): FlowRunResult {
    const nodes = Object.fromEntries(Object.entries(kernelResult.nodes).map(toFlowRecord));
    // 失败事实是加法：errorBranch 节点仍是 completed，但记录里带 recovered
    // The failure fact is additive: an errorBranch node stays completed but carries recovered.
    for (const node of compiled.definition.nodes) {
        const record = nodes[node.id];
        if (node.onError !== 'errorBranch' || record?.status !== 'completed') continue;
        const recovered = recoveredFailure(blackboard, node.id);
        if (recovered) record.recovered = recovered;
    }
    const output = Object.fromEntries(
        Object.entries(compiled.definition.output ?? {}).map(([name, ref]) => [name, resolveInputValue(ref, blackboard)]),
    );
    const failure = Object.values(kernelResult.nodes).find((record) => record.error);
    const result: FlowRunResult = { flowId: entry.flowId, runId: entry.runId, status: kernelResult.status, output, nodes };
    if (failure) result.error = { code: failure.error!.code, message: failure.error!.message };
    return result;
}

/** 取消：每个节点都是 cancelled（不是 skipped）/ cancel: every node is cancelled (never skipped) */
export function cancelledRunResult(compiled: CompiledFlow, flowId: FlowId, runId: RunId): GraphRunResult {
    const nodes = Object.fromEntries(
        compiled.definition.nodes.map((node) => [node.id, { id: node.id, status: 'cancelled' as const }]),
    );
    return { graphId: flowId, runId, status: 'cancelled', nodes };
}

/** 拒绝启动：未启动节点 skipped/run-rejected / refused start: never-started nodes are skipped */
export function rejectedRunResult(compiled: CompiledFlow, flowId: FlowId, runId: RunId): GraphRunResult {
    const nodes = Object.fromEntries(compiled.definition.nodes.map((node) => [
        node.id,
        { id: node.id, status: 'skipped' as const, skipReason: 'run-rejected' as const },
    ]));
    return { graphId: flowId, runId, status: 'cancelled', nodes };
}
