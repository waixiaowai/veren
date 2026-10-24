/**
 * WeChat durable-state types, the credential seam, and the raw payload
 * projection helpers.
 *
 * Only the bot token lives in `ctx.credentials`; everything else is durable
 * state in the `im_wechat` storage domain (`store.ts`, re-exported here). No
 * state file is written and there is no data-directory setting: a missing
 * storage domain fails activation instead of silently degrading to memory.
 *
 * 微信持久化状态类型、凭据边界与原始载荷投影助手。
 *
 * 只有 bot token 保存在 `ctx.credentials`；其余都是 `im_wechat` 存储域（`store.ts`，在此
 * 再导出）里的持久化状态。状态不写文件，也没有数据目录配置项：存储域缺失会让激活失败，
 * 而不是悄悄退化成内存。
 *
 * @module @veren/im-wechat/state
 */

import type { LoggerService } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { imCredentialKey } from '@veren/im'

// ---- unchanged export surface (storage domain moved to store.ts) ----
// ---- 导出面不变（存储域移至 store.ts）----
export {
  WECHAT_CONTEXT_LIMIT, WECHAT_DOMAIN_NAME, DomainWechatStore, openWechatStore, wechatDomain,
} from './store.ts'

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
