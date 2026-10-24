/**
 * The live WeChat QR bind attempt: its poll loop, verify-code submission,
 * waiters, and cancellation.
 *
 * One attempt owns its poll loop and waiters; the challenge is a presentation
 * artifact the caller reads through `ImBindChallenge.imagePath`. No helper logs
 * a token or the QR URL.
 *
 * 微信二维码绑定尝试：轮询循环、验证码提交、等待者与取消。
 *
 * 一次尝试拥有自己的轮询循环与等待者；挑战是调用方通过 `ImBindChallenge.imagePath` 读取的
 * 展示产物。任何辅助函数都不记录 token 或二维码 URL。
 *
 * Split out of `runtime.ts` so the account-persistence helpers stay under the
 * file-size ceiling; the export surface of `runtime.ts` is unchanged — it
 * re-exports the attempt from here.
 *
 * 按职责从 `runtime.ts` 拆出，让账号持久化辅助保持在单文件行数上限内；`runtime.ts` 的
 * 导出面不变——它从这里原样再导出尝试类型。
 *
 * @module @veren/im-wechat/bind-attempt
 */

import { ImError } from '@veren/im'
import type { LoggerService } from '@deepseek-ai/cordis'
import type { ImAccount, ImBindAttempt, ImBindChallenge, ImBindStatus } from '@veren/im'
import { WechatApi, WechatTimeoutError } from './api.ts'
import type { WechatLoginStatus } from './state.ts'

/** Attempt construction options. */
export interface WechatBindAttemptOptions {
  bindId: string
  qrcode: string
  expiresAt: number
  imagePath: string
  api: WechatApi
  now: () => number
  pollIntervalMs?: number
  logger: LoggerService
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
  private readonly controller = new AbortController()
  private readonly api: WechatApi
  private readonly now: () => number
  private readonly logger: LoggerService
  private readonly activate: (response: WechatLoginStatus) => Promise<ImAccount>
  private readonly pollIntervalMs: number
  private readonly waiters: Array<{ resolve(account: ImAccount): void; reject(error: unknown): void }> = []
  private qrcode: string
  private code: string | undefined
  // Named `bindStatus` because the public `status` getter already owns that name.
  // 命名为 `bindStatus`，因为公开的 `status` getter 已占用该名称。
  private bindStatus: ImBindStatus = 'pending'
  private account: ImAccount | undefined

  constructor(options: WechatBindAttemptOptions) {
    this.bindId = options.bindId
    this.qrcode = options.qrcode
    this.api = options.api
    this.now = options.now
    this.logger = options.logger
    this.activate = options.activate
    this.pollIntervalMs = options.pollIntervalMs ?? 1_500
    this.challenge = {
      kind: 'qrcode',
      expiresAt: options.expiresAt,
      imagePath: options.imagePath,
    }
  }

  get status(): ImBindStatus {
    return this.bindStatus
  }

  /** Advance the attempt until it is bound, expired, failed, or cancelled. */
  async run(): Promise<void> {
    while (!this.controller.signal.aborted && this.bindStatus !== 'bound') {
      if (this.now() >= (this.challenge.expiresAt ?? 0)) {
        this.finish('expired', new ImError('IM_BIND_EXPIRED', 'the WeChat QR code expired'))
        return
      }
      try {
        const response = await this.api.pollLogin(this.qrcode, this.code, this.controller.signal)
        if (this.controller.signal.aborted) return
        switch (response.status) {
          case 'wait':
            this.bindStatus = 'pending'
            break
          case 'scaned':
          case 'scaned_but_redirect':
            this.bindStatus = 'scanned'
            break
          case 'need_verifycode':
            this.bindStatus = 'needs-code'
            break
          case 'expired':
            this.finish('expired', new ImError('IM_BIND_EXPIRED', 'the WeChat QR code expired'))
            return
          case 'verify_code_blocked':
            this.finish('failed', new ImError('IM_AUTH_REQUIRED', 'the WeChat verify code was blocked'))
            return
          case 'binded_redirect':
            this.finish('failed', new ImError('IM_AUTH_REQUIRED', 'this WeChat account is already bound elsewhere'))
            return
          case 'confirmed': {
            try {
              const account = await this.activate(response)
              this.account = account
              this.bindStatus = 'bound'
              this.settleWaiters(account)
              return
            } catch (error: unknown) {
              this.finish('failed', asImError(error, 'the WeChat account could not be activated'))
              return
            }
          }
          default:
            this.finish('failed', new ImError('IM_INTERNAL', `unknown WeChat login status: ${response.status ?? ''}`))
            return
        }
      } catch (error: unknown) {
        if (this.controller.signal.aborted) return
        if (!(error instanceof WechatTimeoutError)) {
          this.finish(
            'failed',
            error instanceof ImError ? error : asImError(error, 'the WeChat QR poll failed'),
          )
          return
        }
      }
      await delay(this.pollIntervalMs, this.controller.signal)
    }
  }

  async submitCode(code: string): Promise<void> {
    if (this.bindStatus !== 'needs-code') {
      throw new ImError('IM_INVALID_REQUEST', 'this WeChat attempt does not need a verify code')
    }
    if (code.trim() === '') throw new ImError('IM_INVALID_REQUEST', 'a verify code is required')
    this.code = code.trim()
    this.bindStatus = 'pending'
  }

  wait(signal?: AbortSignal): Promise<ImAccount> {
    if (this.account !== undefined) return Promise.resolve(this.account)
    if (this.bindStatus === 'expired') return Promise.reject(new ImError('IM_BIND_EXPIRED', 'the WeChat QR code expired'))
    if (this.bindStatus === 'failed') return Promise.reject(new ImError('IM_INTERNAL', 'the WeChat bind attempt failed'))
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
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new ImError('IM_BIND_EXPIRED', 'the WeChat bind wait was aborted'))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.push(waiter)
    })
  }

  async cancel(): Promise<void> {
    if (this.bindStatus === 'bound') return
    this.bindStatus = 'expired'
    this.controller.abort()
    this.settleWaiters(undefined, new ImError('IM_BIND_EXPIRED', 'the WeChat bind attempt was cancelled'))
  }

  /** Move to a terminal failure state and reject waiters. */
  private finish(status: ImBindStatus, error: ImError): void {
    this.bindStatus = status
    this.controller.abort()
    this.settleWaiters(undefined, error)
    this.logger.warn(`[im:wechat] bind ${this.bindId} ended as ${status}: ${error.message}`)
  }

  /** Settle every waiter exactly once. */
  private settleWaiters(account?: ImAccount, error?: ImError): void {
    for (const waiter of this.waiters.splice(0)) {
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
