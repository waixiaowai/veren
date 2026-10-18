/**
 * 画布 UI 的纯映射层：状态 → 颜色/标记、条件边 → 标注、快照 → 整体摘要，
 * 以及唯一允许读取节点 output 的契约入口。
 *
 * The canvas UI's pure mapping layer: status → colour/marker, conditional edge
 * → label, snapshot → run digest, and the one contract-safe entry point for
 * reading a node's output.
 *
 * This file deliberately contains no DOM and no server code, so vitest can
 * prove the mappings without a browser and the server can reuse the API types.
 */

import type { CanvasEdgeCondition, CanvasNodeRuntime, CanvasNodeStatusChange, CanvasRunSnapshot } from '@deepseek-ai/dsh-graph-flow-canvas';

/** 节点状态（来自画布运行投影）/ a node status from the canvas run projection */
export type NodeStatus = CanvasNodeRuntime['status'];

/** 状态色板名（CSS 按它上色）/ status palette key that CSS colours by */
export type StatusTone =
    | 'pending'
    | 'ready'
    | 'running'
    | 'awaiting'
    | 'completed'
    | 'recovered'
    | 'failed'
    | 'skipped'
    | 'cancelled';

/** 状态在节点上的全部可视化事实 / every visual fact a status contributes to a node */
export interface StatusVisual {
    /** 色板 / palette key */
    tone: StatusTone;
    /** 单字符标记（辅助色盲用户）/ one-character marker (helps colour-blind readers) */
    marker: string;
    /** 状态文字 / status text */
    label: string;
    /** 节点类名 / the node class name */
    className: string;
}

/**
 * 状态 → 色板/标记。completed + recovered 必须与干净成功不同：它用
 * `recovered` 色板、`!` 标记和 "completed · recovered" 文案。
 *
 * Status → palette/marker. completed + recovered must differ from a clean
 * success: the `recovered` palette, the `!` marker and the
 * "completed · recovered" label.
 *
 * @param status 节点状态 / node status
 * @param recovered errorBranch 兜底事实 / the errorBranch recovered fact
 * @returns 可视化事实 / the visual facts
 */
export function statusVisual(status: NodeStatus, recovered?: { code: string }): StatusVisual {
    if (status === 'completed' && recovered) {
        return { tone: 'recovered', marker: '!', label: 'completed · recovered', className: 'status-recovered' };
    }
    switch (status) {
        case 'pending':
            return { tone: 'pending', marker: '○', label: 'pending', className: 'status-pending' };
        case 'ready':
            return { tone: 'ready', marker: '◔', label: 'ready', className: 'status-ready' };
        case 'running':
            return { tone: 'running', marker: '◉', label: 'running', className: 'status-running' };
        case 'awaiting-approval':
            return { tone: 'awaiting', marker: '⏸', label: 'awaiting approval', className: 'status-awaiting' };
        case 'completed':
            return { tone: 'completed', marker: '✓', label: 'completed', className: 'status-completed' };
        case 'failed':
            return { tone: 'failed', marker: '✕', label: 'failed', className: 'status-failed' };
        case 'skipped':
            return { tone: 'skipped', marker: '–', label: 'skipped', className: 'status-skipped' };
        case 'cancelled':
            return { tone: 'cancelled', marker: '⊘', label: 'cancelled', className: 'status-cancelled' };
        default:
            // 闭集 union：新增状态时这里会编译失败 / closed union: a new status fails the build here
            return assertNever(status);
    }
}

/** union 收尾 / exhaustiveness helper */
export function assertNever(value: never): never {
    throw new Error(`unhandled node status: ${String(value)}`);
}

/**
 * 节点第二行详情：错误 > 兜底 > 跳过原因。只读 runtime，不碰 result。
 * The node's second detail line: error > recovered > skip reason. Read-only
 * over the runtime record; never touches result.
 *
 * @param runtime 运行节点 / the runtime node
 * @returns 单行详情或 undefined / one detail line or undefined
 */
export function nodeStateDetail(runtime: CanvasNodeRuntime | undefined): string | undefined {
    if (!runtime) return undefined;
    if (runtime.error) return `${runtime.error.code}: ${runtime.error.message}`;
    if (runtime.recovered) return `recovered ${runtime.recovered.code}`;
    if (runtime.skipReason) return `skip: ${runtime.skipReason}`;
    return undefined;
}

/** 条件边的色板名 / palette key of a conditional edge */
export type EdgeTone = CanvasEdgeCondition['kind'];

/** 条件边的可视化事实 / the visual facts of a conditional edge */
export interface EdgeVisual {
    tone: EdgeTone;
    /** 边上的短标注；always 不标注 / short edge label; always is unlabelled */
    label: string | null;
    /** 悬停完整说明 / full hover explanation */
    title: string;
    /** 是否虚线 / whether the stroke is dashed */
    dashed: boolean;
}

/**
 * 条件边 → 标注。port / predicate / errorBranch 默认边必须一眼可辨；
 * 无条件边（always）不抢视觉，由图例说明。
 *
 * Conditional edge → label. port / predicate / errorBranch default edges must
 * be distinguishable at a glance; unconditional edges stay unlabelled and the
 * legend explains them.
 *
 * @param condition 画布条件描述 / the canvas condition description
 * @returns 可视化事实 / the visual facts
 */
export function edgeVisual(condition: CanvasEdgeCondition): EdgeVisual {
    switch (condition.kind) {
        case 'port':
            return {
                tone: 'port',
                label: condition.hasPredicate
                    ? `port: ${condition.port ?? '?'}\npredicate ignored`
                    : `port: ${condition.port ?? '?'}`,
                title: condition.summary,
                dashed: false,
            };
        case 'predicate':
            return { tone: 'predicate', label: 'predicate', title: condition.summary, dashed: false };
        case 'error-branch-default':
            return {
                tone: 'error-branch-default',
                label: condition.hasPredicate
                    ? 'default\npredicate\ncloses on error'
                    : 'default\ncloses on error',
                title: condition.summary,
                dashed: true,
            };
        case 'always':
            return { tone: 'always', label: null, title: condition.summary, dashed: false };
        default:
            return assertNever(condition.kind);
    }
}

/** 节点 output 不可用的原因 / why a node output is unavailable */
export type OutputUnavailableReason = 'no-run' | 'running' | 'missing-node' | 'no-output';

/** output 读取结果：可用或带原因 / the output read result: available or explained */
export type NodeOutput =
    | { available: true; value: unknown }
    | { available: false; reason: OutputUnavailableReason };

/**
 * 读取节点 output 的唯一入口。契约：canvas runtime（snapshot.nodes）只有
 * 状态/时间/错误，output 必须取 `snapshot.result.nodes[id].output`。
 *
 * The only entry point for reading node output. Contract: the canvas runtime
 * (snapshot.nodes) carries status/time/error only; output MUST come from
 * `snapshot.result.nodes[id].output`.
 *
 * @param snapshot 运行快照 / the run snapshot
 * @param nodeId 节点 id / node id
 * @returns output 或不可用原因 / the output or the reason it is unavailable
 */
export function nodeOutput(snapshot: CanvasRunSnapshot | null, nodeId: string): NodeOutput {
    if (!snapshot) return { available: false, reason: 'no-run' };
    if (!snapshot.result) return { available: false, reason: 'running' };
    const record = snapshot.result.nodes[nodeId];
    if (!record) return { available: false, reason: 'missing-node' };
    // 必须用自有键判断：output 可能是假值 / judge by an own key: output may be falsy
    if (!Object.prototype.hasOwnProperty.call(record, 'output')) return { available: false, reason: 'no-output' };
    return { available: true, value: record.output };
}

/**
 * 把增量状态叠加到快照的**副本**上（不修改收到的快照/result）。
 * Overlay incremental changes on a **copy** of the snapshot (never mutates the
 * received snapshot or result).
 *
 * @param snapshot 最近一次完整快照 / the latest full snapshot
 * @param changes 增量状态变更 / incremental status changes
 * @returns 新的只读快照 / a new read-only snapshot
 */
export function withLiveChanges(
    snapshot: CanvasRunSnapshot | null,
    changes: readonly CanvasNodeStatusChange[],
): CanvasRunSnapshot | null {
    if (!snapshot) return null;
    const nodes: Record<string, CanvasNodeRuntime> = { ...snapshot.nodes };
    for (const change of changes) {
        nodes[change.nodeId] = {
            id: change.id,
            status: change.status,
            ...change.skipReason === undefined ? {} : { skipReason: change.skipReason },
            ...change.error === undefined ? {} : { error: change.error },
            ...change.recovered === undefined ? {} : { recovered: change.recovered },
            ...change.startedAt === undefined ? {} : { startedAt: change.startedAt },
            ...change.endedAt === undefined ? {} : { endedAt: change.endedAt },
        };
    }
    return { ...snapshot, nodes };
}

/** 单次状态变更的一行说明 / one line describing a status change */
export function changeDetail(change: CanvasNodeStatusChange): string {
    if (change.error) return `${change.error.code}: ${change.error.message}`;
    if (change.recovered) return `recovered ${change.recovered.code}: ${change.recovered.message}`;
    if (change.skipReason) return `skip: ${change.skipReason}`;
    const elapsed = durationMs(change);
    return elapsed === undefined ? '' : `${elapsed} ms`;
}

/** 节点耗时（毫秒）/ node duration in milliseconds */
export function durationMs(runtime: Pick<CanvasNodeRuntime, 'startedAt' | 'endedAt'>): number | undefined {
    if (runtime.startedAt === undefined || runtime.endedAt === undefined) return undefined;
    return Math.max(0, runtime.endedAt - runtime.startedAt);
}

/** JSON 展示文本（undefined 也可见）/ JSON display text (undefined stays visible) */
export function jsonText(value: unknown): string {
    if (value === undefined) return 'undefined';
    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        return String(value);
    }
}

/** 一个已注册 flow 的页面描述 / page descriptor of one registered flow */
export interface FlowDescriptor {
    id: string;
    label: string;
    note: string;
    nodes: number;
    edges: number;
    outputs: string[];
}

/** SSE/HTTP 共享的运行状态消息 / run-state message shared by SSE and HTTP */
export interface RunStateMessage {
    snapshot: CanvasRunSnapshot;
    changes: CanvasNodeStatusChange[];
    finished: boolean;
}

/** POST /api/runs 的响应 / response of POST /api/runs */
export interface StartRunResponse {
    runId: string;
    flowId: string;
}
