/**
 * Date and time rendering for the panel.
 *
 * One entry point for every timestamp the page shows (design §23.7: dates go
 * through a single formatter, never hand-built strings).
 *
 * 面板的日期与时间渲染。
 *
 * 页面显示的所有时间戳都走这一个入口（设计 §23.7：日期只经一个格式化入口，不手工拼字符串）。
 *
 * @module @veren/im-ui/client/format
 */

import type { ImKey } from './locales.ts'

/** Milliseconds in one day. */
const DAY_MS = 86_400_000

/** Midnight of the timestamp's local day, as a comparable number. */
function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** The clock time of one message, in the reader's locale. */
export function clockOf(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

/**
 * The divider label above the first message of a day: today, yesterday, or the
 * local date.
 * @param timestamp - the message's creation time.
 * @param t - locale seat.
 * @returns a short day label.
 */
export function dayLabelOf(timestamp: number, t: (key: ImKey) => string): string {
  const day = startOfDay(timestamp)
  const today = startOfDay(Date.now())
  if (day === today) return t('dayToday')
  if (day === today - DAY_MS) return t('dayYesterday')
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
}

/**
 * The compact timestamp beside a room in the list: the clock for today, the
 * date otherwise.
 * @param timestamp - the room's last activity.
 * @returns a short label.
 */
export function roomStampOf(timestamp: number): string {
  if (startOfDay(timestamp) === startOfDay(Date.now())) return clockOf(timestamp)
  return new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' }).format(timestamp)
}
