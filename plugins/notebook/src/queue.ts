/**
 * The intake face: one box's fleeting cards and the ones past their freshness
 * window — the feedstock queue the flywheel is fed through. Derived entirely
 * from the notes table: a query, never a schema. The window never deletes —
 * aging only changes visibility, because the throw-away is a conscious
 * terminal action (Ahrens: fleeting notes are reminders, discarded after
 * processing), never a timer.
 *
 * 进料面：某盒的闪念卡与其中过了保鲜窗的那些——喂养飞轮的进料队列。完全派生自
 * notes 表：是查询，不是 schema。窗口从不删除——老化只改变可见性，因为"扔"是
 * 一个有意识的终局动作（Ahrens：闪念是提醒物，加工完后丢弃），绝不是定时器。
 *
 * @module @veren/notebook/queue
 */

import { noteSummary } from './notes.ts'
import type { NotebookTable } from './storage.ts'
import type { BoxIntakeView, NoteRecord } from './types.ts'

/**
 * The freshness window before a fleeting card floats to the top of the intake
 * queue — Ahrens's "a day or two", taken at two.
 * 闪念卡浮到进料队列顶部前的保鲜窗——Ahrens 的"一两天"，取两天。
 */
export const FLEETING_DAYS = 2

/**
 * One box's intake: every fleeting card (oldest first) plus the overdue ones
 * (oldest first) — the list the AI should face first when it re-enters the
 * box, proposing each card be promoted or consciously trashed.
 * @param notes - the notes table.
 * @param owner - preset id whose box is screened.
 * @param nowMs - the current time in epoch milliseconds.
 * @param days - the freshness window in days (default {@link FLEETING_DAYS}).
 * @returns the intake face.
 *
 * 某盒的进料：全部闪念卡（最早优先）加其中过期的（最早优先）——AI 重入盒时该
 * 最先面对的清单，对每张卡提议"炼成永久卡或有意识地扔掉"。
 */
export function intakeView(notes: NotebookTable<NoteRecord>, owner: string, nowMs: number, days = FLEETING_DAYS): BoxIntakeView {
  const fleet = notes.all()
    .filter(record => record.owner === owner && record.kind === 'fleeting')
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id))
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000
  const overdue = fleet.filter(record => Date.parse(record.updatedAt) <= cutoffMs)
  return { fleet: fleet.map(noteSummary), overdue: overdue.map(noteSummary) }
}

/** One overdue check the window's tests reuse: is this card past its window? 窗口测试复用的一条过期判定：该卡过窗了吗？ */
export function isOverdue(record: NoteRecord, nowMs: number, days = FLEETING_DAYS): boolean {
  return Date.parse(record.updatedAt) <= nowMs - days * 24 * 60 * 60 * 1000
}
