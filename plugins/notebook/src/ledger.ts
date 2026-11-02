/**
 * The lifecycle ledger: append-only rows, one per transition, plus each riddle
 * a write closes — the fact base the breathing readout counts. Append-only by
 * discipline: nothing rewrites or deletes a row, so the rates stay honest
 * across restarts.
 *
 * 生命周期账表：追加式行，每次转移一行，外加每条被写入闭合的谜面——呼吸读数
 * 所数的事实基底。以追加为纪律：任何东西都不改写、不删除一行，因此比率跨重启
 * 保持诚实。
 *
 * @module @veren/notebook/ledger
 */

import { mintNoteId } from './notes.ts'
import type { NotebookTable } from './storage.ts'
import type { LedgerAction, LedgerRecord } from './types.ts'

/**
 * Append one lifecycle row.
 * @param ledger - the ledger table.
 * @param owner - preset id whose box moved.
 * @param cardId - the card the action touched.
 * @param action - the transition or the riddle closure.
 * @param at - ISO instant of the action.
 */
export async function appendLedger(
  ledger: NotebookTable<LedgerRecord>,
  owner: string,
  cardId: string,
  action: LedgerAction,
  at: string,
): Promise<void> {
  const key = mintNoteId()
  await ledger.put(key, { key, owner, cardId, action, at })
}

/**
 * Read one owner's rows since an epoch instant, oldest first.
 * @param ledger - the ledger table.
 * @param owner - preset id whose rows are read.
 * @param sinceMs - window start in epoch milliseconds.
 * @returns the rows in the window.
 */
export function ledgerSince(ledger: NotebookTable<LedgerRecord>, owner: string, sinceMs: number): LedgerRecord[] {
  return ledger.all()
    .filter(row => row.owner === owner && Date.parse(row.at) >= sinceMs)
    .sort((left, right) => left.at.localeCompare(right.at) || left.key.localeCompare(right.key))
}
