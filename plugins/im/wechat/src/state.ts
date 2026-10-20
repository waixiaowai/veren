/**
 * Per-account state files and the credential seam.
 *
 * `state.json` is written atomically and holds no secret. The bot token and the
 * per-user `context_token` cache live in `ctx.credentials` under the account's
 * hashed credential key, which is why a tool result, a log line, and a state
 * file can never leak them.
 *
 * 按账号的状态文件与凭据边界。
 *
 * `state.json` 原子写入且不含 Secret。bot token 与按用户的 `context_token` 缓存保存在
 * `ctx.credentials` 中以账号哈希派生的键下，因此工具返回值、日志与状态文件都不会泄漏它们。
 *
 * @module @veren/im-wechat/state
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { imCredentialKey } from '@veren/im'
import type { LoggerService } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'

/** One persisted per-account state file. */
export interface WechatState {
  version: 1
  accountId: string
  displayName: string
  ownerId?: string
  baseUrl: string
  /** `get_updates_buf` from the last successful batch. */
  cursor: string
  /** Recently accepted message ids, oldest first. */
  seen: string[]
}

/** Secrets held by the credential seam for one account. */
export interface WechatSecrets {
  /** iLink bot token. Never logged, never stored in state.json. */
  token: string
  /** Per-user context tokens, keyed by user id. */
  contexts: Record<string, string>
}

/** Credential seam used by the provider; the DSH plugin supplies one. */
export interface WechatSecretStore {
  read(accountId: string): Promise<WechatSecrets | undefined>
  write(accountId: string, secrets: WechatSecrets): Promise<void>
  remove(accountId: string): Promise<void>
}

/** Provider construction options. */
export interface WechatProviderOptions {
  dataDir: string
  botType?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  now?: () => number
  qrTtlMs?: number
  longPollTimeoutMs?: number
  /** Delay between QR status polls; tests shorten it. */
  pollIntervalMs?: number
  /** Host logger; the plugin passes `ctx.logger`. / 宿主日志器；插件传入 `ctx.logger`。 */
  logger: LoggerService
  secrets: WechatSecretStore
}

/** One inbound iLink message. */
export interface WechatMessage {
  message_id?: string | number
  from_user_id?: string
  to_user_id?: string
  message_type?: number
  create_time_ms?: number
  context_token?: string
  item_list?: Array<{ type?: number; text_item?: { text?: string } }>
}

/** One `get_qrcode_status` response. */
export interface WechatLoginStatus {
  status?: string
  qrcode?: string
  qrcode_img_content?: string
  bot_token?: string
  ilink_bot_id?: string
  ilink_user_id?: string
  baseurl?: string
  redirect_host?: string
  ret?: number | string
  errcode?: number | string
}

/** One `getupdates` response. */
export interface WechatUpdates {
  ret?: number | string
  errcode?: number | string
  msgs?: WechatMessage[]
  get_updates_buf?: string
}

/** `state.json` reader/writer for one provider data directory. */
export class WechatStateStore {
  /**
   * @param root - provider data directory, e.g. `<DSH_HOME>/im/wechat`.
   */
  constructor(readonly root: string) {}

  /** One account's state file. */
  statePath(accountId: string): string {
    return join(this.root, accountId, 'state.json')
  }

  /** One QR challenge's local PNG. */
  qrPath(bindId: string): string {
    return join(this.root, 'qr', `${bindId}.png`)
  }

  /** Ensure the QR directory exists. */
  async ensureQrDir(): Promise<void> {
    await mkdir(join(this.root, 'qr'), { recursive: true, mode: 0o700 })
  }

  /** Every account directory name, excluding the QR cache. */
  async accountIds(): Promise<string[]> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => [])
    return entries
      .filter(entry => entry.isDirectory() && entry.name !== 'qr')
      .map(entry => entry.name)
  }

  /**
   * Read one state file.
   * @param accountId - account directory name.
   * @returns the validated state, or undefined when the file is absent.
   * @throws when the file exists but is not a valid V1 state.
   */
  async read(accountId: string): Promise<WechatState | undefined> {
    let text: string
    try {
      text = await readFile(this.statePath(accountId), 'utf8')
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') return undefined
      throw error
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new Error(`wechat state for ${accountId} is not valid JSON`)
    }
    return normalizeState(value)
  }

  /** Atomically replace one state file. */
  async write(state: WechatState): Promise<void> {
    const path = this.statePath(state.accountId)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temp = `${path}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, path)
  }

  /** Remove one account directory and its state file. */
  async remove(accountId: string): Promise<void> {
    await rm(join(this.root, accountId), { recursive: true, force: true })
  }
}

/** Credential-seam implementation used by the DSH plugin. */
export class DshWechatSecrets implements WechatSecretStore {
  /**
   * @param credentials - host credential service.
   */
  constructor(private readonly credentials: CredentialProvider) {}

  async read(accountId: string): Promise<WechatSecrets | undefined> {
    const record = await this.credentials.readRecord(imCredentialKey(accountId))
    if (record?.kind !== 'grant') return undefined
    return parseSecrets(record.payload)
  }

  async write(accountId: string, secrets: WechatSecrets): Promise<void> {
    await this.credentials.modifyRecord(imCredentialKey(accountId), async () => ({
      kind: 'grant',
      payload: {
        token: secrets.token,
        contexts: secrets.contexts,
      },
    }))
  }

  async remove(accountId: string): Promise<void> {
    await this.credentials.deleteRecord(imCredentialKey(accountId))
  }
}

/** Validate one stored secret payload. */
export function parseSecrets(value: unknown): WechatSecrets | undefined {
  if (!isRecord(value) || typeof value.token !== 'string' || value.token.length === 0) {
    return undefined
  }
  const contexts: Record<string, string> = {}
  if (isRecord(value.contexts)) {
    for (const [userId, token] of Object.entries(value.contexts)) {
      if (typeof token === 'string' && token.length > 0) contexts[userId] = token
    }
  }
  return { token: value.token, contexts }
}

/** Validate one decoded state document. */
function normalizeState(value: unknown): WechatState {
  if (!isRecord(value) || value.version !== 1) throw new Error('wechat state version must be 1')
  const accountId = nonEmpty(value.accountId, 'accountId')
  const displayName = nonEmpty(value.displayName, 'displayName')
  const baseUrl = nonEmpty(value.baseUrl, 'baseUrl')
  const cursor = typeof value.cursor === 'string' ? value.cursor : ''
  const seen = Array.isArray(value.seen)
    ? value.seen.filter((id): id is string => typeof id === 'string').slice(-1_000)
    : []
  return {
    version: 1,
    accountId,
    displayName,
    ...(typeof value.ownerId === 'string' ? { ownerId: value.ownerId } : {}),
    baseUrl,
    cursor,
    seen,
  }
}

/** Require one non-empty string field. */
function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`wechat state ${field} must be a non-empty string`)
  }
  return value
}

/** Whether a value is a plain record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value is a Node error with a string code. */
function isNodeError(value: unknown): value is { code: string } {
  return typeof value === 'object' && value !== null && typeof (value as { code?: unknown }).code === 'string'
}

/** Project a response onto the login status fields the provider reads. */
export function toLoginStatus(value: Record<string, unknown>): WechatLoginStatus {
  const status: WechatLoginStatus = { status: stringField(value.status) ?? '' }
  for (const key of [
    'qrcode',
    'qrcode_img_content',
    'bot_token',
    'ilink_bot_id',
    'ilink_user_id',
    'baseurl',
    'redirect_host',
  ] as const) {
    const field = stringField(value[key])
    if (field !== undefined) status[key] = field
  }
  if (typeof value.ret === 'number' || typeof value.ret === 'string') status.ret = value.ret
  if (typeof value.errcode === 'number' || typeof value.errcode === 'string') status.errcode = value.errcode
  return status
}

/** Project one raw message onto the fields the provider reads. */
export function toMessage(value: Record<string, unknown>): WechatMessage {
  const message: WechatMessage = {}
  const id = value.message_id
  if (typeof id === 'string' || typeof id === 'number') message.message_id = id
  for (const key of ['from_user_id', 'to_user_id', 'context_token'] as const) {
    const field = stringField(value[key])
    if (field !== undefined) message[key] = field
  }
  if (typeof value.message_type === 'number') message.message_type = value.message_type
  if (typeof value.create_time_ms === 'number') message.create_time_ms = value.create_time_ms
  if (Array.isArray(value.item_list)) {
    message.item_list = value.item_list.filter(isRecord).map(item => ({
      ...(typeof item.type === 'number' ? { type: item.type } : {}),
      ...(isRecord(item.text_item) && typeof item.text_item.text === 'string'
        ? { text_item: { text: item.text_item.text } }
        : {}),
    }))
  }
  return message
}

/** Read one non-empty trimmed string field. */
export function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}
