/**
 * The on-disk shutdown marker and the last-active-session record.
 *
 * The marker must live on disk, not in memory: a killed process or a power cut
 * never runs cleanup code, and that is exactly the case this marker exists to
 * catch. Semantics: the flag file is written at boot (the claim) and removed
 * only by a graceful shutdown, so "flag present at the next boot" means the
 * previous process died without reaching its cleanup - an unclean exit. A
 * first boot finds no flag and is treated as clean, because there is nothing
 * to recover yet.
 *
 * 落盘的收尾标记与最近活跃会话记录。标记必须落盘而不是放在内存里：被杀掉的进程
 * 或断电根本跑不到清理代码，而这正是标记要抓住的情况。语义：标记在启动时写入
 * （认领），只有正常收尾才删除；因此下次启动时"标记还在"就等于上次进程没有跑到
 * 收尾——异常退出。首次启动没有标记，按干净处理，因为还没有可恢复的东西。
 * @module @veren/startup-autostart-recovery/marker
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BootClaim, BootFlag, LastActiveSession } from './types.ts'

/** File name of the boot liveness flag inside the state directory. */
const FLAG_FILE = 'boot-flag.json'

/** File name of the last-active-session record inside the state directory. */
const LAST_SESSION_FILE = 'last-session.json'

/** Read and parse one JSON file; any failure reads as absent. */
function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/** Narrow parsed JSON onto a BootFlag without any type escape. */
function isBootFlag(value: unknown): value is BootFlag {
  return typeof value === 'object' && value !== null
    && 'bootId' in value && typeof value.bootId === 'string'
    && 'startedAt' in value && typeof value.startedAt === 'string'
}

/** Narrow parsed JSON onto a LastActiveSession without any type escape. */
function isLastActiveSession(value: unknown): value is LastActiveSession {
  return typeof value === 'object' && value !== null
    && 'sessionId' in value && typeof value.sessionId === 'string'
    && 'at' in value && typeof value.at === 'string'
}

/**
 * Write `data` to `path` through a staging file and a rename, so a crash can
 * never leave a half-written document where a reader expects whole JSON.
 */
function writeAtomic(path: string, data: string): void {
  const staging = `${path}.tmp`
  writeFileSync(staging, data)
  renameSync(staging, path)
}

/**
 * Claim this boot's liveness flag and report what the flag said beforehand.
 *
 * Claiming happens before any recovery decision is acted on, which is what
 * makes one crash recover at most once even if two processes raced to boot:
 * the first claim flips the flag, the second sees a fresh flag and reads clean.
 * A flag that exists but cannot be parsed still counts as unclean - the safe
 * direction is to offer recovery, not to swallow a crash.
 * @param stateDir - the directory holding the flag.
 * @param bootId - unique id of the boot claiming now.
 * @param startedAt - instant this boot started, ISO 8601.
 * @returns what the previous flag said, and whether the previous exit was unclean.
 */
export function claimBootFlag(stateDir: string, bootId: string, startedAt: string): BootClaim {
  mkdirSync(stateDir, { recursive: true })
  const path = join(stateDir, FLAG_FILE)
  const existed = existsSync(path)
  const parsed = readJsonFile(path)
  const flag: BootFlag = { bootId, startedAt }
  writeAtomic(path, `${JSON.stringify(flag, undefined, 2)}\n`)
  if (!existed) return { unclean: false }
  return isBootFlag(parsed)
    ? { unclean: true, previous: parsed }
    : { unclean: true }
}

/** Remove the boot flag: the one thing only a graceful shutdown may do. */
export function clearBootFlag(stateDir: string): void {
  rmSync(join(stateDir, FLAG_FILE), { force: true })
}

/** Persist the last active session, overwriting any earlier record. */
export function saveLastSession(stateDir: string, session: LastActiveSession): void {
  mkdirSync(stateDir, { recursive: true })
  writeAtomic(join(stateDir, LAST_SESSION_FILE), `${JSON.stringify(session, undefined, 2)}\n`)
}

/**
 * Read the last active session, if one was recorded and is well-formed.
 * @param stateDir - the directory holding the record.
 * @returns the record, or undefined when there is none.
 */
export function readLastSession(stateDir: string): LastActiveSession | undefined {
  const parsed = readJsonFile(join(stateDir, LAST_SESSION_FILE))
  return isLastActiveSession(parsed) ? parsed : undefined
}
