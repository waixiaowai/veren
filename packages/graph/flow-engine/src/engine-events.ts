/**
 * Engine event wiring: kernel neutral events → flow semantic events, the
 * waterfall rewrite sync onto the blackboard, and approval events → node
 * status and audit.
 *
 * 引擎事件接线：内核中性事件 → flow 语义事件、waterfall 加工结果回写黑板，以及
 * 授权事件 → 节点状态与审计。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/engine-events
 */

import type { GraphNodeStatusPayload } from '@deepseek-ai/dsh-graph-core';
import type { NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api';
import { recoveredFailure, toSlots } from './blackboard.js';
import { beginApproval, finishApproval, projectNode } from './approval-audit.js';
import type { EngineRunPorts } from './run-driver.js';
import type { FlowNodeRecord } from './types.js';

/**
 * 注册引擎响应的全部事件（随引擎 fiber 卸载逆序注销）。
 * Wire every event the engine reacts to (unregistered in reverse order with
 * the engine fiber).
 */
export function wireEngineEvents(ports: EngineRunPorts): void {
    const { ownerCtx } = ports;
    // waterfall 改写同步：引擎监听器位于链最外层，next() 返回（全部加工
    // 完成后）再把最终产出覆盖黑板 slot。/ The engine listener is the
    // outermost link; after next() returns it writes the final output back.
    ownerCtx.on('graph/node-post-execute', (meta, envelope, next) => {
        const final = next();
        const entry = ports.runs.get(meta.runId as RunId);
        if (entry?.blackboard && meta.nodeId !== undefined) {
            for (const [slot, value] of Object.entries(toSlots(final ?? envelope.output))) entry.blackboard.write(meta.nodeId, slot, value);
        }
        return final;
    });
    // 内核中性状态事件 → flow 语义事件（补 flowId；错误收缩为可序列化面）。
    // Kernel neutral status event → flow semantic event (adds flowId; the
    // error shrinks to its serializable surface).
    ownerCtx.on('graph/node-status', (payload) => {
        projectKernelStatus(ports, payload);
    });
    // 授权挂起/落定 → 节点状态与审计 / approval pending & settled wiring
    wireApprovalEvents(ports);
}

/**
 * 授权事件接线：等待中的请求把节点标成 awaiting-approval。
 * Wire the approval events: a pending request marks the node awaiting-approval.
 */
function wireApprovalEvents(ports: EngineRunPorts): void {
    ports.ownerCtx.on('flow/approval-requested', (request) => {
        beginApproval(ports.ownerCtx, ports.runs, request);
    });
    ports.ownerCtx.on('flow/approval-decided', (payload) => {
        finishApproval(ports.ownerCtx, ports.runs, payload.request, payload.outcome);
    });
}

/** 内核节点状态 → flow 节点记录（含 errorBranch 兜底事实）/ kernel node status → flow node record (with the errorBranch recovery fact) */
function projectKernelStatus(ports: EngineRunPorts, payload: GraphNodeStatusPayload): void {
    const entry = ports.runs.get(payload.runId as RunId);
    if (entry === undefined) return;
    const previous = entry.nodes[payload.nodeId];
    const flow = ports.flows.get(entry.flowId);
    const node = flow?.definition.nodes.find((candidate) => candidate.id === payload.nodeId);
    const recovered = payload.status === 'completed' && node?.onError === 'errorBranch'
        ? recoveredFailure(entry.blackboard, payload.nodeId as NodeId)
        : undefined;
    const record = statusRecord(payload, previous?.approvals, recovered);
    entry.nodes[payload.nodeId] = record;
    projectNode(ports.ownerCtx, entry, payload.nodeId);
}

/** 组装节点记录：内核状态字段 + 保留的授权审计 + 兜底事实 / assemble the record: kernel status fields + kept approval audit + recovery fact */
function statusRecord(
    payload: GraphNodeStatusPayload,
    approvals: FlowNodeRecord['approvals'],
    recovered: FlowNodeRecord['recovered'],
): FlowNodeRecord {
    const record: FlowNodeRecord = { status: payload.status };
    if (payload.skipReason !== undefined) record.skipReason = payload.skipReason;
    if (payload.startedAt !== undefined) record.startedAt = payload.startedAt;
    if (payload.endedAt !== undefined) record.endedAt = payload.endedAt;
    if (payload.error) record.error = { code: payload.error.code, message: payload.error.message };
    if (recovered) record.recovered = recovered;
    if (approvals !== undefined) record.approvals = approvals;
    return record;
}
