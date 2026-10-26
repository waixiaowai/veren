/**
 * WeChat runtime helpers: the local QR cache, confirmed-account persistence,
 * outbound text splitting, and inbound message reduction.
 *
 * Confirmed accounts are written to the storage domain; outbound text is split
 * at the UTF-16 limit; inbound items are reduced to one text message. No helper
 * logs a token or the QR URL. The bind attempt lives in `bind-attempt.ts` and
 * is re-exported unchanged here.
 *
 * 微信运行时辅助：本地二维码缓存、确认账号持久化、发送文本分段与入站内容归一。
 *
 * 确认后的账号写入存储域；发送文本按 UTF-16 上限分段；入站内容归一为一条文字消息。任何辅助
 * 函数都不记录 token 或二维码 URL。绑定尝试在 `bind-attempt.ts`，并在此原样再导出。
 *
 * @module @veren/im-wechat/runtime
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import QRCode from 'qrcode'
import { ImError } from '@veren/im'
import { WechatApi, WechatTimeoutError, normalizeBaseUrl } from './api.ts'
import type { ImAccount } from '@veren/im'
import type { WechatLoginStatus, WechatMessage, WechatSecretStore, WechatSecrets, WechatState, WechatStore } from './state.ts'

// ---- unchanged export surface (the attempt moved to bind-attempt.ts) ----
// ---- 导出面不变（绑定尝试移至 bind-attempt.ts）----
export { WechatBindAttempt, delay } from './bind-attempt.ts'
export type { WechatBindAttemptOptions } from './bind-attempt.ts'

/**
 * Local QR cache. The PNG is a presentation artifact the caller reads through
 * `ImBindChallenge.imagePath`; it is not durable state and carries no account
 * data, so it lives in the OS temp directory instead of a configurable root.
 * 本地二维码缓存。PNG 是调用方通过 `ImBindChallenge.imagePath` 读取的展示产物，不是持久化
 * 状态，也不含账号数据，因此放在系统临时目录，而不是可配置的根目录。
 */
const QR_CACHE_DIR = join(tmpdir(), 'dsh-im-wechat-qr')

/** Path of one bind attempt's local QR image. */
export function qrImagePath(bindId: string): string {
  return join(QR_CACHE_DIR, `${bindId}.png`)
}

/**
 * Write one QR PNG for the caller to open.
 * @param path - destination from {@link qrImagePath}.
 * @param url - remote QR URL; never logged.
 */
export async function writeQrImage(path: string, url: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const png = await QRCode.toBuffer(url, { type: 'png', width: 320, margin: 1 })
  await writeFile(path, png, { mode: 0o600 })
}

/** Persist one confirmed account's state and secrets. */
export async function storeConfirmedAccount(
  response: WechatLoginStatus,
  label: string | undefined,
  options: { baseUrl: string; store: WechatStore; secrets: WechatSecretStore; logger?: WechatRetireLogger },
): Promise<{ state: WechatState; secrets: WechatSecrets; account: ImAccount }> {
  const token = response.bot_token?.trim()
  const accountId = response.ilink_bot_id?.trim()
  const ownerId = response.ilink_user_id?.trim()
  if (token === undefined || token === '' || accountId === undefined || accountId === ''
    || ownerId === undefined || ownerId === '') {
    throw new ImError('IM_INTERNAL', 'WeChat authorization response is incomplete')
  }
  const displayName = label?.trim() || `WeChat ${accountId.slice(0, 8)}`
  const state: WechatState = {
    accountId,
    displayName,
    ownerId,
    baseUrl: response.baseurl === undefined
      ? options.baseUrl
      : normalizeBaseUrl(response.baseurl, options.baseUrl),
    cursor: '',
    seen: [],
  }
  const secrets: WechatSecrets = { token }
  await options.store.putState(state)
  await options.secrets.write(accountId, secrets)
  // 同一微信号只允许一个活 bot 会话：新配对确认后，同 owner 的旧账号凭据已被
  // 服务端作废——删除其状态行（credential 一并删），账号列表不再积累死行
  // （真机反例：三次扫码留下三条 WeChat 记录，两条永久"离线"）。
  // iLink allows one live bot session per WeChat account: once the new pairing
  // confirms, the old accounts of the same owner are dead server-side — drop
  // their state rows (and credentials) so the account list stops accumulating
  // offline ghosts (live counter-example: three scans left three WeChat rows,
  // two permanently offline).
  for (const other of options.store.states()) {
    if (other.accountId === accountId || other.ownerId !== ownerId) continue
    await recordRetiredVerdict(options, other.accountId)
    await options.store.deleteState(other.accountId).catch(() => undefined)
    await options.secrets.remove(other.accountId).catch(() => undefined)
  }
  return { state, secrets, account: { id: accountId, displayName, ownerId, status: 'offline' } }
}

/** The logging seam the retirement verdict needs; all levels optional. */
/** 退役裁决需要的日志接缝；全部可选。 */
export interface WechatRetireLogger {
  info?(message: string): void
  warn?(message: string): void
}

/**
 * Ask the server itself whether one retired token is really dead, and record
 * the verdict — `-14` proves death; a clean batch means the server STILL honors
 * the token, which would overturn the one-live-bot assumption and must be loud.
 * 向服务器本身求证一条已退役 token 是否真的死了，并记录裁决——`-14` 证明已死；
 * 干净的空批次意味着服务器仍认这条 token，将推翻「单活 bot」假设，必须大声报告。
 */
async function recordRetiredVerdict(
  options: { baseUrl: string; secrets: WechatSecretStore; logger?: WechatRetireLogger },
  accountId: string,
): Promise<void> {
  if (options.logger === undefined) return
  try {
    const secrets = await options.secrets.read(accountId)
    if (secrets === undefined) return
    const api = new WechatApi({ baseUrl: options.baseUrl, longPollTimeoutMs: 8_000 })
    await api.getUpdates(secrets.token, '')
    options.logger.warn?.(
      `[im:wechat] ACCOUNT_RETIRED_VERDICT account=${accountId} verdict=ALIVE`
      + ' — the server still honors a retired token; the one-live-bot assumption needs review',
    )
  } catch (error: unknown) {
    const verdict = error instanceof ImError && error.code === 'IM_AUTH_REQUIRED'
      ? 'dead'
      : error instanceof WechatTimeoutError ? 'unreachable' : 'error'
    options.logger.info?.(`[im:wechat] ACCOUNT_RETIRED_VERDICT account=${accountId} verdict=${verdict}`)
  }
}

/** Split text at the UTF-16 code-unit limit without cutting a surrogate pair. */
export function splitText(text: string, limit = 1_800): string[] {
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = limit
    const last = rest.charCodeAt(cut - 1)
    if (last >= 0xD800 && last <= 0xDBFF) cut -= 1
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest.length > 0) chunks.push(rest)
  return chunks
}

/** Extract the first text item. */
export function textOf(message: WechatMessage): string | undefined {
  for (const item of message.item_list ?? []) {
    if (item.type !== 1) continue
    const text = item.text_item?.text?.trim()
    if (text !== undefined && text !== '') return text
  }
  return undefined
}

/** Read one stable message id. */
export function messageIdOf(message: WechatMessage): string | undefined {
  const value = message.message_id
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}
