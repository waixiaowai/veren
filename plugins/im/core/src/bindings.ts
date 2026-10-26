/**
 * Binding, authorization polling, sending, and listing.
 * This module owns every mutation of the durable binding table and the
 * active-pointer invariant. It never renders a prompt and never listens to a
 * channel: routing stays in `router.ts`.
 *
 * The logging/credential/gateway seams and the shared log-line helper live in
 * `runtime-seams.ts` and are re-exported unchanged here.
 *
 * 绑定、授权轮询、发送与列表。
 * 本模块拥有绑定表的全部写操作与 active 指针不变量。它不渲染 Prompt，也不监听渠道：路由留在
 * `router.ts`。
 *
 * 日志/凭据/网关接缝与共用日志助手在 `runtime-seams.ts`，并在此原样再导出。
 *
 * @module @veren/im/bindings
 */

import { randomUUID } from 'node:crypto'
import { ImError, imCredentialKey } from './contract.ts'
import type {
  ImAccount,
  ImAccountView,
  ImBinding,
  ImBindingSettings,
  ImBindAttempt,
  ImBindRequest,
  ImConversationView,
  ImRegistry,
} from './contract.ts'
import type { ImAccountRow, ImBindingStore } from './store.ts'
import { errorMessage } from './runtime-seams.ts'
import type { ImLogger, ImSessionGateway } from './runtime-seams.ts'

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

/** One `im_link` request. */
export interface ImLinkRequest {
  accountId: string
  conversationId: string
  sessionId?: string
  settings?: ImBindingSettings
  active?: boolean
}

/** One bind poll result. */
export interface ImBindPollResult {
  attempt: ImBindAttempt
  account?: ImAccount
}

/** Read-only list result. */
export interface ImListResult {
  accounts?: ImAccountView[]
  bindings?: ImBinding[]
  conversations?: ImConversationView[]
}

export interface ImBindingsOptions {
  store: ImBindingStore
  registry: ImRegistry
  gateway: ImSessionGateway
  logger: ImLogger
  newId?: (prefix: string) => string
}

/** Binding table operations shared by the router and tools. */
export class ImBindings {
  private readonly store: ImBindingStore
  private readonly registry: ImRegistry
  private readonly gateway: ImSessionGateway
  private readonly logger: ImLogger
  private readonly newId: (prefix: string) => string
  private readonly attempts = new Map<string, { providerId: string; attempt: ImBindAttempt }>()
  private writeChain: Promise<unknown> = Promise.resolve()
  constructor(options: ImBindingsOptions) {
    this.store = options.store
    this.registry = options.registry
    this.gateway = options.gateway
    this.logger = options.logger
    this.newId = options.newId ?? (prefix => `${prefix}_${randomUUID()}`)
  }
  /** Start one authorization attempt and remember it for polling. */
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
  /** Bind or re-bind one conversation to one Session. */
  async link(request: ImLinkRequest): Promise<ImBinding> {
    const account = this.requireAccount(request.accountId)
    const settings = request.settings ?? {}
    const active = request.active !== false
    return this.write(async () => {
      // Session creation sits inside the write lock so two concurrent links for
      // one conversation cannot create two Sessions / two active bindings.
      // Session 创建放在写锁内，同一会话的并发 link 不会创建两个 Session / 两条 active binding。
      const sessionId = request.sessionId
        ?? (await this.gateway.ensureSession({ settings })).sessionId
      await this.ensureConversation(account.id, request.conversationId)
      if (active) await this.deactivateSiblings(account.id, request.conversationId)
      const binding: ImBinding = {
        id: this.newId('bind'),
        accountId: account.id,
        conversationId: request.conversationId,
        sessionId,
        active,
        settings,
      }
      await this.store.putBinding(binding)
      return binding
    })
  }
  /** Remove one conversation binding; the account stays authorized. */
  async unbindBinding(bindingId: string): Promise<void> {
    if (this.store.getBinding(bindingId) === undefined) {
      throw new ImError('IM_NOT_FOUND', `unknown binding: ${bindingId}`)
    }
    await this.write(() => this.store.deleteBinding(bindingId))
  }
  /** Replace fields of one binding's settings. */
  async settings(bindingId: string, patch: ImBindingSettings): Promise<ImBinding> {
    if ((patch.provider === undefined) !== (patch.model === undefined)) {
      throw new ImError('IM_INVALID_REQUEST', 'provider and model must be set together')
    }
    return this.write(async () => {
      const binding = this.requireBinding(bindingId)
      const settings: ImBindingSettings = { ...binding.settings }
      for (const key of ['presetId', 'provider', 'model', 'reasoning'] as const) {
        const value = patch[key]
        if (value !== undefined) settings[key] = value
      }
      const updated = { ...binding, settings }
      await this.store.putBinding(updated)
      return updated
    })
  }
  /** Read accounts, bindings, or conversations. */
  async list(type?: 'accounts' | 'bindings' | 'conversations'): Promise<ImListResult> {
    if (type === 'bindings') return { bindings: this.store.bindings() }
    if (type === 'conversations') return { conversations: this.conversationViews() }
    if (type === 'accounts') return { accounts: await this.accountViews() }
    return {
      accounts: await this.accountViews(),
      bindings: this.store.bindings(),
      conversations: this.conversationViews(),
    }
  }
  /** The active binding for one conversation, when it exists. */
  activeBinding(accountId: string, conversationId: string): ImBinding | undefined {
    return this.store.activeBinding(accountId, conversationId)
  }
  /** Read one account row. */
  account(accountId: string): ImAccountRow | undefined {
    return this.store.getAccount(accountId)
  }
  /** Read one binding. */
  binding(bindingId: string): ImBinding | undefined {
    return this.store.getBinding(bindingId)
  }
  /** Delete every row owned by one account. */
  removeAccountRows(accountId: string): Promise<void> {
    return this.write(async () => {
      await this.store.deleteBindingsOf(accountId)
      await this.store.deleteConversationsOf(accountId)
      await this.store.deleteAccount(accountId)
    })
  }
  /** Create an active binding for an inbound conversation. */
  createActiveBinding(accountId: string, conversationId: string, sessionId: string): Promise<ImBinding> {
    return this.write(async () => {
      await this.ensureConversation(accountId, conversationId)
      await this.deactivateSiblings(accountId, conversationId)
      const binding: ImBinding = {
        id: this.newId('bind'),
        accountId,
        conversationId,
        sessionId,
        active: true,
        settings: {},
      }
      await this.store.putBinding(binding)
      return binding
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
    const row: ImAccountRow = {
      id: account.id,
      provider: providerId,
      token_ref: imCredentialKey(account.id),
      ...(account.ownerId === undefined ? {} : { owner_id: account.ownerId }),
    }
    await this.write(() => this.store.putAccount(row))
  }
  /** Insert the conversation row when it is not known yet. */
  private async ensureConversation(accountId: string, conversationId: string): Promise<void> {
    if (this.store.getConversation(accountId, conversationId) !== undefined) return
    await this.store.putConversation({
      account_id: accountId,
      conversation_id: conversationId,
      kind: 'direct',
    })
  }
  /** Turn every other active binding for one conversation off. */
  private async deactivateSiblings(accountId: string, conversationId: string): Promise<void> {
    for (const binding of this.store.bindings()) {
      if (binding.accountId !== accountId
        || binding.conversationId !== conversationId
        || !binding.active) continue
      await this.store.putBinding({ ...binding, active: false })
    }
  }
  /** Resolve one account row or fail with IM_NOT_FOUND. */
  private requireAccount(accountId: string): ImAccountRow {
    const account = this.store.getAccount(accountId)
    if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${accountId}`)
    return account
  }
  /** Resolve one binding or fail with IM_NOT_FOUND. */
  private requireBinding(bindingId: string): ImBinding {
    const binding = this.store.getBinding(bindingId)
    if (binding === undefined) throw new ImError('IM_NOT_FOUND', `unknown binding: ${bindingId}`)
    return binding
  }
  /** Serialize every mutation so the active-pointer invariant cannot race. */
  private write<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.writeChain.then(work)
    this.writeChain = pending.catch(() => undefined)
    return pending
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
  /** Project conversation rows into the public view. */
  private conversationViews(): ImConversationView[] {
    return this.store.conversations().map(row => ({
      accountId: row.account_id,
      id: row.conversation_id,
      kind: row.kind,
      ...(row.title === undefined ? {} : { title: row.title }),
    }))
  }
}
