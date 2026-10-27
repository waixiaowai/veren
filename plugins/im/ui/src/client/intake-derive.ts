/**
 * Pure derivations for the intake tab: the funnel order, the waiting/audit
 * split, the empty verdict, and duration splitting. No React, no host calls —
 * unit-testable as-is; the components stay presentation-only.
 *
 * 采集页签的纯派生：漏斗顺序、等待/审计分流、空态判定与时长拆分。不碰 React、不调宿主，
 * 可直接单测；组件层只做呈现。
 *
 * @module @veren/im-ui/client/intake-derive
 */

import type { ImIntakeStatusView } from './remote.ts'

/** One intake record, derived from the host view instead of a shadow copy. */
export type IntakeRow = ImIntakeStatusView['recent'][number]

/** The host's closed status set, derived from the counts record. */
export type IntakeStatus = keyof ImIntakeStatusView['counts']

/** One funnel cell: a status and its count. */
export interface IntakeFunnelCell {
  readonly status: IntakeStatus
  readonly count: number
}

/**
 * Funnel order: the waiting head first, then the settled outcomes, the legacy
 * terminal state last (rows are no longer marked expired — see
 * `ImStrangerIntakeConfig.replyWindowMs`).
 * 漏斗顺序：等待头部在前，收尾结果居中，遗留终态殿后（行不再被打成 expired——见
 * `ImStrangerIntakeConfig.replyWindowMs`）。
 */
export const INTAKE_ORDER = ['asked', 'answered', 'declined', 'expired'] as const satisfies readonly IntakeStatus[]

/** The typed zero counts, for the loose wire's missing `counts` field. */
export const EMPTY_INTAKE_COUNTS: ImIntakeStatusView['counts'] = {
  asked: 0, answered: 0, declined: 0, expired: 0,
}

/** The counts as funnel cells in {@link INTAKE_ORDER} order, missing keys read as 0. */
export function funnelCells(counts: ImIntakeStatusView['counts']): readonly IntakeFunnelCell[] {
  return INTAKE_ORDER.map(status => ({ status, count: counts[status] ?? 0 }))
}

/** Rows still waiting on a reply, newest ask first. */
export function pendingRows(recent: readonly IntakeRow[]): readonly IntakeRow[] {
  return recent.filter(row => row.status === 'asked').sort((a, b) => b.askedAt - a.askedAt)
}

/** Settled rows for the audit trail, newest ask first. */
export function auditRows(recent: readonly IntakeRow[]): readonly IntakeRow[] {
  return recent.filter(row => row.status !== 'asked').sort((a, b) => b.askedAt - a.askedAt)
}

/**
 * The tab's designed empty state: every count is zero and no rows exist at all.
 * 专门设计的空态：全部计数为零且完全没有行。
 */
export function intakeUntouched(counts: ImIntakeStatusView['counts'], recent: readonly IntakeRow[]): boolean {
  return funnelCells(counts).every(cell => cell.count === 0) && recent.length === 0
}

/**
 * Split milliseconds into a whole number plus a dictionary unit word; zero
 * reads as seconds so it never renders a fractional "0 minutes".
 * 把毫秒拆成整数与字典单位词；零按秒呈现，避免出现小数式的「0 分钟」。
 */
export function splitDuration(ms: number): { value: number; unit: 'minutes' | 'seconds' } {
  if (ms === 0) return { value: 0, unit: 'seconds' }
  return ms % 60_000 === 0
    ? { value: ms / 60_000, unit: 'minutes' }
    : { value: ms / 1_000, unit: 'seconds' }
}
