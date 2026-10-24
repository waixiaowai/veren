/**
 * The per-account monitor of the WeChat provider: the long-poll loop, inbound
 * normalization with deduplication, cursor persistence, and the context-token
 * cache.
 *
 * The monitor stops after three failed polls, and stops immediately on a stale
 * credential (`-14`). A deduplicated inbound message fans out to every listener;
 * one failing listener never breaks the others.
 *
 * 微信 provider 的单账号监视器：长轮询循环、入站归一与去重、游标持久化与 context_token 缓存。
 *
 * 监视器连续失败 3 次后停止，凭据失效（`-14`）时立即停止。去重后的入站消息广播给所有监听者；
 * 一个监听者失败绝不影响其他监听者。
 *
 * Split out of `provider.ts` so the service face stays under the file-size
 * ceiling; the export surface is unchanged — `provider.ts` keeps its names.
 *
 * 按职责从 `provider.ts` 拆出，让服务门面保持在单文件行数上限内；导出面不变——`provider.ts`
 * 保留原有名字。
 *
 * @module @veren/im-wechat/monitor
 */

import { ImError } from '@veren/im'
import type { LoggerService } from '@deepseek-ai/cordis'
import type { ImMessage } from '@veren/im'
import { WechatApi } from './api.ts'
import { delay } from './bind-attempt.ts'
import { messageIdOf, textOf } from './runtime.ts'
import type { WechatMessage, WechatSecrets, WechatState, WechatStore } from './state.ts'

/** One live account runtime. */
export interface AccountRuntime {
  state: WechatState
  secrets: WechatSecrets
  status: 'online' | 'offline' | 'error'
  controller?: AbortController
  monitor?: Promise<void>
}

/** Collaborators the monitor shares with the provider face. */
export interface WechatMonitorDeps {
  api: WechatApi
  store: WechatStore
  logger: LoggerService
  now: () => number
  /** Live runtimes, keyed by account id; owned by the provider. */
  runtimes: Map<string, AccountRuntime>
  /** Inbound listeners registered through `listen`. */
  handlers: Set<(message: ImMessage) => void | Promise<void>>
  /** Whether the provider has been stopped; a stopped provider never restarts a loop. */
  isDisposed: () => boolean
}

/** The long-poll monitor for every started account. */
export class WechatMonitor {
  private readonly api: WechatApi
  private readonly store: WechatStore
  private readonly logger: LoggerService
  private readonly now: () => number
  private readonly runtimes: Map<string, AccountRuntime>
  private readonly handlers: Set<(message: ImMessage) => void | Promise<void>>
  private readonly isDisposed: () => boolean

  constructor(deps: WechatMonitorDeps) {
    this.api = deps.api
    this.store = deps.store
    this.logger = deps.logger
    this.now = deps.now
    this.runtimes = deps.runtimes
    this.handlers = deps.handlers
    this.isDisposed = deps.isDisposed
  }

  /** Start one account monitor unless it is already running or stopped. */
  start(accountId: string): void {
    if (this.isDisposed()) return
    const runtime = this.runtimes.get(accountId)
    if (runtime === undefined || runtime.controller !== undefined) return
    const controller = new AbortController()
    runtime.controller = controller
    runtime.monitor = this.loop(accountId, runtime, controller.signal).catch((error: unknown) => {
      runtime.status = 'error'
      this.logger.error(`[im:wechat] account ${accountId} monitor failed: ${messageOf(error)}`)
    })
  }

  /** One account's long-poll loop. */
  private async loop(accountId: string, runtime: AccountRuntime, signal: AbortSignal): Promise<void> {
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
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
