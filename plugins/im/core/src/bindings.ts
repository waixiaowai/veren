/**
 * Binding, authorization polling, sending, and listing.
 *
 * This module owns every mutation of the durable binding table and the
 * active-pointer invariant. It never renders a prompt and never listens to a
 * channel: routing stays in `router.ts`.
 *
 * 绑定、授权轮询、发送与列表。
 *
 * 本模块拥有绑定表的全部写操作与 active 指针不变量。它不渲染 Prompt，也不监听渠道：路由留在
 * `router.ts`。
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
  ImMessageContent,
  ImRegistry,
} from './contract.ts'
import type { ImAccountRow, ImBindingStore } from './store.ts'

/** Logging surface shared by the router and bindings. */
export interface ImLogger {
  info?(message: string): void
  warn(message: string): void
  error(message: string): void
}
/** Credential removal seam; the DSH implementation deletes the account grant. */
export interface ImCredentialStore {
  remove(accountId: string): Promise<void>
}
/** One inbound prompt's provenance, kept out of the prompt body. */
export interface ImPromptSource {
  providerId: string
  accountId: string
  conversationId: string
  messageId: string
}
/** Session hand-off used by the router; tests provide a deterministic fake. */
export interface ImSessionGateway {
  ensureSession(request: {
    sessionId?: string
    settings: ImBindingSettings
  }): Promise<{ sessionId: string; created: boolean }>
  ask(request: {
    sessionId: string
    prompt: string
    source: ImPromptSource
  }): Promise<string | undefined>
}
/** One `im_link` request. */
export interface ImLinkRequest {
  accountId: string
  conversationId: string
  sessionId?: string
  settings?: ImBindingSettings
  active?: boolean
}
/** One router-level send request; exactly one target form is allowed. */
export interface ImRouterSendRequest {
  bindingId?: string
  accountId?: string
  conversationId?: string
  content: ImMessageContent
  replyToMessageId?: string
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
/** Turn an unknown value into one log line. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
/** Binding table operations shared by the router and tools. */
export class ImBindings {
  readonly #store: ImBindingStore
  readonly #registry: ImRegistry
  readonly #gateway: ImSessionGateway
  readonly #logger: ImLogger
  readonly #newId: (prefix: string) => string
  readonly #attempts = new Map<string, { providerId: string; attempt: ImBindAttempt }>()
  #writeChain: Promise<unknown> = Promise.resolve()

  constructor(options: ImBindingsOptions) {
    this.#store = options.store
    this.#registry = options.registry
    this.#gateway = options.gateway
    this.#logger = options.logger
    this.#newId = options.newId ?? (prefix => `${prefix}_${randomUUID()}`)
  }
  /** Start one authorization attempt and remember it for polling. */
  async beginBind(providerId: string, request: ImBindRequest): Promise<ImBindAttempt> {
    const provider = this.#registry.get(providerId)
    const attempt = await provider.service.bind(request)
    this.#attempts.set(attempt.bindId, { providerId, attempt })
    return attempt
  }
  /** Read one attempt and persist its account once bound. */
  async pollBind(bindId: string): Promise<ImBindPollResult> {
    const entry = this.#attempts.get(bindId)
    if (entry === undefined) throw new ImError('IM_NOT_FOUND', `unknown bind attempt: ${bindId}`)
    if (entry.attempt.status !== 'bound') return { attempt: entry.attempt }
    // The account is persisted exactly once; the entry is dropped so later polls
    // fail loudly and a terminal attempt cannot leak memory.
    // 账号只持久化一次；条目随即删除，后续 poll 明确报错，终态尝试也不再泄漏内存。
    this.#attempts.delete(bindId)
    const account = await entry.attempt.wait()
    await this.#persistAccount(entry.providerId, account)
    return { attempt: entry.attempt, account }
  }
  /** Bind or re-bind one conversation to one Session. */
  async link(request: ImLinkRequest): Promise<ImBinding> {
    const account = this.#requireAccount(request.accountId)
    const settings = request.settings ?? {}
    const active = request.active !== false
    return this.#write(async () => {
      // Session creation sits inside the write lock so two concurrent links for
      // one conversation cannot create two Sessions / two active bindings.
      // Session 创建放在写锁内，同一会话的并发 link 不会创建两个 Session / 两条 active binding。
      const sessionId = request.sessionId
        ?? (await this.#gateway.ensureSession({ settings })).sessionId
      await this.#ensureConversation(account.id, request.conversationId)
      if (active) await this.#deactivateSiblings(account.id, request.conversationId)
      const binding: ImBinding = {
        id: this.#newId('bind'),
        accountId: account.id,
        conversationId: request.conversationId,
        sessionId,
        active,
        settings,
      }
      await this.#store.putBinding(binding)
      return binding
    })
  }
  /** Remove one conversation binding; the account stays authorized. */
  async unbindBinding(bindingId: string): Promise<void> {
    if (this.#store.getBinding(bindingId) === undefined) {
      throw new ImError('IM_NOT_FOUND', `unknown binding: ${bindingId}`)
    }
    await this.#write(() => this.#store.deleteBinding(bindingId))
  }
  /** Replace fields of one binding's settings. */
  async settings(bindingId: string, patch: ImBindingSettings): Promise<ImBinding> {
    if ((patch.provider === undefined) !== (patch.model === undefined)) {
      throw new ImError('IM_INVALID_REQUEST', 'provider and model must be set together')
    }
    return this.#write(async () => {
      const binding = this.#requireBinding(bindingId)
      const settings: ImBindingSettings = { ...binding.settings }
      for (const key of ['presetId', 'provider', 'model', 'reasoning'] as const) {
        const value = patch[key]
        if (value !== undefined) settings[key] = value
      }
      const updated = { ...binding, settings }
      await this.#store.putBinding(updated)
      return updated
    })
  }
  /** Read accounts, bindings, or conversations. */
  async list(type?: 'accounts' | 'bindings' | 'conversations'): Promise<ImListResult> {
    if (type === 'bindings') return { bindings: this.#store.bindings() }
    if (type === 'conversations') return { conversations: this.#conversationViews() }
    if (type === 'accounts') return { accounts: await this.#accountViews() }
    return {
      accounts: await this.#accountViews(),
      bindings: this.#store.bindings(),
      conversations: this.#conversationViews(),
    }
  }
  /** The active binding for one conversation, when it exists. */
  activeBinding(accountId: string, conversationId: string): ImBinding | undefined {
    return this.#store.activeBinding(accountId, conversationId)
  }
  /** Read one account row. */
  account(accountId: string): ImAccountRow | undefined {
    return this.#store.getAccount(accountId)
  }
  /** Read one binding. */
  binding(bindingId: string): ImBinding | undefined {
    return this.#store.getBinding(bindingId)
  }
  /** Delete every row owned by one account. */
  removeAccountRows(accountId: string): Promise<void> {
    return this.#write(async () => {
      await this.#store.deleteBindingsOf(accountId)
      await this.#store.deleteConversationsOf(accountId)
      await this.#store.deleteAccount(accountId)
    })
  }
  /** Create an active binding for an inbound conversation. */
  createActiveBinding(accountId: string, conversationId: string, sessionId: string): Promise<ImBinding> {
    return this.#write(async () => {
      await this.#ensureConversation(accountId, conversationId)
      await this.#deactivateSiblings(accountId, conversationId)
      const binding: ImBinding = {
        id: this.#newId('bind'),
        accountId,
        conversationId,
        sessionId,
        active: true,
        settings: {},
      }
      await this.#store.putBinding(binding)
      return binding
    })
  }
  /** Persist one authorized account. */
  async #persistAccount(providerId: string, account: ImAccount): Promise<void> {
    const row: ImAccountRow = {
      id: account.id,
      provider: providerId,
      token_ref: imCredentialKey(account.id),
      ...(account.ownerId === undefined ? {} : { owner_id: account.ownerId }),
    }
    await this.#write(() => this.#store.putAccount(row))
  }
  /** Insert the conversation row when it is not known yet. */
  async #ensureConversation(accountId: string, conversationId: string): Promise<void> {
    if (this.#store.getConversation(accountId, conversationId) !== undefined) return
    await this.#store.putConversation({
      account_id: accountId,
      conversation_id: conversationId,
      kind: 'direct',
    })
  }
  /** Turn every other active binding for one conversation off. */
  async #deactivateSiblings(accountId: string, conversationId: string): Promise<void> {
    for (const binding of this.#store.bindings()) {
      if (binding.accountId !== accountId
        || binding.conversationId !== conversationId
        || !binding.active) continue
      await this.#store.putBinding({ ...binding, active: false })
    }
  }
  /** Resolve one account row or fail with IM_NOT_FOUND. */
  #requireAccount(accountId: string): ImAccountRow {
    const account = this.#store.getAccount(accountId)
    if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${accountId}`)
    return account
  }
  /** Resolve one binding or fail with IM_NOT_FOUND. */
  #requireBinding(bindingId: string): ImBinding {
    const binding = this.#store.getBinding(bindingId)
    if (binding === undefined) throw new ImError('IM_NOT_FOUND', `unknown binding: ${bindingId}`)
    return binding
  }
  /** Serialize every mutation so the active-pointer invariant cannot race. */
  #write<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.#writeChain.then(work)
    this.#writeChain = pending.catch(() => undefined)
    return pending
  }
  /** Merge live provider status into the durable account rows. */
  async #accountViews(): Promise<ImAccountView[]> {
    const live = new Map<string, ImAccount>()
    for (const provider of this.#registry.list()) {
      try {
        for (const account of await provider.service.accounts()) live.set(account.id, account)
      } catch (error: unknown) {
        this.#logger.warn(`[im:${provider.id}] accounts() failed: ${errorMessage(error)}`)
      }
    }
    return this.#store.accounts().map(row => {
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
  #conversationViews(): ImConversationView[] {
    return this.#store.conversations().map(row => ({
      accountId: row.account_id,
      id: row.conversation_id,
      kind: row.kind,
      ...(row.title === undefined ? {} : { title: row.title }),
    }))
  }
}
