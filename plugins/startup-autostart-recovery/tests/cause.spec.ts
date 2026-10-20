/**
 * Unit specs for the crash-cause lookup: the honesty red line is that a cause
 * is only ever quoted from a log that is newer than the previous boot, and
 * everything else reads as the explicit unknown wording.
 *
 * 并发安全：每个用例使用独立临时目录，不共享任何状态。
 * Concurrency safe: every spec uses its own temp directory.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UNKNOWN_CAUSE_TEXT, findCrashCause, recoveryMessageText } from '../src/cause.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One fresh crash-log directory, created on demand. */
function logDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'startup-recovery-cause-'))
  roots.push(root)
  const dir = join(root, 'logs')
  mkdirSync(dir)
  return dir
}

/** Write one crash log with an explicit mtime, so "newer than" is controllable. */
function crashLog(dir: string, name: string, body: string, mtime: Date): void {
  const path = join(dir, name)
  writeFileSync(path, body)
  utimesSync(path, mtime, mtime)
}

describe('crash cause', () => {
  it('reports unknown when the directory does not exist', () => {
    const cause = findCrashCause(join(tmpdir(), 'startup-recovery-nope'))
    expect(cause.found).toBe(false)
    expect(cause.detail).toBe(UNKNOWN_CAUSE_TEXT)
  })

  it('reports unknown when no log is newer than the previous boot', () => {
    const dir = logDir()
    crashLog(dir, 'crash-2025-web-boot.log', 'old crash', new Date('2025-06-01T00:00:00Z'))
    const cause = findCrashCause(dir, '2026-01-01T00:00:00.000Z')
    expect(cause.found).toBe(false)
    expect(cause.detail).toBe(UNKNOWN_CAUSE_TEXT)
  })

  it('quotes the newest log newer than the previous boot', () => {
    const dir = logDir()
    crashLog(dir, 'crash-1-web-boot.log', 'renderer went away', new Date('2026-01-01T02:00:00Z'))
    crashLog(dir, 'crash-2-web-boot.log', 'gpu process died', new Date('2026-01-01T03:00:00Z'))
    const cause = findCrashCause(dir, '2026-01-01T00:00:00.000Z')
    expect(cause.found).toBe(true)
    expect(cause.logFile).toBe('crash-2-web-boot.log')
    expect(cause.detail).toContain('gpu process died')
    expect(cause.detail).toContain('crash-2-web-boot.log')
  })

  it('ignores non-crash files and truncates long log bodies', () => {
    const dir = logDir()
    crashLog(dir, 'not-a-crash.log', 'boot log', new Date('2026-01-01T09:00:00Z'))
    crashLog(dir, 'crash-3-web-boot.log', 'x'.repeat(500), new Date('2026-01-01T08:00:00Z'))
    const cause = findCrashCause(dir, '2026-01-01T00:00:00.000Z')
    expect(cause.logFile).toBe('crash-3-web-boot.log')
    // 摘录本体 ≤200 字符，加上「崩溃日志 文件名：」前缀后 ≤240。
    // The excerpt itself is <=200 chars; the `崩溃日志 <file>：` prefix fits in 240.
    expect(cause.detail.length).toBeLessThanOrEqual(240)
  })
})

describe('recovery prompt text', () => {
  it('embeds the cause verbatim and never claims to be the first recovery', () => {
    const text = recoveryMessageText({ found: false, detail: UNKNOWN_CAUSE_TEXT })
    expect(text).toBe(`DSH 系统由于 ${UNKNOWN_CAUSE_TEXT} 退出后重启，请继续未完成的工作。`)
    expect(text).not.toContain('第一次')
    expect(text).not.toContain('first')
  })
})
