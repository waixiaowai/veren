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

/** Run the QR authorization flow and persist the confirmed credentials. */
export async function authorize(config: HubConfig): Promise<HubCredentials> {
  const api = new WechatApi({ baseUrl: config.baseUrl })
  const login = await api.beginLogin()
  const png = join(config.dataDir, 'qr.png')
  await qrcode.toFile(png, login.qrUrl)
  console.log(`二维码已写出：${png} —— 用微信扫一扫并在手机上确认`)
  let code: string | undefined
  for (;;) {
    let status
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
    if (status.status === 'confirmed') {
      const credentials = confirmedOf(status)
      writeCredentials(credentialsFile(config), credentials)
      console.log(`授权成功：bot=${credentials.ilinkBotId} owner=${credentials.ownerId}`)
      return credentials
    }
    if (status.status === 'expired') throw new ImError('IM_BIND_EXPIRED', '二维码已过期，请重新执行 authorize')
    if (status.status === 'verify_code_blocked') throw new ImError('IM_AUTH_REQUIRED', '验证码被拒绝，请稍后重试')
    if (status.status === 'binded_redirect') throw new ImError('IM_AUTH_REQUIRED', '该微信已绑定到别处（一号一会话）')
  }
}

/** Start the long-poll loop; returns a stop function. */
export function startPolling(
  config: HubConfig,
  onMessage: (message: HubRouted) => void,
): () => void {
  const credentials = readCredentials(credentialsFile(config))
  if (credentials === undefined) {
    throw new ImError('IM_NOT_FOUND', 'no hub credentials yet — run `authorize` first')
  }
  const api = new WechatApi({ baseUrl: config.baseUrl })
  const cursor = { value: credentials.cursor }
  let stopped = false
  void (async () => {
    while (!stopped) {
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
        if (stopped) return
        if (error instanceof WechatTimeoutError) continue
        if (error instanceof ImError && error.code === 'IM_AUTH_REQUIRED') {
          console.error('[im-hub] 登录已失效（-14）：通道死亡，请重新 authorize')
          return
        }
        console.error(`[im-hub] poll failed: ${String(error)}；5 秒后重试`)
        await new Promise(resolve => setTimeout(resolve, 5_000))
      }
    }
  })()
  return () => { stopped = true }
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
