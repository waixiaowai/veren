/**
 * Account authorization: QR attempts, account persistence, and account removal.
 * This module owns the durable account table and the retirement wiring. It
 * never routes a conversation and never renders a prompt — since 2.1.8 the
 * message path is the queue (`queue.ts`) and sessions are private
 * (`conversation_sessions`), so there are no bindings anymore.
 *
 * 账号授权：二维码尝试、账号持久化与账号移除。本模块拥有持久的账号表与退役接线。它不路由
 * 会话、不渲染 Prompt——自 2.1.8 起消息路径是队列（`queue.ts`），会话是私有的
 * （`conversation_sessions`），绑定已不存在。
 *
 * @module @veren/im/bindings
 */

import { ImError, imCredentialKey } from './contract.ts'
import type {
  ImAccount,
  ImAccountView,
  ImBindAttempt,
  ImBindRequest,
  ImRegistry,
} from './contract.ts'
import type { ImAccountRow, ImCoreStore } from './store.ts'
import { errorMessage } from './runtime-seams.ts'
import type { ImLogger } from './runtime-seams.ts'

// ---- unchanged export surface (seams re-exported from runtime-seams.ts) ----
// ---- 导出面不变（接缝由 runtime-seams.ts 原样再导出）----
export { errorMessage } from './runtime-seams.ts'
export type {
  ImCredentialStore,
  ImLogger,
  ImPromptSource,
  ImRouterSendRequest,
  ImSessionGateway,
} from './runtime-seams.ts'

/** One bind poll result. */
export interface ImBindPollResult {
  attempt: ImBindAttempt
  account?: ImAccount
}

export interface ImBindingsOptions {
  store: ImCoreStore
  registry: ImRegistry
  logger: ImLogger
  newId?: (prefix: string) => string
  /**
   * Same-owner replacement on a fresh authorization: move the dead accounts'
   * rows onto the new one before it is persisted. Needs the full storage, so
   * the router wires it — the account seam alone cannot reach person rows.
   * 新授权确认时的同 owner 替换：把死账号的行迁移到新账号后再落新行。人员表不在本接缝，
   * 因此由 router 持完整存储接线。
   */
  retireOwnerAccounts?: (providerId: string, account: ImAccount) => Promise<void>
}

/** Account authorization: QR attempts and the durable account table. */
export class ImBindings {
  private readonly store: ImCoreStore
  private readonly registry: ImRegistry
  private readonly logger: ImLogger
  private readonly retireOwnerAccounts?: (providerId: string, account: ImAccount) => Promise<void>
  private readonly attempts = new Map<string, { providerId: string; attempt: ImBindAttempt }>()
  private writeChain: Promise<unknown> = Promise.resolve()
  constructor(options: ImBindingsOptions) {
    this.store = options.store
    this.registry = options.registry
    this.logger = options.logger
    this.retireOwnerAccounts = options.retireOwnerAccounts
  }

  /** Start one account authorization attempt and remember it for polling. */
  async beginBind(providerId: string, request: ImBindRequest): Promise<ImBindAttempt> {
    const provider = this.registry.get(providerId)
    const attempt = await provider.service.bind(request)
    this.attempts.set(attempt.bindId, { providerId, attempt })
    return attempt
  }

  /** Read one attempt and persist its account once bound; evict terminal attempts. */
  async pollBind(bindId: string): Promise<ImBindPollResult> {
    const entry = this.attempts.get(bindId)
    if (entry === undefined) throw new ImError('IM_NOT_FOUND', `unknown bind attempt: ${bindId}`)
    // bound 落账号；expired/failed 是终态——读一次后同样驱逐（后续 poll 明确报
    // IM_NOT_FOUND），否则死尝试会永远钉在 Map 里（10-24 review 的 P3 泄漏面）。
    // bound persists the account; expired/failed are terminal — evict after the
    // one readable poll too (later polls fail loudly), or dead attempts pin the
    // map forever (the 10-24 review's P3 leak).
    if (entry.attempt.status === 'expired' || entry.attempt.status === 'failed') {
      this.attempts.delete(bindId)
    }
    if (entry.attempt.status !== 'bound') return { attempt: entry.attempt }
    // The account is persisted exactly once; the entry is dropped so later polls
    // fail loudly and a terminal attempt cannot leak memory.
    // 账号只持久化一次；条目随即删除，后续 poll 明确报错，终态尝试也不再泄漏内存。
    this.attempts.delete(bindId)
    const account = await entry.attempt.wait()
    await this.persistAccount(entry.providerId, account)
    return { attempt: entry.attempt, account }
  }

  /** Submit a verification code for an attempt in the needs-code state, then poll. */
  async submitBindCode(bindId: string, code: string): Promise<ImBindPollResult> {
    const entry = this.attempts.get(bindId)
    if (entry === undefined) throw new ImError('IM_NOT_FOUND', `unknown bind attempt: ${bindId}`)
    if (entry.attempt.submitCode === undefined) {
      throw new ImError('IM_INVALID_REQUEST', `bind attempt ${bindId} does not take a verification code`)
    }
    await entry.attempt.submitCode(code)
    return this.pollBind(bindId)
  }

  /** The durable account rows merged with live provider status. */
  async listAccounts(): Promise<ImAccountView[]> {
    return this.accountViews()
  }

  /** Read one account row. */
  account(accountId: string): ImAccountRow | undefined {
    return this.store.getAccount(accountId)
  }

  /** Delete every row owned by one account. */
  removeAccountRows(accountId: string): Promise<void> {
    return this.write(async () => {
      await this.store.deleteConversationsOf(accountId)
      await this.store.deleteAccount(accountId)
    })
  }

  /**
   * Drop every remembered bind attempt; called on plugin unload. The attempts
   * stay alive on their provider — unloading the core must not cancel a user's
   * in-flight authorization — but the core stops pinning them.
   * 丢弃全部已记住的 bind 尝试；插件卸载时调用。尝试在其 provider 上保持存活——卸载核心
   * 不取消用户正在进行的授权——但核心不再钉住它们。
   */
  dispose(): void {
    this.attempts.clear()
  }

  /** Persist one authorized account. */
  private async persistAccount(providerId: string, account: ImAccount): Promise<void> {
    // 先退役同 owner 的死账号（行迁移到新 id），再落新账号行——顺序保证迁移读到的
    // accounts 表里还没有新行，不会把自己当成退役对象。
    // Retire the owner's dead accounts (rows move to the new id) before the new
    // row lands, so the migration never sees — and retires — the new row itself.
    await this.retireOwnerAccounts?.(providerId, account)
    const row: ImAccountRow = {
      id: account.id,
      provider: providerId,
      token_ref: imCredentialKey(account.id),
      ...(account.ownerId === undefined ? {} : { owner_id: account.ownerId }),
    }
    await this.write(() => this.store.putAccount(row))
  }

  /** Merge live provider status into the durable account rows. */
  private async accountViews(): Promise<ImAccountView[]> {
    const live = new Map<string, ImAccount>()
    for (const provider of this.registry.list()) {
      try {
        for (const account of await provider.service.accounts()) live.set(account.id, account)
      } catch (error: unknown) {
        this.logger.warn(`[im:${provider.id}] accounts() failed: ${errorMessage(error)}`)
      }
    }
    return this.store.accounts().map(row => {
      const current = live.get(row.id)
      return {
        id: row.id,
        provider: row.provider,
        displayName: current?.displayName ?? row.id,
        ...(row.owner_id === undefined ? {} : { ownerId: row.owner_id }),
        status: current?.status ?? 'offline',
      }
    })
  }

  /** Serialize every mutation so account writes cannot race. */
  private write<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.writeChain.then(work)
    this.writeChain = pending.catch(() => undefined)
    return pending
  }
}
