/**
 * The single iLink session holder: one QR authorization (`authorize`), then
 * the `getupdates` long-poll loop (`startPolling`) that feeds the router.
 * Credentials and the cursor are durable; a `-14` verdict stops the loop —
 * the channel is dead and only a fresh authorization revives it.
 *
 * 唯一 iLink 会话的持有者：一次二维码授权（`authorize`），然后 feeding 路由器的
 * `getupdates` 长轮询循环（`startPolling`）。凭据与游标持久化；`-14` 裁决会停止循环——
 * 通道已死，只有重新授权才能复活。
 *
 * @module im-hub/session
 */

import { join } from 'node:path'
import { readSync } from 'node:fs'
import { ImError } from '@veren/im'
import { WechatApi, WechatTimeoutError } from '@veren/im-wechat/api'
import qrcode from 'qrcode'
import type { HubConfig } from './config.ts'
import { dataFile } from './config.ts'
import { readCredentials, writeCredentials } from './store.ts'
import type { HubCredentials } from './store.ts'

/** The subset of one inbound message the hub actually reads. */
export interface HubInbound {
  message_id?: string | number
  from_user_id?: string
  context_token?: string
  item_list?: Array<{ type?: number; text_item?: { text?: string } }>
}

/** One message handed to the router after normalization. */
export interface HubRouted {
  id: string
  conversationId: string
  sender: string
  text: string
  sentAt: number
  contextToken?: string
}

/** How many QR rounds the authorize flow mints before giving up. */
/** 授权流程最多刷新的二维码张数。 */
const MAX_QR_ROUNDS = 12

/**
 * Run the QR authorization flow and persist the confirmed credentials. An
 * expired QR mints a fresh one automatically — the user scans whenever they
 * are ready instead of racing a 3-minute window.
 * 运行二维码授权流程并持久化确认后的凭据。过期的二维码自动换新——用户随时扫，
 * 不用抢 3 分钟窗口。
 */
export async function authorize(config: HubConfig): Promise<HubCredentials> {
  const api = new WechatApi({ baseUrl: config.baseUrl })
  for (let round = 1; round <= MAX_QR_ROUNDS; round += 1) {
    const confirmed = await authorizeRound(api, config, round)
    if (confirmed !== undefined) return confirmed
  }
  throw new ImError('IM_BIND_EXPIRED', `二维码连续 ${MAX_QR_ROUNDS} 张过期，放弃授权`)
}

/** The login session handed out by `beginLogin`. */
/** `beginLogin` 发放的登录会话。 */
type WechatLogin = Awaited<ReturnType<WechatApi['beginLogin']>>

/** Mint one QR for this round and wait on it; credentials on confirm, `undefined` on expiry. */
/** 本轮铸造一张二维码并等待；确认则返回凭据，过期则返回 `undefined`。 */
async function authorizeRound(
  api: WechatApi,
  config: HubConfig,
  round: number,
): Promise<HubCredentials | undefined> {
  const login = await api.beginLogin()
  const png = join(config.dataDir, 'qr.png')
  await qrcode.toFile(png, login.qrUrl)
  console.log(`[${new Date().toISOString()}] 二维码已刷新（第 ${round}/${MAX_QR_ROUNDS} 张）：${png}`)
  return awaitOneQr(api, login, config)
}

/** Poll one QR until confirmed / expired / fatally rejected; other verdicts keep polling. */
/** 轮询一张二维码直到确认 / 过期 / 致命拒绝；其余裁决继续轮询。 */
async function awaitOneQr(
  api: WechatApi,
  login: WechatLogin,
  config: HubConfig,
): Promise<HubCredentials | undefined> {
  let code: string | undefined
  for (;;) {
    let status: Awaited<ReturnType<WechatApi['pollLogin']>>
    try {
      status = await api.pollLogin(login.qrcode, code)
    } catch (error: unknown) {
      if (error instanceof WechatTimeoutError) continue
      throw error
    }
    if (status.status === 'need_verifycode') {
      code = prompt('手机上显示了验证码，输入后回车：')
      continue
    }
    if (status.status === 'confirmed') return confirmedCredentials(status, config)
    if (status.status === 'expired') {
      console.log('二维码已过期，自动换新…')
      return undefined
    }
    if (status.status === 'verify_code_blocked' || status.status === 'binded_redirect') {
      throw rejectedError(status.status)
    }
  }
}

/** Persist the confirmed credentials and log the owner pair. */
/** 持久化确认后的凭据，并打印 bot/owner 配对。 */
function confirmedCredentials(
  status: Awaited<ReturnType<WechatApi['pollLogin']>>,
  config: HubConfig,
): HubCredentials {
  const credentials = confirmedOf(status)
  writeCredentials(credentialsFile(config), credentials)
  console.log(`授权成功：bot=${credentials.ilinkBotId} owner=${credentials.ownerId}`)
  return credentials
}

/** The ImError for the two fatal login verdicts. */
/** 两种致命登录裁决对应的 ImError。 */
function rejectedError(status: 'verify_code_blocked' | 'binded_redirect'): ImError {
  return status === 'verify_code_blocked'
    ? new ImError('IM_AUTH_REQUIRED', '验证码被拒绝，请稍后重试')
    : new ImError('IM_AUTH_REQUIRED', '该微信已绑定到别处（一号一会话）')
}

/** Start the long-poll loop; returns a stop function. */
/** 启动长轮询循环；返回停止函数。 */
export function startPolling(
  config: HubConfig,
  onMessage: (message: HubRouted) => void,
): () => void {
  const credentials = readCredentials(credentialsFile(config))
  if (credentials === undefined) {
    throw new ImError('IM_NOT_FOUND', 'no hub credentials yet — run `authorize` first')
  }
  const api = new WechatApi({ baseUrl: config.baseUrl })
  const session = { stopped: false }
  void pollLoop(api, config, credentials, onMessage, session)
  return () => { session.stopped = true }
}

/** The getupdates loop: route each batch, persist the cursor, stop on death. */
/** getupdates 循环：逐批投递、持久化游标，通道死亡即停止。 */
async function pollLoop(
  api: WechatApi,
  config: HubConfig,
  credentials: HubCredentials,
  onMessage: (message: HubRouted) => void,
  session: { stopped: boolean },
): Promise<void> {
  const cursor = { value: credentials.cursor }
  while (!session.stopped) {
    try {
      // getupdates 自己推进并返回游标：批量处理完后持久化即可。
      // getupdates advances and returns the cursor itself: persist per batch.
      const batch = await api.getUpdates(credentials.token, cursor.value)
      for (const message of batch.messages) {
        const routed = routedOf(message)
        if (routed === undefined) continue
        onMessage(routed)
      }
      cursor.value = batch.cursor
      persistCursor(config, credentials, cursor.value)
    } catch (error: unknown) {
      if (session.stopped) return
      if (error instanceof WechatTimeoutError) continue
      if (error instanceof ImError && error.code === 'IM_AUTH_REQUIRED') {
        console.error('[im-hub] 登录已失效（-14）：通道死亡，请重新 authorize')
        return
      }
      console.error(`[im-hub] poll failed: ${String(error)}；5 秒后重试`)
      await new Promise(resolve => setTimeout(resolve, 5_000))
    }
  }
}

/** Send one text segment back over the session. */
export async function sendText(
  config: HubConfig,
  toUserId: string,
  text: string,
  contextToken: string | undefined,
): Promise<void> {
  const credentials = readCredentials(credentialsFile(config))
  if (credentials === undefined) throw new ImError('IM_NOT_FOUND', 'no hub credentials yet')
  const api = new WechatApi({ baseUrl: config.baseUrl })
  await api.sendText(credentials.token, toUserId, text, contextToken)
}

/** The credentials file path. */
export function credentialsFile(config: HubConfig): string {
  return dataFile(config, 'hub-credentials.json')
}

/** Extract the outbound context token of one conversation. */
export function contextTokenOf(message: HubInbound): string | undefined {
  const token = message.context_token?.trim()
  return token === undefined || token === '' ? undefined : token
}

/** Normalize one raw message into the routed shape; non-text drops silently. */
function routedOf(message: HubInbound): HubRouted | undefined {
  let text = ''
  for (const item of message.item_list ?? []) {
    if (item.type === 1 && item.text_item?.text?.trim()) text = item.text_item.text.trim()
  }
  const id = typeof message.message_id === 'number' ? String(message.message_id) : message.message_id?.trim()
  const sender = message.from_user_id?.trim()
  if (text === '' || id === undefined || id === '' || sender === undefined || sender === '') return undefined
  return {
    id,
    conversationId: `p2p:${sender}`,
    sender,
    text,
    sentAt: Date.now(),
    ...(contextTokenOf(message) === undefined ? {} : { contextToken: contextTokenOf(message) }),
  }
}

/** Persist the cursor best-effort; a lost cursor re-reads a small window. */
function persistCursor(config: HubConfig, credentials: HubCredentials, cursor: string): void {
  if (cursor === credentials.cursor) return
  credentials.cursor = cursor
  try {
    writeCredentials(credentialsFile(config), credentials)
  } catch (error: unknown) {
    console.error(`[im-hub] cursor persist failed: ${String(error)}`)
  }
}

/** Read one line from stdin (the verify-code prompt); the CLI is interactive. */
function prompt(text: string): string {
  console.log(text)
  const buffer = Buffer.alloc(1024)
  const bytes = readSync(0, buffer, 0, buffer.length, null)
  return buffer.subarray(0, bytes).toString('utf8').trim()
}

/** The confirmed status's required fields, validated. */
function confirmedOf(status: { bot_token?: string; ilink_bot_id?: string; ilink_user_id?: string; baseurl?: string }): HubCredentials {
  const token = status.bot_token?.trim()
  const botId = status.ilink_bot_id?.trim()
  const ownerId = status.ilink_user_id?.trim()
  if (token === undefined || token === '' || botId === undefined || botId === ''
    || ownerId === undefined || ownerId === '') {
    throw new ImError('IM_INTERNAL', '授权响应不完整：缺少 token/bot/owner')
  }
  return { token, ilinkBotId: botId, ownerId, cursor: '' }
}
