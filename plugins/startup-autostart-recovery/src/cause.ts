/**
 * The real cause of an unclean exit, taken from the desktop crash logs.
 *
 * The red line is honesty: the recovery prompt quotes whatever this module
 * returns verbatim, so the module returns a cause only when a crash log in
 * `%APPDATA%\@deepseek-ai\dsh-desktop\logs` is newer than the previous boot's
 * start instant - otherwise it returns the explicit "cause unknown" wording.
 * It never guesses, and it never blames an old crash it cannot bound.
 *
 * 异常退出的真实原因，取自桌面版崩溃日志。红线是如实：恢复提示词会原样引用本模块
 * 的返回，因此只有当 `%APPDATA%\@deepseek-ai\dsh-desktop\logs` 里有比上次启动时刻
 * 更新的崩溃日志时才给出原因，否则返回明确的「原因未知」措辞。绝不猜测，也绝不把
 * 无法归期的旧崩溃算到这次头上。
 * @module @veren/startup-autostart-recovery/cause
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CrashCause } from './types.ts'

/** How much of a crash log the cause text quotes, in characters. */
const EXCERPT_LENGTH = 200

/** The explicit unknown-cause wording, used whenever no log proves a cause. */
export const UNKNOWN_CAUSE_TEXT = '原因未知（未找到崩溃日志）'

/**
 * The desktop crash-log directory. Kept close to `findCrashCause` because the
 * two are one fact: the default place this module looks.
 * @returns the directory path under the user's roaming profile.
 */
export function defaultCrashLogDir(): string {
  const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming')
  return join(appData, '@deepseek-ai', 'dsh-desktop', 'logs')
}

/**
 * The newest `crash-*.log` in `dir`, or undefined when the directory is
 * missing, unreadable, or holds none.
 */
function newestCrashLog(dir: string): string | undefined {
  let newest: { readonly name: string; readonly at: number } | undefined
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('crash-') || !name.endsWith('.log')) continue
    try {
      const at = statSync(join(dir, name)).mtimeMs
      if (newest === undefined || at > newest.at) newest = { name, at }
    } catch {
      // An entry that vanished between readdir and stat is simply skipped.
      // 在 readdir 与 stat 之间消失的条目直接跳过。
    }
  }
  return newest?.name
}

/** The log's first line(s), bounded, for the prompt's cause text. */
function boundedExcerpt(path: string): string {
  try {
    const text = readFileSync(path, 'utf8').replaceAll(/\s+/g, ' ').trim()
    return text.length <= EXCERPT_LENGTH ? text : `${text.slice(0, EXCERPT_LENGTH - 1)}…`
  } catch {
    return '（日志不可读）'
  }
}

/**
 * Establish the previous exit's cause as far as it can be established honestly.
 * @param dir - the crash-log directory to inspect.
 * @param previousStartedAt - when the previous boot started, from its boot
 *   flag; a log must be newer than this to count, and when absent no log can
 *   be bounded to the crash, so the cause stays unknown.
 * @returns the cause, wording included.
 */
export function findCrashCause(dir: string, previousStartedAt?: string): CrashCause {
  const since = previousStartedAt === undefined ? undefined : Date.parse(previousStartedAt)
  let name: string | undefined
  try {
    const found = newestCrashLog(dir)
    if (found !== undefined && (since === undefined || statSync(join(dir, found)).mtimeMs > since)) {
      name = found
    }
  } catch {
    name = undefined
  }
  if (name === undefined) return { found: false, detail: UNKNOWN_CAUSE_TEXT }
  return { found: true, logFile: name, detail: `崩溃日志 ${name}：${boundedExcerpt(join(dir, name))}` }
}

/**
 * The recovery prompt one unclean exit delivers. The wording is deliberately
 * repeatable: it never claims to be the first recovery, so a redelivery with a
 * stale marker would still read true.
 * @param cause - the honestly established cause.
 * @returns the full prompt text.
 */
export function recoveryMessageText(cause: CrashCause): string {
  return `DSH 系统由于 ${cause.detail} 退出后重启，请继续未完成的工作。`
}
