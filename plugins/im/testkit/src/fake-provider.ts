/**
 * Programmable fake provider for @veren/im contract tests.
 *
 * The fake owns no network and no files: it lets a test advance the QR bind
 * state machine, emit inbound messages, and inspect exactly what was sent. It
 * implements the same `ImService` a real channel does, including message-id
 * deduplication and text segmentation against `features.limits.textChars`.
 *
 * @veren/im 契约测试用的可编程假 provider。
 *
 * 假 provider 不碰网络与文件：测试可以推进扫码绑定状态机、注入入站消息，并检查实际发送内容。
 * 它实现与真实渠道相同的 `ImService`，包括按 message id 去重和按 `features.limits.textChars` 分段。
 *
 * @module @veren/im-testkit/fake-provider
 */

import { ImError } from '@veren/im'
import type {
  ImAccount,
  ImBindAttempt,
  ImBindChallenge,
  ImBindStatus,
  ImFeatures,
  ImMessage,
  ImMessageContent,
  ImProvider,
  ImSendRequest,
  ImSendResult,
  ImService,
} from '@veren/im'

/** Fake provider options. */
export interface FakeProviderOptions {
  id?: string
  displayName?: string
  textChars?: number
  markdown?: boolean
  media?: { image: boolean; file: boolean }
  now?: () => number
}

/** Split text into chunks no longer than `limit` UTF-16 code units. */
export function splitText(text: string, limit?: number): string[] {
  if (limit === undefined || limit <= 0 || text.length <= limit) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = limit
    const last = rest.charCodeAt(cut - 1)
    // Keep a surrogate pair together even though the limit counts code units.
    if (last >= 0xD800 && last <= 0xDBFF) cut -= 1
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest.length > 0) chunks.push(rest)
  return chunks
}

/** One controllable authorization attempt. */
export class FakeBindAttempt implements ImBindAttempt {
  readonly bindId: string
  readonly challenge: ImBindChallenge
  #status: ImBindStatus = 'pending'
  #account: ImAccount | undefined
  #resolve: ((account: ImAccount) => void) | undefined
  #reject: ((error: unknown) => void) | undefined

  /**
   * @param bindId - stable attempt id.
   * @param expiresAt - challenge expiry.
   * @param accept - callback that records the bound account.
   */
  constructor(
    bindId: string,
    expiresAt: number,
    private readonly accept: (account: ImAccount) => void,
  ) {
    this.bindId = bindId
    this.challenge = { kind: 'qrcode', expiresAt, imagePath: `/tmp/${bindId}.png` }
  }

  get status(): ImBindStatus {
    return this.#status
  }

  /** Move to `bound` and resolve every waiter. */
  confirm(account: ImAccount): void {
    if (this.#account !== undefined) return
    this.#account = account
    this.#status = 'bound'
    this.accept(account)
    this.#resolve?.(account)
  }

  /** Move to `needs-code`; a later `submitCode` returns to `pending`. */
  requireCode(): void {
    if (this.#status === 'pending' || this.#status === 'scanned') this.#status = 'needs-code'
  }

  async submitCode(code: string): Promise<void> {
    if (code.trim() === '') throw new ImError('IM_INVALID_REQUEST', 'code is required')
    if (this.#status === 'needs-code') this.#status = 'pending'
    else throw new ImError('IM_INVALID_REQUEST', 'this attempt does not need a code')
  }

  /** Move to `expired` and reject waiters. */
  expire(): void {
    this.#status = 'expired'
    this.#reject?.(new ImError('IM_BIND_EXPIRED', 'the bind attempt expired'))
  }

  /** Move to `failed` and reject waiters. */
  fail(reason = 'the bind attempt failed'): void {
    this.#status = 'failed'
    this.#reject?.(new ImError('IM_INTERNAL', reason))
  }

  wait(signal?: AbortSignal): Promise<ImAccount> {
    if (this.#account !== undefined) return Promise.resolve(this.#account)
    if (this.#status === 'expired') return Promise.reject(new ImError('IM_BIND_EXPIRED', 'the bind attempt expired'))
    if (this.#status === 'failed') return Promise.reject(new ImError('IM_INTERNAL', 'the bind attempt failed'))
    return new Promise<ImAccount>((resolve, reject) => {
      const onAbort = (): void => {
        this.#resolve = undefined
        this.#reject = undefined
        reject(new ImError('IM_BIND_EXPIRED', 'the bind wait was aborted'))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.#resolve = (account) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(account)
      }
      this.#reject = (error) => {
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      }
    })
  }

  async cancel(): Promise<void> {
    this.#status = 'expired'
    this.#reject?.(new ImError('IM_BIND_EXPIRED', 'the bind attempt was cancelled'))
  }
}

/** A fully in-memory `ImService` with test controls. */
export class FakeProvider implements ImService {
  readonly features: ImFeatures
  readonly provider: ImProvider
  readonly sent: ImSendRequest[] = []
  readonly accountsList: ImAccount[] = []
  lastAttempt: FakeBindAttempt | undefined
  started = 0
  stopped = 0
  #handler: ((message: ImMessage) => void | Promise<void>) | undefined
  #seen = new Set<string>()
  #failNext: ImError | undefined
  #bindCount = 0
  readonly #now: () => number

  constructor(options: FakeProviderOptions = {}) {
    const id = options.id ?? 'fake'
    this.#now = options.now ?? Date.now
    this.features = {
      direct: true,
      group: false,
      threads: false,
      markdown: options.markdown ?? false,
      media: options.media ?? { image: false, file: false },
      typing: false,
      auth: ['qrcode', 'token', 'password'],
      limits: { textChars: options.textChars ?? 1800 },
    }
    this.provider = {
      id,
      displayName: options.displayName ?? 'Fake IM',
      features: this.features,
      service: this,
    }
  }

  async start(): Promise<void> {
    this.started += 1
  }

  async stop(): Promise<void> {
    this.stopped += 1
  }

  async accounts(): Promise<ImAccount[]> {
    return [...this.accountsList]
  }

  /** Drop one account; exercises the preferred single-account removal path. */
  async removeAccount(accountId: string): Promise<void> {
    const index = this.accountsList.findIndex(item => item.id === accountId)
    if (index >= 0) this.accountsList.splice(index, 1)
  }

  listen(handler: (message: ImMessage) => void | Promise<void>, signal?: AbortSignal): () => void {
    this.#handler = handler
    const dispose = (): void => {
      signal?.removeEventListener('abort', dispose)
      if (this.#handler === handler) this.#handler = undefined
    }
    if (signal !== undefined) {
      if (signal.aborted) dispose()
      else signal.addEventListener('abort', dispose, { once: true })
    }
    return dispose
  }

  async bind(request: { method: string }): Promise<FakeBindAttempt> {
    if (request.method !== 'qrcode') {
      throw new ImError('IM_UNSUPPORTED', `fake provider does not support ${request.method}`)
    }
    // A dedicated counter: bind ids must not share a namespace with message ids.
    // 独立计数器：bind id 不能与 message id 共用命名空间。
    this.#bindCount += 1
    const attempt = new FakeBindAttempt(`bind-${this.#bindCount}`, this.#now() + 60_000, account => {
      if (!this.accountsList.some(item => item.id === account.id)) this.accountsList.push(account)
    })
    this.lastAttempt = attempt
    return attempt
  }

  async send(request: ImSendRequest): Promise<ImSendResult> {
    const failure = this.#failNext
    this.#failNext = undefined
    if (failure !== undefined) throw failure
    this.#assertSupported(request.content)
    const text = request.content.type === 'text' || request.content.type === 'markdown'
      ? request.content.text
      : undefined
    if (text === undefined) {
      this.sent.push(request)
      return { id: `sent-${this.sent.length}`, sentAt: this.#now() }
    }
    let first: ImSendResult | undefined
    for (const chunk of splitText(text, this.features.limits.textChars)) {
      this.sent.push({ ...request, content: { type: 'text', text: chunk } })
      first ??= { id: `sent-${this.sent.length}`, sentAt: this.#now() }
    }
    return first ?? { id: `sent-${this.sent.length + 1}`, sentAt: this.#now(), uncertain: true }
  }

  /** Emit one inbound message; duplicates return false and are not delivered. */
  async emit(message: ImMessage): Promise<boolean> {
    if (this.#seen.has(message.id)) return false
    this.#seen.add(message.id)
    await this.#handler?.(message)
    return true
  }

  /** Bind the last attempt and register its account. */
  confirmBind(account: Partial<ImAccount> = {}): ImAccount {
    const attempt = this.lastAttempt
    if (attempt === undefined) throw new Error('no bind attempt to confirm')
    const confirmed: ImAccount = {
      id: account.id ?? 'fake-account',
      displayName: account.displayName ?? 'Fake Account',
      status: account.status ?? 'online',
      ...(account.ownerId === undefined ? {} : { ownerId: account.ownerId }),
    }
    attempt.confirm(confirmed)
    return confirmed
  }

  /** Make the next send fail with the given error. */
  rejectNext(error: ImError): void {
    this.#failNext = error
  }

  /** Reject content the declared capabilities do not allow. */
  #assertSupported(content: ImMessageContent): void {
    if (content.type === 'image' && !this.features.media.image) {
      throw new ImError('IM_UNSUPPORTED', 'this fake provider cannot send images')
    }
    if (content.type === 'file' && !this.features.media.file) {
      throw new ImError('IM_UNSUPPORTED', 'this fake provider cannot send files')
    }
  }
}

/** Create one fake provider. */
export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  return new FakeProvider(options)
}
