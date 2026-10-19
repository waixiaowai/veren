/**
 * Tencent iLink bot HTTP client.
 *
 * Owns protocol shape, trusted-host checks, request timeouts, and error-code
 * mapping. `-14` means the login is stale; a rejected `sendmessage` (`ret=-2`)
 * is a delivery refusal, not a network error.
 *
 * 腾讯 iLink 机器人 HTTP 客户端。负责协议形状、可信主机校验、请求超时与错误码映射。
 * `-14` 表示登录失效；`sendmessage` 被拒（`ret=-2`）是投递拒绝，不是网络错误。
 *
 * @module @veren/im-wechat/api
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { ImError } from '@veren/im'
import { isRecord, toLoginStatus, toMessage } from './state.ts'
import type { WechatLoginStatus, WechatMessage } from './state.ts'

/** Default iLink API base URL and bot type. */
export const WEIXIN_BASE_URL = 'https://ilinkai.weixin.qq.com/'
export const WEIXIN_BOT_TYPE = '3'
/** The protocol expects a 35-second long poll; a timeout is an empty batch. */
export const WEIXIN_LONG_POLL_MS = 35_000
const REQUEST_TIMEOUT_MS = 15_000
const QR_TIMEOUT_MS = 10_000
const PROTOCOL_VERSION = '2.4.6'
const CLIENT_VERSION = (2 << 16) | (4 << 8) | 6

/** A request that exceeded its timeout; `getupdates` treats it as an empty batch. */
export class WechatTimeoutError extends Error {
  constructor() {
    super('wechat request timed out')
    this.name = 'WechatTimeoutError'
  }
}
/** Client construction options. */
export interface WechatApiOptions {
  baseUrl?: string
  botType?: string
  fetchImpl?: typeof fetch
  longPollTimeoutMs?: number
}
/** Tencent iLink client. */
export class WechatApi {
  readonly #baseUrl: string
  readonly #botType: string
  readonly #fetch: typeof fetch
  readonly #longPollTimeoutMs: number

  constructor(options: WechatApiOptions = {}) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl ?? WEIXIN_BASE_URL, WEIXIN_BASE_URL)
    this.#botType = options.botType ?? WEIXIN_BOT_TYPE
    this.#fetch = options.fetchImpl ?? fetch
    this.#longPollTimeoutMs = options.longPollTimeoutMs ?? WEIXIN_LONG_POLL_MS
  }
  /** Ask iLink for a QR challenge. */
  async beginLogin(signal?: AbortSignal): Promise<{ qrcode: string; qrUrl: string }> {
    const response = await this.#request('POST', `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(this.#botType)}`, {
      body: { local_token_list: [] },
      timeoutMs: QR_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    })
    const rejection = rejectedCode(response)
    if (rejection !== undefined) {
      throw new ImError('IM_INTERNAL', 'wechat rejected the QR request', { providerCode: rejection })
    }
    return {
      qrcode: requiredString(response.qrcode, 'qrcode'),
      qrUrl: normalizeQrUrl(requiredString(response.qrcode_img_content, 'qrcode_img_content')),
    }
  }

  /** Poll one QR challenge's login state. */
  async pollLogin(qrcode: string, verifyCode?: string, signal?: AbortSignal): Promise<WechatLoginStatus> {
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
    if (verifyCode !== undefined && verifyCode.trim() !== '') {
      endpoint += `&verify_code=${encodeURIComponent(verifyCode.trim())}`
    }
    const response = await this.#request('GET', endpoint, {
      timeoutMs: this.#longPollTimeoutMs,
      authenticated: false,
      ...(signal === undefined ? {} : { signal }),
    })
    return toLoginStatus(response)
  }

  /**
   * Read one long-poll batch. A timeout is the normal idle result.
   */
  async getUpdates(token: string, cursor: string, signal?: AbortSignal): Promise<{ messages: WechatMessage[]; cursor: string }> {
    let response: Record<string, unknown>
    try {
      response = await this.#request('POST', 'ilink/bot/getupdates', {
        token,
        body: { get_updates_buf: cursor, base_info: baseInfo() },
        timeoutMs: this.#longPollTimeoutMs,
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error: unknown) {
      if (error instanceof WechatTimeoutError) return { messages: [], cursor }
      throw error
    }
    const rejection = rejectedCode(response)
    if (rejection === '-14') {
      throw new ImError('IM_AUTH_REQUIRED', 'wechat login credential is stale', { providerCode: rejection })
    }
    if (rejection !== undefined) {
      throw new ImError('IM_INTERNAL', 'wechat rejected the updates request', { providerCode: rejection })
    }
    const messages = Array.isArray(response.msgs) ? response.msgs.filter(isRecord).map(toMessage) : []
    const next = typeof response.get_updates_buf === 'string' && response.get_updates_buf.length > 0
      ? response.get_updates_buf
      : cursor
    return { messages, cursor: next }
  }

  /** Send one text segment to one user. */
  async sendText(
    token: string,
    toUserId: string,
    text: string,
    contextToken?: string,
    signal?: AbortSignal,
  ): Promise<{ id: string; sentAt: number }> {
    const clientId = `im-wechat-${randomUUID()}`
    let response: Record<string, unknown>
    try {
      response = await this.#request('POST', 'ilink/bot/sendmessage', {
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
      })
    } catch (error: unknown) {
      if (error instanceof WechatTimeoutError) {
        throw new ImError('IM_DELIVERY_UNCERTAIN', 'wechat text send timed out', { cause: error })
      }
      throw error
    }
    const rejection = rejectedCode(response)
    if (rejection !== undefined) {
      throw new ImError('IM_SEND_REJECTED', 'wechat rejected the text message', { providerCode: rejection })
    }
    return { id: clientId, sentAt: Date.now() }
  }

  /** Start the notification stream for one account. */
  async notifyStart(token: string, signal?: AbortSignal): Promise<void> {
    await this.#notify('ilink/bot/msg/notifystart', token, 'notifystart', signal)
  }

  /** Stop the notification stream; a stale login has nothing left to stop. */
  async notifyStop(token: string): Promise<void> {
    try {
      await this.#notify('ilink/bot/msg/notifystop', token, 'notifystop')
    } catch (error: unknown) {
      if (error instanceof ImError && error.code === 'IM_AUTH_REQUIRED') return
      throw error
    }
  }

  /** Shared notification endpoint handling. */
  async #notify(endpoint: string, token: string, label: string, signal?: AbortSignal): Promise<void> {
    const response = await this.#request('POST', endpoint, {
      token,
      body: { base_info: baseInfo() },
      timeoutMs: REQUEST_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    })
    const rejection = rejectedCode(response)
    if (rejection === '-14') {
      throw new ImError('IM_AUTH_REQUIRED', 'wechat login credential is stale', { providerCode: rejection })
    }
    if (rejection !== undefined) {
      throw new ImError('IM_INTERNAL', `wechat rejected ${label}`, { providerCode: rejection })
    }
  }

  /** One authenticated JSON request against the trusted iLink base. */
  async #request(
    method: 'GET' | 'POST',
    endpoint: string,
    options: { body?: Record<string, unknown>; token?: string; timeoutMs: number; authenticated?: boolean; signal?: AbortSignal },
  ): Promise<Record<string, unknown>> {
    const url = new URL(endpoint, this.#baseUrl)
    assertTrustedUrl(url)
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeoutMs)
    const combined = options.signal === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, options.signal])
    try {
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
      const response = await this.#fetch(url, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: combined,
      })
      if (!response.ok) throw new ImError('IM_INTERNAL', `wechat HTTP ${response.status}`)
      let parsed: unknown
      try {
        parsed = await response.json()
      } catch {
        throw new ImError('IM_INTERNAL', 'wechat returned invalid JSON')
      }
      if (!isRecord(parsed)) throw new ImError('IM_INTERNAL', 'wechat returned a non-object response')
      return parsed
    } catch (error: unknown) {
      if (timedOut) throw new WechatTimeoutError()
      if (options.signal?.aborted === true) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new ImError('IM_INTERNAL', 'wechat request aborted')
      }
      if (error instanceof ImError) throw error
      throw new ImError('IM_INTERNAL', 'wechat request failed', { cause: error })
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Normalize one configured base URL, rejecting untrusted hosts. */
export function normalizeBaseUrl(value: string, fallback: string): string {
  const url = new URL(value, fallback)
  assertTrustedUrl(url)
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.toString()
}

/** Normalize one QR URL, rejecting untrusted hosts. */
export function normalizeQrUrl(value: string): string {
  const url = new URL(value)
  assertTrustedUrl(url)
  return url.toString()
}

/** Reject a URL that is not HTTPS on a WeChat host. */
function assertTrustedUrl(url: URL): void {
  if (url.protocol !== 'https:' || !isTrustedHost(url.hostname)) {
    throw new ImError('IM_INTERNAL', 'wechat refused an untrusted URL')
  }
  url.username = ''
  url.password = ''
}

/** WeChat host allowlist; no arbitrary redirect host is followed. */
function isTrustedHost(host: string): boolean {
  return host === 'ilinkai.weixin.qq.com' || host.endsWith('.weixin.qq.com')
}

/** Protocol metadata sent with every request. */
function baseInfo(): Record<string, unknown> {
  return { channel_version: PROTOCOL_VERSION, bot_agent: 'VerenIM/0.1.0' }
}

/** Return the first non-zero `ret`/`errcode`. */
function rejectedCode(value: Record<string, unknown>): string | undefined {
  for (const field of ['ret', 'errcode'] as const) {
    const raw = value[field]
    if (raw === undefined || raw === 0 || raw === '0') continue
    if (typeof raw === 'string' || typeof raw === 'number') return String(raw)
    return 'rejected'
  }
  return undefined
}

/** Require one non-empty string response field. */
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ImError('IM_INTERNAL', `wechat response is missing ${field}`)
  }
  return value.trim()
}

