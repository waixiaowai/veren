/**
 * Wire-level plumbing of the iLink client: request timeouts, header building,
 * failure classification, and the fixed wire bodies.
 *
 * Everything here is one HTTP-request's worth of protocol shape. The client
 * face (`api.ts`) composes these helpers; the URL trust policy lives in
 * `api-url.ts`.
 *
 * iLink 客户端的线上管线：请求超时、请求头构造、失败归类与固定的请求体。
 *
 * 这里的一切都是单个 HTTP 请求的协议形状。客户端门面（`api.ts`）负责组合这些辅助；
 * URL 可信策略在 `api-url.ts`。
 *
 * @module @veren/im-wechat/api-wire
 */

import { randomBytes } from 'node:crypto'
import { ImError } from '@veren/im'

/** Per-request timeout for ordinary (non-long-poll) calls. */
/** 普通（非长轮询）请求的超时。 */
export const REQUEST_TIMEOUT_MS = 15_000
/** QR challenge requests use their own, shorter timeout. */
/** 二维码挑战请求使用自己的较短超时。 */
export const QR_TIMEOUT_MS = 10_000
const PROTOCOL_VERSION = '2.4.6'
const CLIENT_VERSION = (2 << 16) | (4 << 8) | 6

/** A request that exceeded its timeout; `getupdates` treats it as an empty batch. */
/** 超时的请求；`getupdates` 把它当成空批次。 */
export class WechatTimeoutError extends Error {
  constructor() {
    super('wechat request timed out')
    this.name = 'WechatTimeoutError'
  }
}

/** Return the first non-zero `ret`/`errcode`. */
/** 返回第一个非零的 `ret`/`errcode`。 */
export function rejectedCode(value: Record<string, unknown>): string | undefined {
  for (const field of ['ret', 'errcode'] as const) {
    const raw = value[field]
    if (raw === undefined || raw === 0 || raw === '0') continue
    if (typeof raw === 'string' || typeof raw === 'number') return String(raw)
    return 'rejected'
  }
  return undefined
}

/**
 * Build one request's headers: the app identity always, the content type for
 * bodies, and the bot-token block unless the endpoint opts out.
 * 构造请求头：恒带应用身份，body 带 content-type，除非端点显式退出才省略 bot token 块。
 */
export function requestHeadersOf(options: { body?: Record<string, unknown>; token?: string; authenticated?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': String(CLIENT_VERSION),
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.authenticated !== false) {
    headers.AuthorizationType = 'ilink_bot_token'
    headers['X-WECHAT-UIN'] = randomBytes(4).toString('base64')
    if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`
  }
  return headers
}

/**
 * Classify one request failure: a timer firing wins, then a caller abort, then
 * the original structured error, and everything else is wrapped.
 * 归类一次请求失败：超时优先，其次是调用方中止，然后是原有结构化错误，其余一律包装。
 */
export function requestErrorOf(error: unknown, timedOut: boolean, signal: AbortSignal | undefined): unknown {
  if (timedOut) return new WechatTimeoutError()
  if (signal?.aborted === true) {
    return signal.reason instanceof Error
      ? signal.reason
      : new ImError('IM_INTERNAL', 'wechat request aborted')
  }
  if (error instanceof ImError) return error
  return new ImError('IM_INTERNAL', 'wechat request failed', { cause: error })
}

/** Build the `sendmessage` request body for one text segment. */
/** 构造一段文本对应的 `sendmessage` 请求体。 */
export function sendTextRequestOf(
  token: string,
  toUserId: string,
  clientId: string,
  text: string,
  contextToken: string | undefined,
  signal: AbortSignal | undefined,
): { token: string; timeoutMs: number; body: Record<string, unknown>; signal?: AbortSignal } {
  return {
    token,
    timeoutMs: REQUEST_TIMEOUT_MS,
    body: {
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text } }],
        ...(contextToken === undefined || contextToken === '' ? {} : { context_token: contextToken }),
      },
      base_info: baseInfo(),
    },
    ...(signal === undefined ? {} : { signal }),
  }
}

/** Require one non-empty string response field. */
/** 要求响应中存在一个非空字符串字段。 */
export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ImError('IM_INTERNAL', `wechat response is missing ${field}`)
  }
  return value.trim()
}

/** Protocol metadata sent with every request. */
/** 随每个请求发送的协议元数据。 */
export function baseInfo(): Record<string, unknown> {
  return { channel_version: PROTOCOL_VERSION, bot_agent: 'VerenIM/0.1.0' }
}
