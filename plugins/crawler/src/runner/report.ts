/**
 * 进程级进度日志：子进程运行器把 stdout 泵进日志缓冲，这是采集进程唯一
 * 的进度出口（模型侧用 crawler__logs 读）。
 * The process-level progress log: the subprocess runner pumps stdout into
 * the log buffer, so this is the crawl process's only progress outlet (the
 * model reads it through crawler__logs).
 *
 * @module @veren/crawler/runner/report
 */

/** 输出一行进度（INFO 级别，带前缀）/ emits one progress line (INFO level, prefixed) */
export function report(message: string): void {
  console.log(`[INFO] ${message}`)
}
