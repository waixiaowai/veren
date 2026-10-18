/**
 * 运行摘要：把快照变成「一眼看懂」的标题、明细与关键节点列表。
 *
 * Run digest: turn a snapshot into an at-a-glance headline, detail line and the
 * key failed / skipped / recovered node lists.
 */

import type { CanvasRunSnapshot } from '@deepseek-ai/dsh-graph-flow-canvas';
import { assertNever, type NodeStatus } from './model.js';

/** 整体运行色板 / run-level palette key */
export type RunTone = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 节点状态计数 / per-status counts */
export interface RunCounts {
    total: number;
    pending: number;
    ready: number;
    running: number;
    /** 等待授权（flow 层挂起态）/ awaiting approval (the flow layer's suspended state) */
    'awaiting-approval': number;
    completed: number;
    /** completed 中带 recovered 的子集 / subset of completed carrying recovered */
    recovered: number;
    failed: number;
    skipped: number;
    cancelled: number;
    settled: number;
}

/** 一个失败节点的可读摘要 / readable summary of one failed node */
export interface FailedNode {
    id: string;
    code: string;
    message: string;
}

/** 一个跳过节点的可读摘要 / readable summary of one skipped node */
export interface SkippedNode {
    id: string;
    reason: string;
}

/** 一个兜底节点的可读摘要 / readable summary of one recovered node */
export interface RecoveredNode {
    id: string;
    code: string;
    message: string;
}

/** 整体运行摘要：标题、明细与关键节点 / run digest: headline, detail and key nodes */
export interface RunSummary {
    tone: RunTone;
    headline: string;
    detail: string;
    counts: RunCounts;
    failed: FailedNode[];
    skipped: SkippedNode[];
    recovered: RecoveredNode[];
}

/**
 * 快照 → 整体运行摘要。失败时标题直接点出首个失败节点，旁边列出兜底与
 * 跳过数量，用户不必逐个点节点也能回答“哪里失败了”。
 *
 * Snapshot → run digest. On failure the headline names the first failed node;
 * recovered and skipped counts sit beside it, so "where did it fail?" is
 * answerable without opening every node.
 *
 * @param snapshot 运行快照 / the run snapshot
 * @returns 运行摘要 / the run digest
 */
export function runSummary(snapshot: CanvasRunSnapshot | null): RunSummary {
    if (!snapshot) {
        return {
            tone: 'idle',
            headline: '尚未运行 · Run has not started',
            detail: '点击「运行」后，节点会按依赖顺序亮起 / press Run to light the nodes in dependency order',
            counts: emptyCounts(0),
            failed: [],
            skipped: [],
            recovered: [],
        };
    }
    const failed: FailedNode[] = [];
    const skipped: SkippedNode[] = [];
    const recovered: RecoveredNode[] = [];
    let counts = emptyCounts(Object.keys(snapshot.nodes).length);
    for (const [id, runtime] of Object.entries(snapshot.nodes)) {
        counts = countOne(counts, runtime.status);
        if (runtime.error) failed.push({ id, code: runtime.error.code, message: runtime.error.message });
        if (runtime.recovered) {
            counts.recovered += 1;
            recovered.push({ id, code: runtime.recovered.code, message: runtime.recovered.message });
        }
        if (runtime.status === 'skipped') {
            skipped.push({ id, reason: runtime.skipReason ?? 'unknown' });
        }
    }
    counts.settled = counts.completed + counts.failed + counts.skipped + counts.cancelled;
    const tone: RunTone = snapshot.status;
    return {
        tone,
        headline: headlineOf(tone, counts, failed, recovered),
        detail: detailOf(tone, counts, failed, skipped),
        counts,
        failed,
        skipped,
        recovered,
    };
}

/** 空计数 / zeroed counts */
function emptyCounts(total: number): RunCounts {
    return {
        total, pending: 0, ready: 0, running: 0, 'awaiting-approval': 0, completed: 0,
        recovered: 0, failed: 0, skipped: 0, cancelled: 0, settled: 0,
    };
}

/** 累加一个状态 / add one status to the counts */
function countOne(counts: RunCounts, status: NodeStatus): RunCounts {
    return { ...counts, [status]: counts[status] + 1 };
}

/** 运行标题 / the run headline */
function headlineOf(tone: RunTone, counts: RunCounts, failed: readonly FailedNode[], recovered: readonly RecoveredNode[]): string {
    switch (tone) {
        case 'failed': {
            const first = failed[0];
            return first ? `运行失败 · ${first.id} (${first.code})` : '运行失败 · Run failed';
        }
        case 'completed':
            return recovered.length > 0
                ? `运行完成 · ${recovered.length} 个失败已兜底`
                : '运行完成 · Run completed';
        case 'cancelled':
            return '运行已取消 · Run cancelled';
        case 'running':
            return `运行中 · ${counts.settled}/${counts.total} 已落定`;
        case 'idle':
            return '尚未运行 · Run has not started';
        default:
            return assertNever(tone);
    }
}

/** 运行明细 / the run detail line */
function detailOf(tone: RunTone, counts: RunCounts, failed: readonly FailedNode[], skipped: readonly SkippedNode[]): string {
    const parts = [
        `${counts.completed} completed${counts.recovered > 0 ? ` (${counts.recovered} recovered)` : ''}`,
        `${counts.failed} failed`,
        `${counts.skipped} skipped`,
    ];
    if (tone === 'running') parts.push(`${counts.running} running · ${counts.pending + counts.ready} waiting`);
    const first = failed[0];
    if (first) parts.push(`首个失败 / first failure: ${first.id} — ${first.message}`);
    if (skipped.length > 0) parts.push(`skipped: ${skipped.map((node) => `${node.id} (${node.reason})`).join(', ')}`);
    return parts.join(' · ');
}
