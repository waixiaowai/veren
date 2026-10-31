/**
 * Approval audit on node records: a pending request marks the node
 * awaiting-approval; a settled request writes back the outcome with actor and
 * time. Settled node states are never reopened by approval events.
 *
 * 节点记录上的授权审计：请求挂起把节点标成 awaiting-approval；请求落定把结果与
 * 回答者/时间写回。已落定的节点状态不会被授权事件翻回运行中。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/approval-audit
 */

import type { Context } from '@deepseek-ai/cordis';
import type {
    FlowApprovalAudit,
    FlowApprovalOutcome,
    FlowApprovalRequest,
    NodeId,
    RunId,
} from '@deepseek-ai/dsh-graph-flow-api';
import type { FlowNodeRecord, FlowNodeStatus, FlowNodeStatusPayload, RunEntry } from './types.js';

/** 已落定的节点状态：授权事件不得把它们翻回运行中 / settled node states; approval events must not reopen them */
const TERMINAL: ReadonlySet<FlowNodeStatus> = new Set(['completed', 'failed', 'skipped', 'cancelled']);

/** 广播一条节点的当前记录（状态 + 审计）/ broadcast one node's current record (status + audit) */
export function projectNode(ownerCtx: Context, entry: RunEntry, nodeId: string): void {
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
    ownerCtx.emit('flow/node-status', payload);
}

/**
 * 请求挂起：节点进入可辨识的等待授权状态，保留已有的起止时间；同一尝试的多个
 * 并发请求都记入审计。
 * A request is pending: the node enters awaiting-approval, keeping its
 * timestamps; concurrent requests of the same attempt are all audited.
 */
export function beginApproval(
    ownerCtx: Context,
    runs: ReadonlyMap<RunId, RunEntry>,
    request: FlowApprovalRequest,
): void {
    const entry = runs.get(request.runId);
    const record = entry?.nodes[request.nodeId];
    if (entry === undefined || record === undefined || TERMINAL.has(record.status)) return;
    record.status = 'awaiting-approval';
    record.approvals = [...(record.approvals ?? []), { request }];
    projectNode(ownerCtx, entry, request.nodeId);
}

/**
 * 请求落定：写回结果与回答者/时间；只要还有挂起请求就保持等待。
 * A request settled: write back the outcome with actor/time; stay waiting
 * while another request is still open.
 */
export function finishApproval(
    ownerCtx: Context,
    runs: ReadonlyMap<RunId, RunEntry>,
    request: FlowApprovalRequest,
    outcome: FlowApprovalOutcome,
): void {
    const entry = runs.get(request.runId);
    const record = entry?.nodes[request.nodeId];
    if (entry === undefined || record === undefined) return;
    const approvals: FlowApprovalAudit[] | undefined = mapDecision(record.approvals, request, outcome);
    if (approvals === undefined) return;
    record.approvals = approvals;
    if (record.status === 'awaiting-approval') {
        record.status = approvals.some((audit) => audit.outcome === undefined) ? 'awaiting-approval' : 'running';
    }
    projectNode(ownerCtx, entry, request.nodeId);
}

/**
 * 把决定合并进审计轨迹；请求不在轨迹里时返回 undefined（调用方跳过）。
 * Merge the decision into the audit trail; undefined when the request is not
 * in the trail (the caller skips).
 */
function mapDecision(
    current: readonly FlowApprovalAudit[] | undefined,
    request: FlowApprovalRequest,
    outcome: FlowApprovalOutcome,
): FlowApprovalAudit[] | undefined {
    if (!current?.some((audit) => audit.request.id === request.id)) return undefined;
    return current.map((audit) => (audit.request.id === request.id ? { request, outcome } : audit));
}
