/**
 * The box's breathing readout: kind mix, graph density, intake depth, and the
 * windowed flywheel rates. The task's first principle — the more goes in, the
 * more combines, the more sparks — is adjudicated by these numbers, not by the
 * implementer's word: density says whether the box compounds, the intake depth
 * says whether the feedstock is being processed, the rates say whether the
 * lifecycle actually moves.
 *
 * 盒的呼吸读数：类别构成、图密度、进料深度、窗口飞轮速率。任务的第一性原理
 * ——进得越多、组合越多、激发越多——由这些数字裁决，不由实现者自辩：密度说明
 * 盒在不在复利，进料深度说明进料有没有被加工，速率说明生命周期有没有真的在动。
 *
 * @module @veren/notebook/stats
 */

import { ledgerSince } from './ledger.ts'
import { FLEETING_DAYS, intakeView } from './queue.ts'
import type { NotebookTable } from './storage.ts'
import type { BoxIntakeView, BoxRateView, BoxStatsView, LedgerRecord, LinkRecord, NoteRecord } from './types.ts'

/** How many days one rates window spans. 速率窗口的天数。 */
export const RATES_WINDOW_DAYS = 7

/**
 * Compute one owner's breathing readout.
 * @param notes - the notes table.
 * @param links - the links cache table.
 * @param ledger - the lifecycle ledger table.
 * @param owner - preset id whose box is read.
 * @param nowMs - the current time in epoch milliseconds.
 * @param days - the fleeting freshness window in days (default {@link FLEETING_DAYS}).
 * @returns the readout; density counts graph citizens only (fleeting cards are
 *   not on the graph, so they never dilute it).
 *
 * 计算某归属的呼吸读数。密度只数图内公民（闪念不在图上，永不稀释它）。
 */
export function boxStats(
  notes: NotebookTable<NoteRecord>,
  links: NotebookTable<LinkRecord>,
  ledger: NotebookTable<LedgerRecord>,
  owner: string,
  nowMs: number,
  days = FLEETING_DAYS,
): BoxStatsView {
  const cards = { fleeting: 0, permanent: 0, project: 0 }
  for (const record of notes.all()) {
    if (record.owner !== owner) continue
    cards[record.kind] += 1
  }
  let linkRows = 0
  for (const row of links.all()) if (row.owner === owner) linkRows += 1
  const citizens = cards.permanent + cards.project
  const intake: BoxIntakeView = intakeView(notes, owner, nowMs, days)
  return {
    cards,
    links: linkRows,
    density: citizens === 0 ? 0 : Math.round((linkRows / citizens) * 100) / 100,
    intake,
    rates: ratesOf(ledger, owner, nowMs),
  }
}

/** Window the ledger into per-action counts. 把账表按窗口折算成逐动作计数。 */
function ratesOf(ledger: NotebookTable<LedgerRecord>, owner: string, nowMs: number): BoxRateView {
  const sinceMs = nowMs - RATES_WINDOW_DAYS * 24 * 60 * 60 * 1000
  let captured = 0
  let promoted = 0
  let trashed = 0
  let archived = 0
  let riddlesClosed = 0
  for (const row of ledgerSince(ledger, owner, sinceMs)) {
    if (row.action === 'captured') captured += 1
    else if (row.action === 'promoted') promoted += 1
    else if (row.action === 'trashed') trashed += 1
    else if (row.action === 'archived') archived += 1
    else riddlesClosed += 1
  }
  return { days: RATES_WINDOW_DAYS, captured, promoted, trashed, archived, riddlesClosed }
}
