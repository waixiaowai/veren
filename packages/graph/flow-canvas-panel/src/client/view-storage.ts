/**
 * Reload handoff persistence for the canvas panel store.
 *
 * A full page reload loses the in-memory store, so the selected flow id and the
 * current run id are written through a minimal storage face (`sessionStorage`
 * in the browser). Malformed or foreign data is discarded instead of trusted;
 * a blocked storage must never break the panel.
 *
 * 画布面板 store 的刷新交接持久化。整页刷新会丢掉内存 store，因此选中的 flowId 与
 * 当前 runId 通过最小存储接口（浏览器里是 `sessionStorage`）落盘。畸形或外来数据
 * 一律丢弃；存储被阻断绝不能弄坏面板。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/view-storage
 */

import type { FlowCanvasViewStorage } from './view-state.ts'

/** Session-scoped handoff key across a full page reload. */
export const STORAGE_KEY = 'dsh.flow-canvas.view'

/** The persisted subset that survives a reload. */
export interface SavedView {
    readonly flowId?: string | undefined
    readonly runId?: string | undefined
}

/** Narrow parsed JSON to a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read the persisted view, discarding malformed or foreign data. */
export function readSaved(storage: FlowCanvasViewStorage | null): SavedView {
    try {
        const raw = storage?.getItem(STORAGE_KEY)
        if (raw === null || raw === undefined) return {}
        const value: unknown = JSON.parse(raw)
        if (!isRecord(value)) return {}
        const flowId = value['flowId']
        const runId = value['runId']
        return {
            ...typeof flowId === 'string' ? { flowId } : {},
            ...typeof runId === 'string' ? { runId } : {},
        }
    } catch {
        return {}
    }
}

/**
 * Write the persisted view; an empty view clears the key.
 * @param storage - the persistence face, or `null` to disable persistence.
 * @param next - the saved subset to write.
 */
export function persistView(storage: FlowCanvasViewStorage | null, next: SavedView): void {
    try {
        if (next.flowId === undefined && next.runId === undefined) storage?.removeItem(STORAGE_KEY)
        else storage?.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
        // A blocked storage must not break the panel; reload resume is optional.
        // 被阻断的存储不能弄坏面板；刷新恢复是可选能力。
    }
}

/** Resolve the browser session storage without throwing in privacy modes. */
export function defaultStorage(): FlowCanvasViewStorage | null {
    try {
        return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage
    } catch {
        return null
    }
}
