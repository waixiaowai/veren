/**
 * The run blackboard: the per-run key/value space nodes exchange slots through,
 * plus the slot-ref resolution and output-slot normalization helpers.
 *
 * 运行黑板：节点之间交换 slot 的单次运行键值空间，以及 slot 引用解析与输出 slot
 * 归一化辅助函数。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/blackboard
 */

import type { FlowBlackboard, NodeId } from '@deepseek-ai/dsh-graph-flow-api';

/** 内存黑板：`${nodeId}.${slot}` 命名空间 / in-memory blackboard keyed by `${nodeId}.${slot}` */
export function createBlackboard(): FlowBlackboard {
    const slots = new Map<string, unknown>();
    return {
        read: (nodeId, slot) => slots.get(`${nodeId}.${slot}`),
        write: (nodeId, slot, value) => void slots.set(`${nodeId}.${slot}`, value),
        snapshot: () => Object.fromEntries(slots),
    };
}

/** 解析 `${nodeId.slot}` 引用；非引用原样返回 / resolve a slot ref; pass literals through */
export function resolveInputValue(value: unknown, blackboard: FlowBlackboard): unknown {
    if (typeof value !== 'string') return value;
    const match = /^\$\{([^}.]+)\.([^}]+)\}$/.exec(value);
    if (!match) return value;
    return blackboard.read(match[1]!, match[2]!);
}

/** 归一化节点产出为命名 slot / normalize a node output into named slots */
export function toSlots(output: unknown): Record<string, unknown> {
    if (output !== null && typeof output === 'object' && !Array.isArray(output)) {
        return output as Record<string, unknown>;
    }
    return { out: output };
}

/**
 * errorBranch 兜底失败事实：从黑板 error slot 读成稳定结构。
 * The recovered failure fact of an errorBranch fallback, read from the
 * blackboard's error slot into a stable structure.
 */
export function recoveredFailure(
    blackboard: FlowBlackboard | undefined,
    nodeId: NodeId,
): { code: string; message: string } | undefined {
    const value = blackboard?.read(nodeId, 'error');
    if (value === undefined) return undefined;
    const summary = value as { code?: unknown; message?: unknown };
    return typeof summary?.code === 'string' && typeof summary.message === 'string'
        ? { code: summary.code, message: summary.message }
        : { code: 'NODE_FAILED', message: String(value) };
}
