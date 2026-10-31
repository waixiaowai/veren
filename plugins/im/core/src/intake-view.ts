/**
 * The stranger-intake audit view: projecting durable intake rows onto the
 * status counts and the recent-records list the panel and the `im_intake` tool
 * read.
 *
 * 陌生人采集的审计视图：把持久化 intake 行投影为状态计数与最近记录列表，供面板与
 * `im_intake` 工具读取。
 *
 * @module @veren/im/intake-view
 */

import type { ImPersonView } from './people.ts'
import type { ImPersonIntakeRow } from './store.ts'
import type { ImIntakeRecordView } from './intake-types.ts'

/** Effective status, treating an overdue `asked` as expired for display. */
/** 有效状态：展示时把过期的 `asked` 视为 expired。 */
export function effectiveStatus(
  row: ImPersonIntakeRow,
  now: number,
  replyWindowMs: number,
): ImIntakeRecordView['status'] {
  if (row.status !== 'asked') return row.status
  return now > row.asked_at + replyWindowMs ? 'expired' : 'asked'
}

/** Per-status tally used by the audit view. */
/** 审计视图使用的按状态计数。 */
export function countsOf(
  rows: ImPersonIntakeRow[],
  now: number,
  replyWindowMs: number,
): Record<ImIntakeRecordView['status'], number> {
  const counts: Record<ImIntakeRecordView['status'], number> = { asked: 0, answered: 0, declined: 0, expired: 0 }
  for (const row of rows) counts[effectiveStatus(row, now, replyWindowMs)] += 1
  return counts
}

/** Project one row and its person onto the audit view. */
/** 把一行及其人员投影到审计视图上。 */
export function viewOf(
  row: ImPersonIntakeRow,
  person: ImPersonView | undefined,
  now: number,
  replyWindowMs: number,
): ImIntakeRecordView {
  return {
    personId: row.person_id,
    personName: person?.displayName ?? row.person_id,
    ...(person?.claimedName === undefined ? {} : { claimedName: person.claimedName }),
    status: effectiveStatus(row, now, replyWindowMs),
    provider: row.provider,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    askedAt: row.asked_at,
    askMessageId: row.ask_message_id,
    askText: row.ask_text,
    expiresAt: row.asked_at + replyWindowMs,
    ...(row.settled_at === undefined ? {} : { settledAt: row.settled_at }),
    ...(row.outcome === undefined ? {} : { outcome: row.outcome }),
    ...(row.reply_message_id === undefined ? {} : { replyMessageId: row.reply_message_id }),
    ...(row.reply_excerpt === undefined ? {} : { replyExcerpt: row.reply_excerpt }),
  }
}
