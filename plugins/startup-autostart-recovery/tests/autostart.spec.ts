/**
 * Unit specs for the Windows logon-autostart writer. Every spec passes an
 * explicit temp Startup folder, so the user's real Startup folder, registry,
 * and scheduled tasks are never touched.
 *
 * 并发安全：每个用例使用独立临时目录，绝不写真实的启动文件夹。
 * Concurrency safe: every spec uses its own temp folder; the real Startup
 * folder is never touched.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AutostartConfigError, ENTRY_NAME, autostartStatus, disableAutostart, enableAutostart, entryPath } from '../src/os-autostart.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One fresh fake Startup folder per spec. */
function startupFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'startup-recovery-autostart-'))
  roots.push(folder)
  return folder
}

describe('logon autostart entry', () => {
  it('starts off, enables by writing one plain file, and reports the full path', () => {
    const folder = startupFolder()
    expect(autostartStatus(folder).enabled).toBe(false)
    expect(autostartStatus(folder).entryPath).toBe(entryPath(folder))

    const status = enableAutostart(folder, '"C:\\apps\\DeepSeek Harness.exe"')
    expect(status.enabled).toBe(true)
    expect(status.entryPath).toContain(ENTRY_NAME)
    const body = readFileSync(entryPath(folder), 'utf8')
    expect(body).toContain('start "" "C:\\apps\\DeepSeek Harness.exe"')
  })

  it('undoes with one disable call, whether or not the entry exists', () => {
    const folder = startupFolder()
    enableAutostart(folder, 'dsh web --port 3080')
    expect(disableAutostart(folder).enabled).toBe(false)
    expect(existsSync(entryPath(folder))).toBe(false)
    // Undoing an already-off entry stays a no-op, not an error.
    // 对本就未开启的条目撤销是无害空操作，而不是报错。
    expect(disableAutostart(folder).enabled).toBe(false)
  })

  it('refuses to enable without a command and fails loud with a stable code', () => {
    const folder = startupFolder()
    try {
      enableAutostart(folder, '   ')
      expect.unreachable('enable without a command must throw')
    } catch (error: unknown) {
      if (error instanceof AutostartConfigError) {
        expect(error.code).toBe('autostart_command_missing')
      } else {
        expect.unreachable(`unexpected error: ${String(error)}`)
      }
    }
    expect(autostartStatus(folder).enabled).toBe(false)
  })

  it('enabling twice rewrites the same entry instead of duplicating it', () => {
    const folder = startupFolder()
    enableAutostart(folder, 'one')
    enableAutostart(folder, 'two')
    expect(readFileSync(entryPath(folder), 'utf8')).toContain('two')
    expect(autostartStatus(folder).enabled).toBe(true)
  })
})
