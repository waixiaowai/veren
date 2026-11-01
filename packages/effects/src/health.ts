/**
 * Health surface of the effects core, ported from the official
 * `HealthBoard`-backed reporting in `src/app/effects.ts` (MIT, read-only
 * reference): one snapshot per kind, an error only after
 * {@link FAILURES_BEFORE_ERROR} consecutive failures of one row, and a
 * queue-level failure reported under the kind's name until a dispatch of
 * that kind succeeds again.
 *
 * The official core writes into claimed `HealthBoard` entries; a
 * storage-agnostic core instead hands snapshots to an {@link EffectHealthSink},
 * which the host adapts to its own health board, logs, or metrics.
 *
 * 效果核的健康面，移植自官方 `src/app/effects.ts` 里基于 `HealthBoard` 的上报
 * （MIT，只读参照）：每种 kind 一份快照，同一行连续失败 {@link FAILURES_BEFORE_ERROR}
 * 次才报 error，队列自身的失败挂在对应 kind 名下、直到该 kind 的下一次派发成功为止。
 * 官方核写进认领的 `HealthBoard` 条目；存储无关核改为把快照交给 {@link EffectHealthSink}，
 * 由宿主适配到自己的健康板、日志或指标。
 *
 * @module @veren/effects/health
 */

import type { EffectRow } from './rows.ts'

/** 一行连续失败多少次后，其 kind 才报健康错误 / consecutive row failures before a kind reports an error */
export const FAILURES_BEFORE_ERROR = 3

/** One health snapshot, shaped like the official `HealthEntry.set` payload. */
export interface EffectHealthSnapshot {
  readonly state: 'ready' | 'error'
  readonly detail: string
  readonly at: string
}

/**
 * Where snapshots go. The host adapts this to whatever surface it has; the
 * core only guarantees `set` is called after every state change it observes.
 * 快照的去处。宿主把它适配到任何自己的面上；核只保证每观察一次状态变化就调一次 `set`。
 */
export interface EffectHealthSink {
  set(kind: string, snapshot: EffectHealthSnapshot): void
}

/**
 * Snapshot for a kind from its waiting rows, mirroring the official `report`:
 * ready while nothing waits or while the worst row is below the failure
 * threshold (or the kind is quiet), error once a row failed
 * {@link FAILURES_BEFORE_ERROR} times in a row. `rows` must be sorted by
 * `seq` so the reported failure is the latest one.
 *
 * Deliberate deviation, documented in the README: the official detail embeds
 * `since <enqueue instant>`, but the ported row contract (per the S1 task)
 * carries no `since` column, so the detail states the waiting count only.
 *
 * / 由某 kind 的等待行算出的快照，对应官方的 `report`：没有等待行、或最差行未到失败
 * 阈值（或该 kind 静默）时 ready；某行连续失败 {@link FAILURES_BEFORE_ERROR} 次后
 * error。`rows` 必须按 `seq` 排序，上报的才是最新一次失败。有意偏差（README 已注）：
 * 官方 detail 带 `since <入队时刻>`，但按 S1 任务书移植的行契约没有 `since` 列，
 * detail 只报等待数。
 */
export function waitingSnapshot(rows: readonly EffectRow[], quiet: boolean, at: string): EffectHealthSnapshot {
  const waiting = rows.length
  const detail = waiting > 0 ? `${waiting} waiting` : 'Nothing waiting'
  const worst = rows.reduce((max, row) => Math.max(max, row.attempts), 0)
  const lastError = [...rows].reverse().find(row => row.attempts > 0)?.error
  if (worst >= FAILURES_BEFORE_ERROR && !quiet && lastError !== undefined) {
    return { state: 'error', detail: `${detail}; the last failure: ${lastError}`, at }
  }
  return { state: 'ready', detail, at }
}

/**
 * Snapshot for a failure of the queue machinery itself (a dispatch throw,
 * a backend error), worded like the official `failed`.
 * / 队列机构自身失败（派发抛错、后端报错）时的快照，措辞同官方 `failed`。
 */
export function brokenSnapshot(error: unknown, at: string): EffectHealthSnapshot {
  return { state: 'error', detail: `The effect queue failed: ${String(error)}`, at }
}
