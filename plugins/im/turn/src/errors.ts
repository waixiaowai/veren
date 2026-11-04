/**
 * Shared one-line helpers for the turn package.
 *
 * 回合包共用的一行助手。
 *
 * @module @veren/im-turn/errors
 */

/** Turn an unknown value into one log line. */
/** 把未知值压成一行日志。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
