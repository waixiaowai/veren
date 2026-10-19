/**
 * Active-binding routing and session hand-off.
 *
 * Inbound messages resolve through the active binding of their conversation;
 * source metadata and body are rendered as separate sections, and the answer
 * returns to the exact conversation that produced the turn.
 *
 * 活跃绑定路由与会话交接：入站消息按会话的 active binding 解析，来源元数据与正文分区渲染，
 * 答案回送到产生本次 turn 的会话。
 *
 * @module @veren/im/router
 */

import { defineToken } from '@veren/core'
import { ImError } from './contract.ts'
import type {
  ImBinding,
  ImBindingSettings,
  ImBindAttempt,
  ImBindRequest,
  ImMessage,
  ImMessageContent,
  ImProvider,
  ImRegistry,
  ImSendResult,
} from './contract.ts'
import { ImBindings } from './bindings.ts'
import type {
  ImBindingsOptions,
  ImBindPollResult,
  ImCredentialStore,
  ImLinkRequest,
  ImListResult,
  ImLogger,
  ImRouterSendRequest,
  ImSessionGateway,
} from './bindings.ts'

export { ImBindings } from './bindings.ts'
export type {
  ImBindPollResult,
  ImCredentialStore,
  ImLinkRequest,
  ImListResult,
  ImLogger,
  ImPromptSource,
  ImRouterSendRequest,
  ImSessionGateway,
} from './bindings.ts'

/** One account removal result. */
export interface ImUnbindAccountResult {
  removed: boolean
  revoked: boolean
  warning?: string
}
/** Router configuration. */
export interface ImRouterConfig {
  /** Create a Session and an active binding when an inbound conversation has none. */
  autoCreateSession: boolean
}
/** Router construction options. */
export interface ImRouterOptions extends ImBindingsOptions {
  credentials: ImCredentialStore
  config: ImRouterConfig
}
/** Router service token, consumed by @veren/im-tool. */
export const ImRouterToken = defineToken<ImRouter>('imRouter')

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Active-binding router, provided by @veren/im. */
    imRouter: ImRouter
  }
}
/** Turn renderer: source section first, message body second. */
function renderPrompt(providerId: string, message: ImMessage): string {
  const sender = message.sender.name ?? message.sender.id
  return [
    '[Source]',
    `provider: ${providerId}`,
    `account: ${message.accountId}`,
    `conversation: ${message.conversationId}`,
    `sender: ${sender}`,
    `time: ${new Date(message.sentAt).toISOString()}`,
    '',
    '[Message]',
    contentToPrompt(message.content),
  ].join('\n')
}
/** Render one content block for the model without mixing in source metadata. */
function contentToPrompt(content: ImMessageContent): string {
  switch (content.type) {
    case 'text':
    case 'markdown':
      return content.text
    case 'image':
      return `[image: ${content.name ?? content.mime}]`
    case 'file':
      return `[file: ${content.name}]`
  }
}
/** Turn an unknown value into one log line. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
/** Downgrade or reject content the provider cannot carry. */
function degradeContent(features: ImProvider['features'], content: ImMessageContent): ImMessageContent {
  switch (content.type) {
    case 'markdown':
      return features.markdown ? content : { type: 'text', text: content.text }
    case 'image':
      if (!features.media.image) throw new ImError('IM_UNSUPPORTED', 'this provider cannot send images')
      return content
    case 'file':
      if (!features.media.file) throw new ImError('IM_UNSUPPORTED', 'this provider cannot send files')
      if (features.limits.fileBytes !== undefined
        && content.size !== undefined
        && content.size > features.limits.fileBytes) {
        throw new ImError('IM_INVALID_REQUEST', 'the file exceeds the provider limit')
      }
      return content
    case 'text':
      return content
  }
}
/** Route inbound messages and expose the binding/tool operations. */
export class ImRouter {
  readonly #registry: ImRegistry
  readonly #gateway: ImSessionGateway
  readonly #credentials: ImCredentialStore
  readonly #logger: ImLogger
  readonly #config: ImRouterConfig
  readonly #bindings: ImBindings
  readonly #conversationChains = new Map<string, Promise<unknown>>()

  /**
   * @param options - storage, registry, session gateway, credentials, and config.
   */
  constructor(options: ImRouterOptions) {
    this.#registry = options.registry
    this.#gateway = options.gateway
    this.#credentials = options.credentials
    this.#logger = options.logger
    this.#config = options.config
    this.#bindings = new ImBindings(options)
  }
  /** One registered provider, by id. */
  getProvider(id: string): ImProvider {
    return this.#registry.get(id)
  }
  /** Resolve an optional provider id, defaulting only when exactly one exists. */
  resolveProvider(id?: string): ImProvider {
    if (id !== undefined) return this.#registry.get(id)
    const providers = this.#registry.list()
    const first = providers[0]
    if (providers.length === 1 && first !== undefined) return first
    if (providers.length === 0) {
      throw new ImError('IM_NOT_FOUND', 'no IM provider is registered')
    }
    throw new ImError('IM_INVALID_REQUEST', 'provider is required when more than one provider is registered')
  }
  /** Start one account authorization attempt. */
  beginBind(providerId: string, request: ImBindRequest): Promise<ImBindAttempt> {
    return this.#bindings.beginBind(providerId, request)
  }
  /** Read one authorization attempt and persist the account once bound. */
  pollBind(bindId: string): Promise<ImBindPollResult> {
    return this.#bindings.pollBind(bindId)
  }
  /** Bind or re-bind one conversation to one Session. */
  link(request: ImLinkRequest): Promise<ImBinding> {
    return this.#bindings.link(request)
  }
  /** Remove one conversation binding. */
  unbindBinding(bindingId: string): Promise<void> {
    return this.#bindings.unbindBinding(bindingId)
  }
  /** Remove an account, its runtime state, credential, and rows. */
  async unbindAccount(accountId: string): Promise<ImUnbindAccountResult> {
    const account = this.#bindings.account(accountId)
    if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${accountId}`)
    let provider: ImProvider | undefined
    let warning: string | undefined
    try {
      provider = this.#registry.get(account.provider)
    } catch {
      warning = 'the provider is not registered, so the remote grant could not be revoked'
    }
    if (provider?.service.removeAccount !== undefined) {
      // Preferred path: only this account's runtime and files are touched.
      // 首选路径：只触碰该账号的运行时与本地文件，其他账号不受影响。
      try {
        await provider.service.removeAccount(accountId)
      } catch (error: unknown) {
        throw new ImError('IM_INTERNAL', `the provider could not remove the account: ${errorMessage(error)}`)
      }
    } else if (provider !== undefined) {
      // Legacy fallback: a full runtime stop/restart around the removal.
      // 兼容回退：删除前后整体 stop/restart 一次。
      try {
        await provider.service.stop()
      } catch (error: unknown) {
        warning = `the provider runtime did not stop cleanly: ${errorMessage(error)}`
      }
      await this.#credentials.remove(accountId)
      await this.#bindings.removeAccountRows(accountId)
      try {
        await provider.service.start()
      } catch (error: unknown) {
        throw new ImError('IM_INTERNAL', `account removed but the provider did not restart: ${errorMessage(error)}`)
      }
      return { removed: true, revoked: false, ...(warning === undefined ? {} : { warning }) }
    }
    await this.#credentials.remove(accountId)
    await this.#bindings.removeAccountRows(accountId)
    return { removed: true, revoked: false, ...(warning === undefined ? {} : { warning }) }
  }
  /** Replace fields of one binding's settings. */
  settings(bindingId: string, patch: ImBindingSettings): Promise<ImBinding> {
    return this.#bindings.settings(bindingId, patch)
  }
  /** Send one content block to an explicit target. */
  async send(request: ImRouterSendRequest): Promise<ImSendResult> {
    const target = this.#targetOf(request)
    const account = this.#bindings.account(target.accountId)
    if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${target.accountId}`)
    const provider = this.#registry.get(account.provider)
    const content = degradeContent(provider.features, request.content)
    return provider.service.send({
      target,
      content,
      ...(request.replyToMessageId === undefined ? {} : { replyToMessageId: request.replyToMessageId }),
    })
  }
  /** Read accounts, bindings, or conversations. */
  list(type?: 'accounts' | 'bindings' | 'conversations'): Promise<ImListResult> {
    return this.#bindings.list(type)
  }
  /**
   * Route one inbound message. Messages from one conversation run in order.
   * @param providerId - provider that emitted the message.
   * @param message - normalized inbound message.
   */
  handle(providerId: string, message: ImMessage): Promise<void> {
    const key = `${providerId}\u0000${message.accountId}\u0000${message.conversationId}`
    return this.#serialize(key, () => this.#route(providerId, message))
  }
  /** Resolve a send target from the exactly-one target form. */
  #targetOf(request: ImRouterSendRequest): { accountId: string; conversationId: string } {
    const hasBinding = request.bindingId !== undefined
    const hasPair = request.accountId !== undefined || request.conversationId !== undefined
    if (hasBinding === hasPair) {
      throw new ImError('IM_INVALID_REQUEST', 'specify bindingId or accountId + conversationId, exactly one')
    }
    const bindingId = request.bindingId
    if (bindingId !== undefined) {
      const binding = this.#bindings.binding(bindingId)
      if (binding === undefined) throw new ImError('IM_NOT_FOUND', `unknown binding: ${bindingId}`)
      return { accountId: binding.accountId, conversationId: binding.conversationId }
    }
    if (request.accountId === undefined || request.conversationId === undefined) {
      throw new ImError('IM_INVALID_REQUEST', 'accountId and conversationId are both required')
    }
    return { accountId: request.accountId, conversationId: request.conversationId }
  }
  /** Resolve a binding, auto-create one, ask the Session, and reply to the source. */
  async #route(providerId: string, message: ImMessage): Promise<void> {
    try {
      let binding = this.#bindings.activeBinding(message.accountId, message.conversationId)
      if (binding === undefined) {
        if (!this.#config.autoCreateSession) {
          this.#logger.warn(
            `[im:${providerId}] no active binding for ${message.accountId}/${message.conversationId}; message ignored`,
          )
          return
        }
        const { sessionId } = await this.#gateway.ensureSession({ settings: {} })
        binding = await this.#bindings.createActiveBinding(message.accountId, message.conversationId, sessionId)
        this.#logger.info?.(
          `[im:${providerId}] auto-created session ${sessionId} for ${message.accountId}/${message.conversationId}`,
        )
      }
      const answer = await this.#gateway.ask({
        sessionId: binding.sessionId,
        prompt: renderPrompt(providerId, message),
        source: {
          providerId,
          accountId: message.accountId,
          conversationId: message.conversationId,
          messageId: message.id,
        },
      })
      if (answer === undefined || answer.trim() === '') return
      const provider = this.#registry.get(providerId)
      await provider.service.send({
        target: { accountId: message.accountId, conversationId: message.conversationId },
        content: { type: 'text', text: answer },
        replyToMessageId: message.id,
      })
    } catch (error: unknown) {
      this.#logger.error(`[im:${providerId}] inbound handling failed: ${errorMessage(error)}`)
    }
  }
  /** Serialize one conversation's inbound processing. */
  #serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#conversationChains.get(key) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tail = next.catch(() => undefined)
    this.#conversationChains.set(key, tail)
    return next.finally(() => {
      if (this.#conversationChains.get(key) === tail) this.#conversationChains.delete(key)
    })
  }
}
