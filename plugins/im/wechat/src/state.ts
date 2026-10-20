/**
 * WeChat durable state, its storage domain, and the credential seam.
 *
 * Account state (display name, owner, base URL, cursor, deduplication ring) and
 * the per-user `context_token` cache live in the `im_wechat` storage domain on
 * the profile's default backend; only the bot token lives in `ctx.credentials`.
 * No state file is written and there is no data-directory setting: a missing
 * storage domain fails activation instead of silently degrading to memory.
 *
 * 微信持久化状态、存储域与凭据边界。账号状态（显示名、owner、base URL、游标、去重环）与
 * 按用户的 `context_token` 缓存位于 `im_wechat` 存储域，走 profile 的默认后端；只有 bot token
 * 保存在 `ctx.credentials`。状态不写文件，也没有数据目录配置项：存储域缺失会让激活失败，
 * 而不是悄悄退化成内存。
 *
 * @module @veren/im-wechat/state
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Context, LoggerService } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { imCredentialKey } from '@veren/im'

/** One persisted account's durable state. */
export interface WechatState {
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
  /** iLink bot token. Never logged and never stored in the state domain. */
  token: string
}

/** Credential seam used by the provider; the DSH plugin supplies one. */
export interface WechatSecretStore {
  read(accountId: string): Promise<WechatSecrets | undefined>
  write(accountId: string, secrets: WechatSecrets): Promise<void>
  remove(accountId: string): Promise<void>
}

/**
 * Durable operations the provider needs. Tests provide an in-memory
 * implementation, so the provider never depends on a backend or file layout.
 * 提供者需要的持久化操作。测试提供内存实现，因此 provider 不依赖后端或文件布局。
 */
export interface WechatStore {
  /** Every persisted account's state, as copies safe for the runtime to mutate. */
  states(): WechatState[]
  putState(state: WechatState): Promise<void>
  deleteState(accountId: string): Promise<void>
  /** Cached context token for one account/user, when present. */
  contextToken(accountId: string, userId: string): string | undefined
  /**
   * Cache one context token and prune the oldest entries for this account.
   * @param now - ordering stamp for pruning; tests pass a deterministic value.
   */
  putContextToken(accountId: string, userId: string, token: string, now: number): Promise<void>
  deleteContexts(accountId: string): Promise<void>
  close(): Promise<void>
}

/** Provider construction options. */
export interface WechatProviderOptions {
  store: WechatStore
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

/** One `im_wechat.accounts` row. */
interface WechatAccountRow {
  account_id: string
  display_name: string
  owner_id?: string
  base_url: string
  cursor: string
  seen: string[]
}

/** One `im_wechat.contexts` row; `updated_at` orders pruning only. */
interface WechatContextRow {
  account_id: string
  user_id: string
  token: string
  updated_at: number
}

const accountSchema = z.object({
  account_id: z.string().min(1),
  display_name: z.string().min(1),
  owner_id: z.string().optional(),
  base_url: z.string().min(1),
  cursor: z.string(),
  seen: z.array(z.string()),
})

const contextSchema = z.object({
  account_id: z.string().min(1),
  user_id: z.string().min(1),
  token: z.string().min(1),
  updated_at: z.number(),
})

/**
 * Authoritative WeChat storage: a provider-owned domain on the shared storage
 * facility. Channel state belongs to the channel package, while the backend,
 * validation, lifecycle, and durability are the same for every domain plugin.
 * 权威微信存储：共享存储设施上的 provider 自有域。渠道状态属于渠道包，而后端、校验、
 * 生命周期与持久化与其他 domain 插件完全一致。
 */
export const wechatDomain = defineDomain({
  name: 'im_wechat',
  version: 1,
  tables: {
    accounts: domainTable<string, WechatAccountRow>(accountSchema),
    contexts: domainTable<string, WechatContextRow>(contextSchema),
  },
})

/** Domain name, shared with diagnostics. */
export const WECHAT_DOMAIN_NAME = wechatDomain.name

/** Upper bound on cached per-user context tokens for one account. */
export const WECHAT_CONTEXT_LIMIT = 200

/** Stable key for one account/user context row. */
function contextKey(accountId: string, userId: string): string {
  return `${accountId}\u0000${userId}`
}

/** Copy a stored row into the mutable runtime state. */
function toState(row: WechatAccountRow): WechatState {
  return {
    accountId: row.account_id,
    displayName: row.display_name,
    ...(row.owner_id === undefined ? {} : { ownerId: row.owner_id }),
    baseUrl: row.base_url,
    cursor: row.cursor,
    seen: [...row.seen],
  }
}

/** Copy runtime state into one storage row. */
function toRow(state: WechatState): WechatAccountRow {
  return {
    account_id: state.accountId,
    display_name: state.displayName,
    ...(state.ownerId === undefined ? {} : { owner_id: state.ownerId }),
    base_url: state.baseUrl,
    cursor: state.cursor,
    seen: [...state.seen],
  }
}

/** Store backed by the `im_wechat` domain. */
export class DomainWechatStore implements WechatStore {
  constructor(private readonly domain: Domain<typeof wechatDomain>) {}

  states(): WechatState[] {
    return [...this.domain.table('accounts').entries()].map(([, row]) => toState(row))
  }

  async putState(state: WechatState): Promise<void> {
    await this.domain.table('accounts').put(state.accountId, toRow(state))
  }

  async deleteState(accountId: string): Promise<void> {
    await this.domain.table('accounts').delete(accountId)
    await this.deleteContexts(accountId)
  }

  contextToken(accountId: string, userId: string): string | undefined {
    return this.domain.table('contexts').get(contextKey(accountId, userId))?.token
  }

  async putContextToken(accountId: string, userId: string, token: string, now: number): Promise<void> {
    const table = this.domain.table('contexts')
    await table.put(contextKey(accountId, userId), {
      account_id: accountId,
      user_id: userId,
      token,
      updated_at: now,
    })
    const own = [...table.entries()].filter(([, row]) => row.account_id === accountId)
    if (own.length <= WECHAT_CONTEXT_LIMIT) return
    own.sort((left, right) => left[1].updated_at - right[1].updated_at)
    for (const [key] of own.slice(0, own.length - WECHAT_CONTEXT_LIMIT)) await table.delete(key)
  }

  async deleteContexts(accountId: string): Promise<void> {
    const table = this.domain.table('contexts')
    for (const [key, row] of [...table.entries()]) {
      if (row.account_id === accountId) await table.delete(key)
    }
  }

  /** Close the underlying domain; safe to call twice. */
  async close(): Promise<void> {
    await this.domain.close()
  }
}

/**
 * Open the WeChat domain, closing a handle left by a previous activation first.
 * An open failure propagates, so a missing backend or a malformed row fails the
 * plugin loudly instead of starting a provider that cannot persist anything.
 * 打开微信域；先关闭上一次激活遗留的句柄。打开失败会向上抛出，因此后端缺失或记录损坏会让
 * 插件明确失败，而不是启动一个无法持久化的 provider。
 * @param ctx - context carrying `storageDomain` and `logger`.
 * @returns the opened store.
 */
export async function openWechatStore(ctx: Context): Promise<DomainWechatStore> {
  const stale = ctx.storageDomain.get(WECHAT_DOMAIN_NAME)
  if (stale !== undefined) {
    try {
      await stale.close()
      ctx.logger.warn('[im:wechat] closed the storage domain left open by a previous activation')
    } catch (error: unknown) {
      ctx.logger.warn(`[im:wechat] the previous storage domain could not close: ${String(error)}`)
    }
  }
  return new DomainWechatStore(await ctx.storageDomain.open(wechatDomain))
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
      payload: { token: secrets.token },
    }))
  }

  async remove(accountId: string): Promise<void> {
    await this.credentials.deleteRecord(imCredentialKey(accountId))
  }
}

/**
 * Validate one stored secret payload; unknown fields are ignored.
 * 校验一条已存凭据；未知字段会被忽略。
 */
export function parseSecrets(value: unknown): WechatSecrets | undefined {
  if (!isRecord(value) || typeof value.token !== 'string' || value.token.length === 0) {
    return undefined
  }
  return { token: value.token }
}

/** Whether a value is a plain record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Project a response onto the login status fields the provider reads. */
export function toLoginStatus(value: Record<string, unknown>): WechatLoginStatus {
  const status: WechatLoginStatus = { status: stringField(value.status) ?? '' }
  for (const key of [
    'qrcode', 'qrcode_img_content', 'bot_token', 'ilink_bot_id',
    'ilink_user_id', 'baseurl', 'redirect_host',
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
