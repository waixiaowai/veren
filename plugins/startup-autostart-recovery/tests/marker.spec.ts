/**
 * Unit specs for the shutdown marker: the flag lifecycle, the claim that
 * bounds one crash to one recovery, and the last-session record.
 *
 * 并发安全：每个用例使用独立临时目录，不共享任何状态。
 * Concurrency safe: every spec uses its own temp directory.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claimBootFlag, clearBootFlag, readLastSession, saveLastSession } from '../src/marker.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One fresh state directory per spec. */
function stateDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'startup-recovery-marker-'))
  roots.push(root)
  return root
}

describe('boot flag', () => {
  it('reads clean on the first boot and claims the flag', () => {
    const dir = stateDir()
    const claim = claimBootFlag(dir, 'boot-1', '2026-01-01T00:00:00.000Z')
    expect(claim.unclean).toBe(false)
    expect(existsSync(join(dir, 'boot-flag.json'))).toBe(true)
  })

  it('reads unclean when a previous flag was never cleared', () => {
    const dir = stateDir()
    claimBootFlag(dir, 'boot-1', '2026-01-01T00:00:00.000Z')
    const claim = claimBootFlag(dir, 'boot-2', '2026-01-02T00:00:00.000Z')
    expect(claim.unclean).toBe(true)
    expect(claim.previous?.bootId).toBe('boot-1')
  })

  it('reads clean again after a graceful clear', () => {
    const dir = stateDir()
    claimBootFlag(dir, 'boot-1', '2026-01-01T00:00:00.000Z')
    clearBootFlag(dir)
    expect(claimBootFlag(dir, 'boot-2', '2026-01-02T00:00:00.000Z').unclean).toBe(false)
  })

  it('counts a corrupt flag as unclean, never as clean', () => {
    const dir = stateDir()
    writeFileSync(join(dir, 'boot-flag.json'), '{not json')
    const claim = claimBootFlag(dir, 'boot-2', '2026-01-02T00:00:00.000Z')
    expect(claim.unclean).toBe(true)
    expect(claim.previous).toBeUndefined()
  })
})

describe('last active session record', () => {
  it('round-trips one session and reads absent when there is none', () => {
    const dir = stateDir()
    expect(readLastSession(dir)).toBeUndefined()
    saveLastSession(dir, { sessionId: 'session-x', at: '2026-01-01T00:00:00.000Z' })
    expect(readLastSession(dir)).toEqual({ sessionId: 'session-x', at: '2026-01-01T00:00:00.000Z' })
  })

  it('reads a malformed record as absent instead of failing', () => {
    const dir = stateDir()
    writeFileSync(join(dir, 'last-session.json'), '{"sessionId":42}')
    expect(readLastSession(dir)).toBeUndefined()
  })
})
