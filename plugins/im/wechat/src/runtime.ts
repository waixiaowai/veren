/**
 * WeChat runtime helpers.
 *
 * One QR attempt owns its poll loop and waiters; confirmed accounts are stored
 * here; outbound text is split at the UTF-16 limit; inbound items are reduced to
 * one text message. No helper logs a token or the QR URL.
 *
 * 微信运行时辅助：二维码尝试拥有轮询循环与等待者；确认后的账号在此落盘；发送文本按 UTF-16
 * 上限分段；入站内容归一为一条文字消息。任何辅助函数都不记录 token 或二维码 URL。
 *
 * @module @veren/im-wechat/runtime
 */

import { ImError } from '@veren/im'
import type { ImAccount, ImBindAttempt, ImBindChallenge, ImBindStatus } from '@veren/im'
import { WechatApi, WechatTimeoutError, normalizeBaseUrl } from './api.ts'
import { WechatStateStore } from './state.ts'
import type {
  WechatLoginStatus,
  WechatLogger,
  WechatMessage,
  WechatSecretStore,
  WechatSecrets,
  WechatState,
} from './state.ts'

/** Attempt construction options. */
export interface WechatBindAttemptOptions {
  bindId: string
  qrcode: string
  expiresAt: number
  imagePath: string
  api: WechatApi
  now: () => number
  pollIntervalMs?: number
  logger: WechatLogger
  /** Persist the confirmed account and start its monitor. */
  activate(response: WechatLoginStatus): Promise<ImAccount>
}

/** Delay that also settles on abort. */
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>(resolve => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/** Live QR attempt. */
export class WechatBindAttempt implements ImBindAttempt {
  readonly bindId: string
  readonly challenge: ImBindChallenge
  readonly #controller = new AbortController()
  readonly #api: WechatApi
  readonly #now: () => number
  readonly #logger: WechatLogger
  readonly #activate: (response: WechatLoginStatus) => Promise<ImAccount>
  readonly #pollIntervalMs: number
  readonly #waiters: Array<{ resolve(account: ImAccount): void; reject(error: unknown): void }> = []
  #qrcode: string
  #code: string | undefined
  #status: ImBindStatus = 'pending'
  #account: ImAccount | undefined

  constructor(options: WechatBindAttemptOptions) {
    this.bindId = options.bindId
    this.#qrcode = options.qrcode
    this.#api = options.api
    this.#now = options.now
    this.#logger = options.logger
    this.#activate = options.activate
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_500
    this.challenge = {
      kind: 'qrcode',
      expiresAt: options.expiresAt,
      imagePath: options.imagePath,
    }
  }

  get status(): ImBindStatus {
    return this.#status
  }

  /** Advance the attempt until it is bound, expired, failed, or cancelled. */
  async run(): Promise<void> {
    while (!this.#controller.signal.aborted && this.#status !== 'bound') {
      if (this.#now() >= (this.challenge.expiresAt ?? 0)) {
        this.#finish('expired', new ImError('IM_BIND_EXPIRED', 'the WeChat QR code expired'))
        return
      }
      try {
        const response = await this.#api.pollLogin(this.#qrcode, this.#code, this.#controller.signal)
        if (this.#controller.signal.aborted) return
        switch (response.status) {
          case 'wait':
            this.#status = 'pending'
            break
          case 'scaned':
          case 'scaned_but_redirect':
            this.#status = 'scanned'
            break
          case 'need_verifycode':
            this.#status = 'needs-code'
            break
          case 'expired':
            this.#finish('expired', new ImError('IM_BIND_EXPIRED', 'the WeChat QR code expired'))
            return
          case 'verify_code_blocked':
            this.#finish('failed', new ImError('IM_AUTH_REQUIRED', 'the WeChat verify code was blocked'))
            return
          case 'binded_redirect':
            this.#finish('failed', new ImError('IM_AUTH_REQUIRED', 'this WeChat account is already bound elsewhere'))
            return
          case 'confirmed': {
            try {
              const account = await this.#activate(response)
              this.#account = account
              this.#status = 'bound'
              this.#settleWaiters(account)
              return
            } catch (error: unknown) {
              this.#finish('failed', asImError(error, 'the WeChat account could not be activated'))
              return
            }
          }
          default:
            this.#finish('failed', new ImError('IM_INTERNAL', `unknown WeChat login status: ${response.status ?? ''}`))
            return
        }
      } catch (error: unknown) {
        if (this.#controller.signal.aborted) return
        if (!(error instanceof WechatTimeoutError)) {
          this.#finish(
            'failed',
            error instanceof ImError ? error : asImError(error, 'the WeChat QR poll failed'),
          )
          return
        }
      }
      await delay(this.#pollIntervalMs, this.#controller.signal)
    }
  }

  async submitCode(code: string): Promise<void> {
    if (this.#status !== 'needs-code') {
      throw new ImError('IM_INVALID_REQUEST', 'this WeChat attempt does not need a verify code')
    }
    if (code.trim() === '') throw new ImError('IM_INVALID_REQUEST', 'a verify code is required')
    this.#code = code.trim()
    this.#status = 'pending'
  }

  wait(signal?: AbortSignal): Promise<ImAccount> {
    if (this.#account !== undefined) return Promise.resolve(this.#account)
    if (this.#status === 'expired') return Promise.reject(new ImError('IM_BIND_EXPIRED', 'the WeChat QR code expired'))
    if (this.#status === 'failed') return Promise.reject(new ImError('IM_INTERNAL', 'the WeChat bind attempt failed'))
    return new Promise<ImAccount>((resolve, reject) => {
      // Each waiter owns its settle functions, so one abort never touches the others.
      // 每个 waiter 持有自己的 settle 函数，一个 abort 绝不影响其他 waiter。
      const waiter = {
        resolve: (account: ImAccount): void => {
          signal?.removeEventListener('abort', onAbort)
          resolve(account)
        },
        reject: (error: unknown): void => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
      }
      const onAbort = (): void => {
        const index = this.#waiters.indexOf(waiter)
        if (index >= 0) this.#waiters.splice(index, 1)
        reject(new ImError('IM_BIND_EXPIRED', 'the WeChat bind wait was aborted'))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.#waiters.push(waiter)
    })
  }

  async cancel(): Promise<void> {
    if (this.#status === 'bound') return
    this.#status = 'expired'
    this.#controller.abort()
    this.#settleWaiters(undefined, new ImError('IM_BIND_EXPIRED', 'the WeChat bind attempt was cancelled'))
  }

  /** Move to a terminal failure state and reject waiters. */
  #finish(status: ImBindStatus, error: ImError): void {
    this.#status = status
    this.#controller.abort()
    this.#settleWaiters(undefined, error)
    this.#logger.warn(`[im:wechat] bind ${this.bindId} ended as ${status}: ${error.message}`)
  }

  /** Settle every waiter exactly once. */
  #settleWaiters(account?: ImAccount, error?: ImError): void {
    for (const waiter of this.#waiters.splice(0)) {
      if (account !== undefined) waiter.resolve(account)
      else waiter.reject(error ?? new ImError('IM_INTERNAL', 'the WeChat bind attempt ended'))
    }
  }
}

/** Preserve an ImError, or wrap an unknown failure. */
function asImError(error: unknown, message: string): ImError {
  if (error instanceof ImError) return error
  return new ImError('IM_INTERNAL', message, { cause: error })
}

/** Persist one confirmed account's state and secrets. */
export async function storeConfirmedAccount(
  response: WechatLoginStatus,
  label: string | undefined,
  options: { baseUrl: string; stateStore: WechatStateStore; secrets: WechatSecretStore },
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
    version: 1,
    accountId,
    displayName,
    ownerId,
    baseUrl: response.baseurl === undefined
      ? options.baseUrl
      : normalizeBaseUrl(response.baseurl, options.baseUrl),
    cursor: '',
    seen: [],
  }
  const secrets: WechatSecrets = { token, contexts: {} }
  await options.stateStore.write(state)
  await options.secrets.write(accountId, secrets)
  return { state, secrets, account: { id: accountId, displayName, ownerId, status: 'offline' } }
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
