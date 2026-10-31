/**
 * Tencent iLink bot HTTP client.
 *
 * Owns the client face: one method per endpoint, composed from the wire-level
 * plumbing in `api-wire.ts` (timeouts, headers, failure classification) and the
 * trusted-URL policy in `api-url.ts`. `-14` means the login is stale; a
 * rejected `sendmessage` (`ret=-2`) is a delivery refusal, not a network error.
 *
 * 腾讯 iLink 机器人 HTTP 客户端。负责客户端门面：每个端点一个方法，由 `api-wire.ts` 的
 * 线上管线（超时、请求头、失败归类）与 `api-url.ts` 的可信 URL 策略组合而成。`-14` 表示
 * 登录失效；`sendmessage` 被拒（`ret=-2`）是投递拒绝，不是网络错误。
 *
 * @module @veren/im-wechat/api
 */

import { randomUUID } from 'node:crypto'
import { ImError } from '@veren/im'
import { isRecord, toLoginStatus, toMessage } from './state.ts'
import { assertTrustedUrl, normalizeBaseUrl, normalizeQrUrl } from './api-url.ts'
import {
  QR_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  WechatTimeoutError,
  baseInfo,
  rejectedCode,
  requestErrorOf,
  requestHeadersOf,
  requiredString,
  sendTextRequestOf,
} from './api-wire.ts'
import type { WechatLoginStatus, WechatMessage } from './state.ts'

// ---- unchanged export surface (URL policy moved to api-url.ts) ----
// ---- 导出面不变（URL 策略移至 api-url.ts）----
export { normalizeBaseUrl, normalizeQrUrl } from './api-url.ts'

// ---- unchanged export surface (wire plumbing moved to api-wire.ts) ----
// ---- 导出面不变（线上管线移至 api-wire.ts）----
export { WechatTimeoutError } from './api-wire.ts'

/** Default iLink API base URL and bot type. */
export const WEIXIN_BASE_URL = 'https://ilinkai.weixin.qq.com/'
export const WEIXIN_BOT_TYPE = '3'
/** The protocol expects a 35-second long poll; a timeout is an empty batch. */
export const WEIXIN_LONG_POLL_MS = 35_000

/** Client construction options. */
export interface WechatApiOptions {
  baseUrl?: string
  botType?: string
  fetchImpl?: typeof fetch
  longPollTimeoutMs?: number
}
/** Tencent iLink client. */
export class WechatApi {
  private readonly baseUrl: string
  private readonly botType: string
  private readonly fetch: typeof fetch
  private readonly longPollTimeoutMs: number

  constructor(options: WechatApiOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? WEIXIN_BASE_URL, WEIXIN_BASE_URL)
    this.botType = options.botType ?? WEIXIN_BOT_TYPE
    this.fetch = options.fetchImpl ?? fetch
    this.longPollTimeoutMs = options.longPollTimeoutMs ?? WEIXIN_LONG_POLL_MS
  }
  /** Ask iLink for a QR challenge. */
  async beginLogin(signal?: AbortSignal): Promise<{ qrcode: string; qrUrl: string }> {
    const response = await this.request('POST', `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(this.botType)}`, {
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
    const response = await this.request('GET', endpoint, {
      timeoutMs: this.longPollTimeoutMs,
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
      response = await this.request('POST', 'ilink/bot/getupdates', {
        token,
        body: { get_updates_buf: cursor, base_info: baseInfo() },
        timeoutMs: this.longPollTimeoutMs,
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
  /** 向一个用户发送一段文本。 */
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
      response = await this.request('POST', 'ilink/bot/sendmessage',
        sendTextRequestOf(token, toUserId, clientId, text, contextToken, signal))
    } catch (error: unknown) {
      if (error instanceof WechatTimeoutError) {
        throw new ImError('IM_DELIVERY_UNCERTAIN', 'wechat text send timed out', { cause: error })
      }
      throw error
    }
    const rejection = rejectedCode(response)
    if (rejection !== undefined) {
      // iLink uses `-2` both for a stale context token and for frequency
      // control; the provider cannot tell them apart from this response, so it
      // reports a rejection and lets the caller decide whether to retry.
      // iLink 的 `-2` 既可能是 context token 失效，也可能是频率控制；provider 无法从该响应区分，
      // 因此报告投递拒绝，由调用方决定是否重试。
      throw new ImError('IM_SEND_REJECTED', 'wechat rejected the text message', { providerCode: rejection })
    }
    return { id: clientId, sentAt: Date.now() }
  }

  /** Start the notification stream for one account. */
  async notifyStart(token: string, signal?: AbortSignal): Promise<void> {
    await this.notify('ilink/bot/msg/notifystart', token, 'notifystart', signal)
  }

  /** Stop the notification stream; a stale login has nothing left to stop. */
  async notifyStop(token: string): Promise<void> {
    try {
      await this.notify('ilink/bot/msg/notifystop', token, 'notifystop')
    } catch (error: unknown) {
      if (error instanceof ImError && error.code === 'IM_AUTH_REQUIRED') return
      throw error
    }
  }

  /** Shared notification endpoint handling. */
  private async notify(endpoint: string, token: string, label: string, signal?: AbortSignal): Promise<void> {
    const response = await this.request('POST', endpoint, {
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
  /** 对可信 iLink 基址发起一次（默认带鉴权的）JSON 请求。 */
  private async request(
    method: 'GET' | 'POST',
    endpoint: string,
    options: { body?: Record<string, unknown>; token?: string; timeoutMs: number; authenticated?: boolean; signal?: AbortSignal },
  ): Promise<Record<string, unknown>> {
    const url = new URL(endpoint, this.baseUrl)
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
      return await this.fetchJson(url, method, options, combined)
    } catch (error: unknown) {
      throw requestErrorOf(error, timedOut, options.signal)
    } finally {
      clearTimeout(timer)
    }
  }

  /** Issue the fetch and normalize the response into a JSON record. */
  /** 发起 fetch 并把响应归一为 JSON record。 */
  private async fetchJson(
    url: URL,
    method: 'GET' | 'POST',
    options: { body?: Record<string, unknown>; token?: string; authenticated?: boolean },
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetch(url, {
      method,
      headers: requestHeadersOf(options),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal,
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
  }
}
