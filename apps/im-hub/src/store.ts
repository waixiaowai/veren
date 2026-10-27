/**
 * Durable state of the hub: the iLink session credentials, the per-conversation
 * context tokens, and the append-only per-device message queues.
 *
 * Files under the data directory: `hub-credentials.json` (0600), per-device
 * `hub-queue-<device>.jsonl` (append-only; the device cursor is a line seq, so
 * at-least-once delivery falls out of the log), and `hub-contexts.json` (the
 * last inbound context_token per conversation — replies need it after a
 * restart, otherwise iLink refuses with `-2`).
 *
 * 云端的持久化状态：iLink 会话凭据、按会话的 context token、以及按设备追加的消息队列。
 *
 * 数据目录下的文件：`hub-credentials.json`（0600）、按设备 `hub-queue-<device>.jsonl`
 * （只追加；设备侧游标是行号，至少一次投递由日志天然保证）、`hub-contexts.json`
 * （每会话最近一条入站 context_token——重启后回复需要它，否则 iLink 以 `-2` 拒绝）。
 *
 * @module im-hub/store
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The single iLink session's credentials and cursor. */
export interface HubCredentials {
  token: string
  ilinkBotId: string
  ownerId: string
  cursor: string
}

/** One routed message waiting for (or already delivered to) a device. */
export interface HubQueuedMessage {
  seq: number
  id: string
  conversationId: string
  sender: string
  text: string
  sentAt: number
}

/** Append-only queue of one device, mirrored in memory. */
export class DeviceQueue {
  private seq = 0
  private readonly log: HubQueuedMessage[] = []

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.trim() === '') continue
        const row = JSON.parse(line) as HubQueuedMessage
        this.log.push(row)
        this.seq = Math.max(this.seq, row.seq)
      }
    }
  }

  /** Append one message; durable before the caller hands it to a poller. */
  append(message: Omit<HubQueuedMessage, 'seq'>): HubQueuedMessage {
    this.seq += 1
    const row: HubQueuedMessage = { seq: this.seq, ...message }
    appendFileSync(this.file, `${JSON.stringify(row)}\n`, { mode: 0o600 })
    this.log.push(row)
    return row
  }

  /** Every message with a seq greater than the device's cursor. */
  after(cursor: number): HubQueuedMessage[] {
    return this.log.filter(row => row.seq > cursor)
  }

  /** The newest seq in the log (0 when empty) — a fresh device starts here. */
  tail(): number {
    return this.seq
  }
}

/** Read the stored credentials, or undefined before the first authorization. */
export function readCredentials(file: string): HubCredentials | undefined {
  if (!existsSync(file)) return undefined
  return JSON.parse(readFileSync(file, 'utf8')) as HubCredentials
}

/** Persist the credentials atomically with owner-only permissions. */
export function writeCredentials(file: string, credentials: HubCredentials): void {
  writeAtomic(file, `${JSON.stringify(credentials, null, 2)}\n`)
}

/** Read the persisted context-token map. */
export function readContexts(file: string): Map<string, string> {
  const map = new Map<string, string>()
  if (existsSync(file)) {
    for (const [key, value] of Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>)) {
      map.set(key, value)
    }
  }
  return map
}

/** Persist the context-token map atomically. */
export function writeContexts(file: string, contexts: Map<string, string>): void {
  writeAtomic(file, `${JSON.stringify(Object.fromEntries(contexts), null, 2)}\n`)
}

/** Write via a temp file + rename so a crash never leaves a half file. */
function writeAtomic(file: string, text: string): void {
  mkdirSync(join(file, '..'), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, file)
}
