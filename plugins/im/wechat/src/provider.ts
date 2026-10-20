/**
 * WeChat provider: QR authorization, long polling, and text sending.
 *
 * V1 is private conversations, text only, one account per `ilink_bot_id`. It
 * persists the cursor and deduplication ring in the `im_wechat` storage domain,
 * caches context_token there, keeps the bot token in the credential seam, and
 * stops after three failed polls.
 *
 * 微信 provider：仅私聊、仅文字、每个 `ilink_bot_id` 一个账号；游标与去重环持久化在
 * `im_wechat` 存储域，context_token 也缓存在那里，bot token 留在凭据服务，并在连续失败
 * 3 次后停止。
 *
 * @module @veren/im-wechat/provider
 */
import { randomUUID } from 'node:crypto'
import type { LoggerService } from '@deepseek-ai/cordis'
import { ImError } from '@veren/im'
import type {
  ImAccount,
  ImBindAttempt,
  ImBindRequest,
  ImFeatures,
  ImMessage,
  ImSendRequest,
  ImSendResult,
  ImService,
} from '@veren/im'
import {
  WEIXIN_BASE_URL,
  WEIXIN_BOT_TYPE,
  WEIXIN_LONG_POLL_MS,
  WechatApi,
  normalizeBaseUrl,
} from './api.ts'
import { WechatBindAttempt, delay, messageIdOf, qrImagePath, splitText, storeConfirmedAccount, textOf, writeQrImage } from './runtime.ts'
import type {
  WechatMessage,
  WechatProviderOptions,
  WechatSecrets,
  WechatSecretStore,
  WechatState,
  WechatStore,
} from './state.ts'
/** Capabilities WeChat V1 declares. */
export const WEIXIN_FEATURES: ImFeatures = {
  direct: true,
  group: false,
  threads: false,
  markdown: false,
  media: { image: false, file: false },
  typing: false,
  auth: ['qrcode'],
  limits: { textChars: 1_800 },
}
/** One live account runtime. */
interface AccountRuntime {
  state: WechatState
  secrets: WechatSecrets
  status: 'online' | 'offline' | 'error'
  controller?: AbortController
  monitor?: Promise<void>
}
/** WeChat implementation of the provider-neutral service. */
export class WechatProvider implements ImService {
  readonly features = WEIXIN_FEATURES
  private readonly api: WechatApi
  private readonly store: WechatStore
  private readonly secrets: WechatSecretStore
  private readonly logger: LoggerService
  private readonly now: () => number
  private readonly baseUrl: string
  private readonly qrTtlMs: number
  private readonly pollIntervalMs: number
  // Named `runtimes` because the public `accounts()` method already owns that name.
  // 命名为 `runtimes`，因为公开的 `accounts()` 方法已占用该名称。
  private readonly runtimes = new Map<string, AccountRuntime>()
  private readonly handlers = new Set<(message: ImMessage) => void | Promise<void>>()
  // Guards against a stop() landing while start() is still loading accounts.
  // 防止 stop() 在 start() 仍在加载账号时落下，导致卸载后重启监听循环。
  private disposed = false
  constructor(options: WechatProviderOptions) {
    this.logger = options.logger
    this.now = options.now ?? Date.now
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? WEIXIN_BASE_URL, WEIXIN_BASE_URL)
    this.qrTtlMs = options.qrTtlMs ?? 300_000
    this.pollIntervalMs = options.pollIntervalMs ?? 1_500
    this.store = options.store
    this.secrets = options.secrets
    this.api = new WechatApi({
      baseUrl: this.baseUrl,
      botType: options.botType ?? WEIXIN_BOT_TYPE,
      longPollTimeoutMs: options.longPollTimeoutMs ?? WEIXIN_LONG_POLL_MS,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    })
  }
  async start(): Promise<void> {
    this.disposed = false
    let states: WechatState[]
    try {
      states = this.store.states()
    } catch (error: unknown) {
      // A closed or unavailable domain must not look like an empty account set:
      // silently starting with zero accounts would drop every persisted binding.
      // 已关闭或不可用的 domain 不能被当成空账号集：静默以零账号启动会丢掉全部已落盘的绑定。
      this.logger.error(`[im:wechat] storage could not be read: ${messageOf(error)}`)
      throw new ImError('IM_INTERNAL', `wechat storage is unavailable: ${messageOf(error)}`, { cause: error })
    }
    for (const state of states) {
      if (this.disposed) return
      const accountId = state.accountId
      try {
        const secrets = await this.secrets.read(accountId)
        if (this.disposed) return
        if (secrets === undefined) {
          this.logger.warn(`[im:wechat] account ${accountId} has state but no credential; skipped`)
          continue
        }
        this.runtimes.set(accountId, { state, secrets, status: 'offline' })
        this.startMonitor(accountId)
      } catch (error: unknown) {
        this.logger.error(`[im:wechat] account ${accountId} could not load: ${messageOf(error)}`)
      }
    }
  }

  async stop(): Promise<void> {
    this.disposed = true
    const entries = [...this.runtimes.entries()]
    this.runtimes.clear()
    for (const [accountId, runtime] of entries) {
      runtime.controller?.abort()
      await runtime.monitor?.catch(() => undefined)
      try {
        await this.api.notifyStop(runtime.secrets.token)
      } catch (error: unknown) {
        this.logger.warn(`[im:wechat] account ${accountId} notifystop failed: ${messageOf(error)}`)
      }
    }
  }

  async accounts(): Promise<ImAccount[]> {
    return [...this.runtimes.values()].map(runtime => ({
      id: runtime.state.accountId,
      displayName: runtime.state.displayName,
      status: runtime.status,
      ...(runtime.state.ownerId === undefined ? {} : { ownerId: runtime.state.ownerId }),
    }))
  }

  /** Stop one account's monitor, drop it, and delete its durable state. */
  async removeAccount(accountId: string): Promise<void> {
    const runtime = this.runtimes.get(accountId)
    if (runtime !== undefined) {
      this.runtimes.delete(accountId)
      runtime.controller?.abort()
      await runtime.monitor?.catch(() => undefined)
      try {
        await this.api.notifyStop(runtime.secrets.token)
      } catch (error: unknown) {
        this.logger.warn(`[im:wechat] account ${accountId} notifystop failed: ${messageOf(error)}`)
      }
    }
    try {
      await this.store.deleteState(accountId)
    } catch (error: unknown) {
      throw new ImError('IM_INTERNAL', `wechat storage could not remove account ${accountId}: ${messageOf(error)}`, { cause: error })
    }
  }

  listen(handler: (message: ImMessage) => void | Promise<void>, signal?: AbortSignal): () => void {
    this.handlers.add(handler)
    const dispose = (): void => {
      signal?.removeEventListener('abort', dispose)
      this.handlers.delete(handler)
    }
    if (signal !== undefined) {
      if (signal.aborted) dispose()
      else signal.addEventListener('abort', dispose, { once: true })
    }
    return dispose
  }

  async bind(request: ImBindRequest): Promise<ImBindAttempt> {
    if (request.method !== 'qrcode') {
      throw new ImError('IM_UNSUPPORTED', 'WeChat V1 supports QR authorization only')
    }
    const login = await this.api.beginLogin()
    const bindId = `bind_${randomUUID()}`
    const expiresAt = this.now() + this.qrTtlMs
    const imagePath = qrImagePath(bindId)
    await writeQrImage(imagePath, login.qrUrl)
    const attempt = new WechatBindAttempt({
      bindId,
      qrcode: login.qrcode,
      expiresAt,
      imagePath,
      api: this.api,
      now: this.now,
      pollIntervalMs: this.pollIntervalMs,
      logger: this.logger,
      activate: response => this.activate(response, request.label),
    })
    void attempt.run()
    return attempt
  }

  async send(request: ImSendRequest): Promise<ImSendResult> {
    const runtime = this.runtimes.get(request.target.accountId)
    if (runtime === undefined) throw new ImError('IM_NOT_FOUND', `unknown WeChat account: ${request.target.accountId}`)
    const content = request.content
    if (content.type === 'image' || content.type === 'file') {
      throw new ImError('IM_UNSUPPORTED', 'WeChat V1 supports text only')
    }
    if (content.text.trim() === '') throw new ImError('IM_INVALID_REQUEST', 'text is empty')
    const userId = request.target.conversationId.startsWith('p2p:')
      ? request.target.conversationId.slice(4)
      : request.target.conversationId
    let contextToken: string | undefined
    try {
      contextToken = this.store.contextToken(request.target.accountId, userId)
    } catch (error: unknown) {
      throw new ImError('IM_INTERNAL', `wechat context token could not be read: ${messageOf(error)}`, { cause: error })
    }
    let first: { id: string; sentAt: number } | undefined
    for (const segment of splitText(content.text, WEIXIN_FEATURES.limits.textChars)) {
      try {
        const sent = await this.api.sendText(runtime.secrets.token, userId, segment, contextToken)
        first ??= sent
      } catch (error: unknown) {
        if (first !== undefined && error instanceof ImError) {
          throw new ImError('IM_DELIVERY_UNCERTAIN', 'part of the WeChat message was sent', {
            providerCode: error.providerCode,
          })
        }
        throw error
      }
    }
    if (first === undefined) throw new ImError('IM_INVALID_REQUEST', 'nothing to send')
    return { id: first.id, sentAt: first.sentAt }
  }
  /** Persist one confirmed account and start its monitor. */
  private async activate(response: { bot_token?: string; ilink_bot_id?: string; ilink_user_id?: string; baseurl?: string }, label?: string): Promise<ImAccount> {
    const stored = await storeConfirmedAccount(response, label, {
      baseUrl: this.baseUrl,
      store: this.store,
      secrets: this.secrets,
    })
    this.runtimes.set(stored.state.accountId, {
      state: stored.state,
      secrets: stored.secrets,
      status: 'offline',
    })
    this.startMonitor(stored.state.accountId)
    return stored.account
  }
  /** Start one account monitor unless it is already running or stopped. */
  private startMonitor(accountId: string): void {
    if (this.disposed) return
    const runtime = this.runtimes.get(accountId)
    if (runtime === undefined || runtime.controller !== undefined) return
    const controller = new AbortController()
    runtime.controller = controller
    runtime.monitor = this.monitor(accountId, runtime, controller.signal).catch((error: unknown) => {
      runtime.status = 'error'
      this.logger.error(`[im:wechat] account ${accountId} monitor failed: ${messageOf(error)}`)
    })
  }
  /** One account's long-poll loop. */
  private async monitor(accountId: string, runtime: AccountRuntime, signal: AbortSignal): Promise<void> {
    try {
      await this.api.notifyStart(runtime.secrets.token, signal)
    } catch (error: unknown) {
      runtime.status = 'error'
      this.logger.error(`[im:wechat] account ${accountId} notifystart failed: ${messageOf(error)}`)
      return
    }
    let failures = 0
    while (!signal.aborted) {
      try {
        const batch = await this.api.getUpdates(runtime.secrets.token, runtime.state.cursor, signal)
        if (signal.aborted) return
        failures = 0
        runtime.status = 'online'
        for (const message of batch.messages) await this.accept(runtime, message)
        runtime.state.cursor = batch.cursor
        await this.persistState(accountId)
      } catch (error: unknown) {
        if (signal.aborted) return
        if (error instanceof ImError && error.code === 'IM_AUTH_REQUIRED') {
          runtime.status = 'error'
          this.logger.error(`[im:wechat] account ${accountId} credential is stale (-14); runtime stopped`)
          return
        }
        failures += 1
        if (failures >= 3) {
          runtime.status = 'error'
          this.logger.error(`[im:wechat] account ${accountId} failed ${failures} times; runtime stopped`)
          return
        }
        await delay(2_000 * 2 ** (failures - 1), signal)
      }
    }
  }
  /** Persist one runtime's cursor and deduplication ring, logging any failure. */
  private async persistState(accountId: string): Promise<void> {
    const runtime = this.runtimes.get(accountId)
    if (runtime === undefined) return
    try {
      await this.store.putState(runtime.state)
    } catch (error: unknown) {
      this.logger.error(`[im:wechat] account ${accountId} state was not persisted: ${messageOf(error)}`)
      throw error
    }
  }
  /** Cache one context token; a storage failure is reported, never swallowed. */
  private async cacheContextToken(accountId: string, userId: string, token: string): Promise<void> {
    let current: string | undefined
    try {
      current = this.store.contextToken(accountId, userId)
    } catch (error: unknown) {
      this.logger.warn(`[im:wechat] account ${accountId} context_token could not be read: ${messageOf(error)}`)
      return
    }
    if (current === token) return
    try {
      await this.store.putContextToken(accountId, userId, token, this.now())
    } catch (error: unknown) {
      this.logger.warn(`[im:wechat] account ${accountId} context_token was not persisted: ${messageOf(error)}`)
    }
  }
  /** Normalize one inbound message, deduplicate it, and notify listeners. */
  private async accept(runtime: AccountRuntime, message: WechatMessage): Promise<void> {
    if (message.message_type === 2) return
    const id = messageIdOf(message)
    if (id === undefined || runtime.state.seen.includes(id)) return
    runtime.state.seen.push(id)
    if (runtime.state.seen.length > 1_000) runtime.state.seen.splice(0, runtime.state.seen.length - 1_000)
    const sender = message.from_user_id?.trim()
    if (sender === undefined || sender === '') return
    const text = textOf(message)
    if (text === undefined) return
    const contextToken = message.context_token?.trim()
    if (contextToken !== undefined && contextToken !== '') {
      await this.cacheContextToken(runtime.state.accountId, sender, contextToken)
    }
    const inbound: ImMessage = {
      id,
      accountId: runtime.state.accountId,
      conversationId: `p2p:${sender}`,
      sender: { id: sender },
      sentAt: message.create_time_ms ?? this.now(),
      content: { type: 'text', text },
    }
    for (const handler of [...this.handlers]) {
      try {
        await handler(inbound)
      } catch (error: unknown) {
        this.logger.error(`[im:wechat] inbound handler failed: ${messageOf(error)}`)
      }
    }
  }
}
/** Turn an unknown failure into one log line. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export { splitText } from './runtime.ts'
