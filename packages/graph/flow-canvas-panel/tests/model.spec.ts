/**
 * Pure mapping contracts: status → visual, edge condition → label, detail
 * precedence, the output read path, the run digest, and read-only change
 * layering.
 *
 * 纯映射契约：状态 → 可视化、条件边 → 标注、详情优先级、output 读取路径、运行摘要，
 * 以及只读的状态变更叠加。
 */

import { describe, expect, it } from 'vitest'
import type { CanvasNodeStatusChange, CanvasRunSnapshot } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowApprovalAudit, FlowId, NodeId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import {
    approvalAuditLine, durationMs, formatClock, nodeDetail, nodeOutput, outcomeLabelKey,
    pendingApproval, runDigest, settledApproval, statusVisual,
} from '../src/client/model.ts'
import { edgeVisual } from '../src/client/edges.ts'
import { withChange } from '../src/client/store.ts'

describe('statusVisual', () => {
    it('maps every status to a distinct tone and label', () => {
        const seen = new Set<string>()
        for (const status of ['pending', 'ready', 'running', 'awaiting-approval', 'completed', 'failed', 'skipped', 'cancelled'] as const) {
            const visual = statusVisual(status)
            expect(visual.labelKey).toBe(status === 'awaiting-approval' ? 'status.awaitingApproval' : `status.${status}`)
            expect(seen.has(visual.tone)).toBe(false)
            seen.add(visual.tone)
        }
    })

    it('distinguishes a recovered completion from a clean completion', () => {
        const clean = statusVisual('completed')
        const recovered = statusVisual('completed', { code: 'NODE_FAILED' })
        expect(clean.tone).toBe('completed')
        expect(recovered.tone).toBe('recovered')
        expect(recovered.labelKey).toBe('status.recovered')
    })
})

describe('edgeVisual', () => {
    it('labels the built-in error port with a readable branch name', () => {
        expect(edgeVisual({ kind: 'port', port: 'error', hasPredicate: false, closedByErrorPort: false, summary: '' }).label)
            .toEqual({ key: 'edge.errorPort', params: {} })
        expect(edgeVisual({ kind: 'port', port: 'error', hasPredicate: true, closedByErrorPort: false, summary: '' }).label)
            .toEqual({ key: 'edge.errorPortPredicate', params: {} })
    })

    it('labels a custom named port and keeps the port name', () => {
        expect(edgeVisual({ kind: 'port', port: 'retry', hasPredicate: false, closedByErrorPort: false, summary: '' }).label)
            .toEqual({ key: 'edge.port', params: { port: 'retry' } })
    })

    it('labels predicate and error-branch default edges and keeps always unlabelled', () => {
        expect(edgeVisual({ kind: 'predicate', hasPredicate: true, closedByErrorPort: false, summary: '' }).label?.key)
            .toBe('edge.predicate')
        const fallback = edgeVisual({ kind: 'error-branch-default', hasPredicate: false, closedByErrorPort: true, summary: '' })
        expect(fallback.label?.key).toBe('edge.default')
        expect(fallback.dashed).toBe(true)
        expect(fallback.titleKey).toBe('edge.defaultTitle')
        expect(edgeVisual({ kind: 'always', hasPredicate: false, closedByErrorPort: false, summary: '' }).label)
            .toBeUndefined()
    })
})

describe('nodeDetail', () => {
    it('prefers error over recovered over skip', () => {
        expect(nodeDetail({
            id: 'n' as NodeId,
            status: 'failed',
            error: { code: 'NODE_FAILED', message: 'boom' },
            recovered: { code: 'OLD', message: 'old' },
            skipReason: 'upstream',
        })).toEqual({ key: 'node.detail.error', params: { code: 'NODE_FAILED', message: 'boom' } })
        expect(nodeDetail({
            id: 'n' as NodeId,
            status: 'completed',
            recovered: { code: 'NODE_FAILED', message: 'caught' },
            skipReason: 'upstream',
        })).toEqual({ key: 'node.detail.recovered', params: { code: 'NODE_FAILED' } })
        expect(nodeDetail({ id: 'n' as NodeId, status: 'skipped', skipReason: 'upstream' }))
            .toEqual({ key: 'node.detail.skip', params: { reason: 'upstream' } })
        expect(nodeDetail({ id: 'n' as NodeId, status: 'completed' })).toBeUndefined()
    })
})

/** One settled-run view with an output on `ok` and none on `bad`. */
function runWithOutput(output: unknown): {
    runId: string
    status: 'completed'
    nodes: Record<string, { id: NodeId; status: 'completed' }>
    result: CanvasRunSnapshot['result']
} {
    return {
        runId: 'run-1',
        status: 'completed',
        nodes: { ok: { id: 'ok' as NodeId, status: 'completed' } },
        result: {
            flowId: 'flow' as FlowId,
            runId: 'run-1' as RunId,
            status: 'completed',
            output: {},
            nodes: {
                ok: output === undefined ? { status: 'completed' } : { status: 'completed', output },
                bad: { status: 'failed', error: { code: 'X', message: 'y' } },
            },
        },
    }
}

describe('nodeOutput', () => {
    it('explains absence instead of inventing a value', () => {
        expect(nodeOutput(undefined, 'ok')).toEqual({ available: false, reason: 'no-run' })
        expect(nodeOutput({ ...runWithOutput(undefined), result: null }, 'ok')).toEqual({ available: false, reason: 'running' })
        expect(nodeOutput(runWithOutput(1), 'missing')).toEqual({ available: false, reason: 'missing-node' })
        expect(nodeOutput(runWithOutput(1), 'bad')).toEqual({ available: false, reason: 'no-output' })
    })

    it('reads output from result, including falsy values', () => {
        for (const value of [0, false, '', null]) {
            expect(nodeOutput(runWithOutput(value), 'ok')).toEqual({ available: true, value })
        }
    })

    it('never reads the canvas runtime record', () => {
        const run = runWithOutput(undefined)
        const withRuntimeOutput = {
            ...run,
            nodes: { ok: { id: 'ok' as NodeId, status: 'completed' as const, output: 'do-not-read' } },
        }
        expect(nodeOutput(withRuntimeOutput, 'ok')).toEqual({ available: false, reason: 'no-output' })
    })
})

describe('runDigest', () => {
    it('counts recovered separately from clean completions', () => {
        const snapshot: CanvasRunSnapshot = {
            schemaVersion: 1,
            flowId: 'f' as FlowId,
            runId: 'r' as RunId,
            status: 'failed',
            nodes: {
                a: { id: 'a' as NodeId, status: 'completed' },
                b: { id: 'b' as NodeId, status: 'completed', recovered: { code: 'NODE_FAILED', message: 'caught' } },
                c: { id: 'c' as NodeId, status: 'failed' },
                d: { id: 'd' as NodeId, status: 'skipped' },
            },
            result: null,
        }
        expect(runDigest(snapshot)).toEqual({ clean: 1, recovered: 1, failed: 1, skipped: 1, awaiting: 0 })
    })

    it('counts awaiting-approval nodes separately from settled outcomes', () => {
        const snapshot: CanvasRunSnapshot = {
            schemaVersion: 1,
            flowId: 'f' as FlowId,
            runId: 'r' as RunId,
            status: 'running',
            nodes: {
                a: { id: 'a' as NodeId, status: 'completed' },
                b: { id: 'b' as NodeId, status: 'awaiting-approval' },
            },
            result: null,
        }
        expect(runDigest(snapshot)).toEqual({ clean: 1, recovered: 0, failed: 0, skipped: 0, awaiting: 1 })
    })
})

/** One audit entry for the approval helpers. */
function audit(overrides: Partial<FlowApprovalAudit['request']> = {}, outcome?: FlowApprovalAudit['outcome']): FlowApprovalAudit {
    return {
        request: {
            id: 'req-1',
            flowId: 'f' as FlowId,
            runId: 'r' as RunId,
            nodeId: 'n' as NodeId,
            attempt: 1,
            kind: 'tool',
            action: 'bash',
            reason: 'writes files',
            summary: '{\n  "command": "rm"\n}',
            requestedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
            ...overrides,
        },
        ...outcome === undefined ? {} : { outcome },
    }
}

describe('approval helpers', () => {
    it('selects the pending request and the last settled audit', () => {
        const pending = { id: 'a' as NodeId, status: 'awaiting-approval' as const, approvals: [audit({ id: 'req-1' })] }
        expect(pendingApproval(pending)?.request.id).toBe('req-1')
        expect(settledApproval(pending)).toBeUndefined()

        const settled = {
            id: 'a' as NodeId,
            status: 'running' as const,
            approvals: [
                audit({ id: 'req-1' }, { decision: 'deny' as const, via: 'timeout' as const, decidedAt: 1 }),
                audit({ id: 'req-2' }, { decision: 'allow' as const, via: 'user' as const, decidedBy: 'alice', decidedAt: 2 }),
            ],
        }
        expect(pendingApproval(settled)).toBeUndefined()
        expect(settledApproval(settled)?.outcome?.decidedBy).toBe('alice')
    })

    it('renders who/when for user answers and explains timeout/cancel', () => {
        const user = approvalAuditLine(audit({}, { decision: 'allow', via: 'user', decidedBy: 'alice', decidedAt: 0 }))
        expect(user?.key).toBe('approval.audit.allowed')
        expect(user?.params).toMatchObject({ actor: 'alice' })
        expect(approvalAuditLine(audit({}, { decision: 'deny', via: 'timeout', decidedAt: 0 }))?.key)
            .toBe('approval.audit.timeout')
        expect(approvalAuditLine(audit({}, { decision: 'deny', via: 'cancel', decidedAt: 0 }))?.key)
            .toBe('approval.audit.cancel')
        expect(approvalAuditLine(audit({}, { decision: 'deny', via: 'unavailable', decidedAt: 0 }))?.key)
            .toBe('approval.audit.unavailable')
        expect(approvalAuditLine(audit())).toBeUndefined()
    })

    it('labels outcomes and formats a stable clock', () => {
        expect(outcomeLabelKey(undefined)).toBe('approval.decision.pending')
        expect(outcomeLabelKey({ decision: 'allow', via: 'user', decidedAt: 0 })).toBe('approval.decision.allow')
        expect(outcomeLabelKey({ decision: 'deny', via: 'timeout', decidedAt: 0 })).toBe('approval.decision.timeout')
        expect(formatClock(Date.UTC(2026, 0, 2, 3, 4, 5))).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    })
})

describe('withChange', () => {
    it('publishes a new node map and leaves the received records untouched', () => {
        const original = { a: { id: 'a' as NodeId, status: 'running' as const } }
        const change: CanvasNodeStatusChange = {
            flowId: 'f' as FlowId,
            runId: 'r' as RunId,
            nodeId: 'a' as NodeId,
            id: 'a' as NodeId,
            status: 'failed',
            error: { code: 'NODE_FAILED', message: 'boom' },
        }
        const next = withChange(original, change)
        expect(next).not.toBe(original)
        expect(next['a']).toMatchObject({ status: 'failed', error: { code: 'NODE_FAILED' } })
        expect(original['a']).toEqual({ id: 'a', status: 'running' })
    })
})

describe('durationMs', () => {
    it('needs both endpoints and never goes negative', () => {
        expect(durationMs({})).toBeUndefined()
        expect(durationMs({ startedAt: 10, endedAt: 15 })).toBe(5)
        expect(durationMs({ startedAt: 15, endedAt: 10 })).toBe(0)
    })
})
