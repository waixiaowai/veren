/**
 * Provider-neutral IM contract and registry.
 * Providers implement ImService and register one ImProvider; the host routes
 * through ImRegistry, never a channel singleton.
 *
 * This file keeps the error class, the provider behavior contract, the
 * credential key, and the registry; the pure data model (accounts,
 * conversations, contacts, claims, messages) lives in `contract-model.ts` and
 * is re-exported unchanged here.
 *
 * 渠道无关的 IM 契约与注册表：provider 实现 ImService 并注册一个 ImProvider；宿主只通过
 * ImRegistry 路由，不依赖渠道单例。
 *
 * 本文件保留错误类、provider 行为契约、凭据键与注册表；纯数据模型（账号、会话、联系方式、
 * 自述、消息）在 `contract-model.ts`，并在此原样再导出。
 *
 * @module @veren/im/contract
 */

import { createHash } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context, Disposable } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { defineToken } from '@veren/core'

// ---- data model: declared in contract-model.ts, re-exported unchanged ----
// ---- 数据模型：声明在 contract-model.ts，原样再导出 ----
export type {
  ImAccount,
  ImAccountView,
  ImConversation,
  ImConversationView,
  ImMessage,
  ImMessageContent,
  ImPersonClaim,
  ImPersonContact,
  ImUser,
} from './contract-model.ts'
import type {
  ImAccount,
  ImMessage,
  ImMessageContent,
} from './contract-model.ts'

/** Stable error codes a provider or the router may refuse with. */
export type ImErrorCode =
  | 'IM_INVALID_REQUEST'
  | 'IM_UNSUPPORTED'
  | 'IM_AUTH_REQUIRED'
  | 'IM_BIND_PENDING'
  | 'IM_BIND_EXPIRED'
  | 'IM_NOT_FOUND'
  | 'IM_AMBIGUOUS'
  | 'IM_NO_ADDRESS'
  | 'IM_SEND_REJECTED'
  | 'IM_RATE_LIMITED'
  | 'IM_DELIVERY_UNCERTAIN'
  | 'IM_INTERNAL'

/** One structured IM failure; callers branch on `code` only. */
export class ImError extends Error {
  /** Stable machine-readable reason. */
  readonly code: ImErrorCode
  /** Provider-native code, when the provider has one. */
  readonly providerCode?: string
  /** JSON-safe machine-readable fields (candidates, suggestions, and so on). */
  readonly details?: Readonly<Record<string, unknown>>

  /**
   * @param code - stable machine-readable reason.
   * @param message - human-readable account of the failure.
   * @param options - optional cause, provider-native code, and structured details.
   */
  constructor(
    code: ImErrorCode,
    message: string,
    options: { cause?: unknown; providerCode?: string; details?: Record<string, unknown> } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'ImError'
    this.code = code
    if (options.providerCode !== undefined) this.providerCode = options.providerCode
    if (options.details !== undefined) this.details = options.details
  }
}

/** Capabilities a provider declares statically. */
export interface ImFeatures {
  direct: boolean
  group: boolean
  threads: boolean
  markdown: boolean
  media: { image: boolean; file: boolean }
  typing: boolean
  auth: ReadonlyArray<'qrcode' | 'oauth' | 'token' | 'password'>
  limits: { textChars?: number; fileBytes?: number }
}

/** How one account authorization starts. */
export type ImBindRequest =
  | { method: 'qrcode'; label?: string }
  | { method: 'oauth'; label?: string }
  | { method: 'token'; token: string; label?: string }
  | { method: 'password'; username: string; password: string; label?: string }

/** Human-facing challenge produced by an authorization attempt. */
export interface ImBindChallenge {
  kind: 'qrcode' | 'device-code' | 'url'
  /** Remote challenge URL; never exposed through a tool result or a log. */
  url?: string
  /** Local PNG path for a QR challenge; safe to return to the caller. */
  imagePath?: string
  userCode?: string
  expiresAt?: number
}

/** One authorization attempt's state. */
export type ImBindStatus = 'pending' | 'scanned' | 'needs-code' | 'bound' | 'expired' | 'failed'

/** A live authorization attempt; the provider advances it in the background. */
export interface ImBindAttempt {
  bindId: string
  readonly status: ImBindStatus
  challenge?: ImBindChallenge
  submitCode?(code: string): Promise<void>
  wait(signal?: AbortSignal): Promise<ImAccount>
  cancel(): Promise<void>
}

/** One explicit outbound destination. */
export interface ImSendTarget {
  accountId: string
  conversationId: string
}

/** One send request; `target` is always explicit. */
export interface ImSendRequest {
  target: ImSendTarget
  content: ImMessageContent
  replyToMessageId?: string
}

/** One send result. */
export interface ImSendResult {
  id: string
  sentAt: number
  /** True when the message may have been delivered. */
  uncertain?: boolean
}

/** Per-binding agent settings. */
export interface ImBindingSettings {
  presetId?: string
  provider?: string
  model?: string
  reasoning?: string
}

/** One conversation-to-session binding. */
export interface ImBinding {
  id: string
  accountId: string
  conversationId: string
  sessionId: string
  active: boolean
  settings: ImBindingSettings
}

/**
 * The behavior every provider implements.
 *
 * Identity and capabilities live on `ImProvider`; this interface intentionally
 * carries only the six operations the router and tools need.
 */
export interface ImService {
  start(): Promise<void>
  stop(): Promise<void>
  accounts(): Promise<ImAccount[]>
  listen(
    handler: (message: ImMessage) => void | Promise<void>,
    signal?: AbortSignal,
  ): () => void
  bind(request: ImBindRequest): Promise<ImBindAttempt>
  send(request: ImSendRequest): Promise<ImSendResult>
  /**
   * Remove one account's runtime state and local files. Optional: providers
   * without it fall back to a full runtime stop/restart around account removal.
   * 删除单账号的运行时状态与本地文件。可选：未实现的 provider 退回整体 stop/restart。
   */
  removeAccount?(accountId: string): Promise<void>
}

/** Registration descriptor: provider identity, capabilities, and behavior. */
export interface ImProvider {
  id: string
  displayName: string
  features: ImFeatures
  service: ImService
}

/** Callback the registry uses to hand an inbound message to the router. */
export type ImMessageHandler = (providerId: string, message: ImMessage) => void | Promise<void>

/** The `im` service token. */
export const ImToken = defineToken<ImRegistry>('im')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provider-neutral IM registry. */
    im: ImRegistry
  }
}

/**
 * Derive the one credential key an account's secrets live under.
 *
 * The account id is hashed so ids with punctuation still satisfy the credential
 * key grammar, and so the same account always reaches the same record.
 *
 * @param accountId - provider-scoped account id.
 * @returns `im/<sha256-prefix>`.
 */
export function imCredentialKey(accountId: string): CredentialKey {
  const digest = createHash('sha256').update(accountId).digest('hex').slice(0, 32)
  // The digest is hex, so it may start with a digit; the key grammar requires a
  // leading letter, hence the stable `k` prefix.
  // 摘要是十六进制，可能以数字开头；键语法要求首字符为字母，因此加稳定的 `k` 前缀。
  return credentialKey('im', `k${digest}`)
}

/**
 * Registry of provider descriptors.
 *
 * `register` also subscribes the provider's inbound listener to the router; the
 * returned disposer removes the provider and unsubscribes in one step.
 */
export class ImRegistry extends Service {
  static provide = ImToken
  private readonly providers = new Map<string, { provider: ImProvider; unlisten: () => void }>()
  /**
   * @param ctx - owning Cordis context.
   * @param onMessage - router callback receiving every inbound message.
   * @param onRegistered - fired after a provider joins; the startup
   *   reconciliation of account rows keys off this moment.
   */
  constructor(
    ctx: Context,
    private readonly onMessage: ImMessageHandler,
    private readonly onRegistered?: (provider: ImProvider) => void,
  ) {
    super(ctx, ImToken)
  }
  /**
   * Register one provider and subscribe its listener.
   * @param provider - identity, capabilities, and service.
   * @returns the disposer that removes the provider and its listener.
   */
  register(provider: ImProvider): Disposable {
    if (this.providers.has(provider.id)) {
      throw new ImError('IM_INVALID_REQUEST', `provider already registered: ${provider.id}`)
    }
    const unlisten = provider.service.listen(message => this.onMessage(provider.id, message))
    this.providers.set(provider.id, { provider, unlisten })
    // 注册即对账触发点：provider 就绪的瞬间补上启动自愈的最后一块拼图。
    // Registration doubles as the reconciliation trigger: a provider becoming
    // ready completes the startup self-heal.
    this.onRegistered?.(provider)
    return () => {
      const entry = this.providers.get(provider.id)
      if (entry === undefined) return
      this.providers.delete(provider.id)
      entry.unlisten()
    }
  }
  /**
   * Read one provider.
   * @param id - provider id.
   * @returns the registered descriptor.
   * @throws ImError `IM_NOT_FOUND` when no provider has that id.
   */
  get(id: string): ImProvider {
    const entry = this.providers.get(id)
    if (entry === undefined) throw new ImError('IM_NOT_FOUND', `unknown provider: ${id}`)
    return entry.provider
  }
  /**
   * List every registered provider in registration order.
   * @returns a fresh array of descriptors.
   */
  list(): ImProvider[] {
    return [...this.providers.values()].map(entry => entry.provider)
  }
}
