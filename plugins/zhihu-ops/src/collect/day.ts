/**
 * 日期键工具：采集的幂等性建立在"本地日期键"上。
 *
 * 键是本地时区的 `YYYY-MM-DD`——因为"今天"对运营者来说是本地日历日，不是
 * UTC 日。按这个键 upsert，同一天重采就是覆盖，重启也不会写出两份。
 *
 * The date-key helpers: the pull's idempotency rests on the local date key.
 *
 * A key is a local-timezone `YYYY-MM-DD` — because "today" for the operator is
 * a local calendar day, not a UTC one. Upserting by this key makes a repeat
 * pull on the same day an overwrite, and a restart never writes two.
 *
 * @module @veren/zhihu-ops/collect/day
 */

/** 钟面来源（注入以便测试）/ the clock source (injected for tests) */
export type Clock = () => Date

/**
 * 取本地日期键 `YYYY-MM-DD`。
 * Reads the local date key `YYYY-MM-DD`.
 *
 * @param now - the instant / 时刻
 * @returns the date key / 日期键
 */
export function dayKey(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 日期键减 n 天（仍是本地日历日）。
 * A date key minus n days (still a local calendar day).
 *
 * @param key - the date key / 日期键
 * @param days - how many days back / 往前几天
 * @param now - the clock source / 钟面来源
 * @returns the shifted date key / 平移后的日期键
 */
export function shiftDay(key: string, days: number, now: () => Date = () => new Date()): string {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10))
  const base = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  base.setDate(base.getDate() - days)
  return dayKey(base)
}

/**
 * 判断某个日期键是不是"今天"（本地日历）。
 * Whether a date key is today (local calendar).
 *
 * @param key - the date key / 日期键
 * @param now - the clock source / 钟面来源
 * @returns true when it is today / 是今天则 true
 */
export function isToday(key: string, now: () => Date = () => new Date()): boolean {
  return key === dayKey(now())
}

/**
 * 两个日期键之间相差的天数（b 比 a 晚多少天）。
 * How many days lie between two date keys (how much later b is than a).
 *
 * @param earlier - the earlier key / 较早的键
 * @param later - the later key / 较晚的键
 * @returns the day difference / 天数差
 */
export function daysBetween(earlier: string, later: string): number {
  const toInstant = (key: string): number => {
    const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10))
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  }
  return Math.round((toInstant(later) - toInstant(earlier)) / (24 * 60 * 60 * 1000))
}
