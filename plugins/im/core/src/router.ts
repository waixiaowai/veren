/**
 * Active-binding routing and session hand-off. 活跃绑定路由与会话交接。
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
  ImPersonContact,
  ImProvider,
  ImRegistry,
  ImSendResult,
} from './contract.ts'
import { ImBindings } from './bindings.ts'
import { ImStrangerIntake } from './intake.ts'
import type { ImIntakeStatusView, ImStrangerIntakeConfig } from './intake.ts'
import type { ImPeople } from './people.ts'
import type {
  ImPersonAddressFilter,
  ImPersonAddressView,
  ImPersonIdentityStatus,
  ImPersonMatch,
  ImPersonMatchField,
  ImPersonQuery,
  ImPersonResolution,
  ImPersonSaveRequest,
  ImPersonView,
} from './people.ts'
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
  /**
   * Automatic stranger-intake question. Omitted means disabled: a router built
   * without this option sends no unsolicited question.
   * 自动陌生人询问。省略即关闭：未提供此选项的 router 不会主动发问。
   */
  strangerIntake?: ImStrangerIntakeConfig
}
/** Router construction options. */
export interface ImRouterOptions extends ImBindingsOptions {
  credentials: ImCredentialStore
  /** Durable, provider-neutral people directory. */
  people: ImPeople
  config: ImRouterConfig
  /** Clock for intake windows and rate limits; defaults to `Date.now`. */
  now?: () => number
}

/** One person-targeted send request; the target is a person, not an address. */
export interface ImPersonSendRequest {
  /** Person id, or any exact name, alias, contact, or address. */
  person: string
  /** Restrict reachable addresses to one provider, for example `wechat`. */
  provider?: string
  /** Restrict reachable addresses to one account. */
  accountId?: string
  content: ImMessageContent
  replyToMessageId?: string
}

/** The exact recipient a person-targeted send resolved to. */
export interface ImPersonRecipient {
  personId: string
  displayName: string
  matchedBy: ImPersonMatchField
  matchedValue: string
  /** Whether the matched name is verified, self-reported, or unverified. */
  identityStatus: ImPersonIdentityStatus
  /** Present when the person has a self-reported name. */
  claimedName?: string
  provider: string
  accountId: string
  conversationId: string
}

/** One person-targeted send result, including the evidence shown to the user. */
export interface ImPersonSendResult {
  result: ImSendResult
  recipient: ImPersonRecipient
}

/** One directory write; the account's provider fills in a missing provider. */
export interface ImPersonSaveInput {
  personId?: string
  address?: {
    accountId: string
    conversationId: string
    provider?: string
    externalId?: string
    displayName?: string
  }
  displayName?: string
  realName?: string
  aliases?: string[]
  contacts?: ImPersonContact[]
  bio?: string
  notes?: string
  /** Drop the unverified self-report; use after recording authoritative values. */
  clearClaim?: boolean
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
function renderPrompt(providerId: string, message: ImMessage, knownName?: string): string {
  const sender = knownName === undefined || knownName === message.sender.id
    ? message.sender.name ?? message.sender.id
    : `${knownName} (${message.sender.id})`
  return [
    '[Source]',
    `provider: ${providerId}`,
    `account: ${message.accountId}`,
    `conversation: ${message.conversationId}`,
    `sender: ${sender}`,
    `time: new Date(message.sentAt).toISOString()`,
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
/** Whether one resolved address still satisfies the caller's provider/account filter. */
function addressAccepted(address: ImPersonAddressView, filter: ImPersonAddressFilter): boolean {
  return (filter.provider === undefined || address.provider === filter.provider)
    && (filter.accountId === undefined || address.accountId === filter.accountId)
}

/** Route inbound messages and expose the binding/tool operations. */
export class ImRouter {
  private readonly registry: ImRegistry
  private readonly gateway: ImSessionGateway
  private readonly credentials: ImCredentialStore
  private readonly logger: ImLogger
  private readonly config: ImRouterConfig
  private readonly bindings: ImBindings
  private readonly people: ImPeople
  private readonly intake: ImStrangerIntake
  private readonly conversationChains = new Map<string, Promise<unknown>>()
  /**
   * @param options - storage, registry, session gateway, credentials, people, and config.
   */
  constructor(options: ImRouterOptions) {
    this.registry = options.registry
    this.gateway = options.gateway
    this.credentials = options.credentials
    this.logger = options.logger
    this.config = options.config
    this.people = options.people
    this.bindings = new ImBindings(options)
    this.intake = new ImStrangerIntake({
      people: options.people,
      logger: options.logger,
      // A router without an explicit intake section stays silent; only the
      // plugin (which owns the config surface) turns it on by default.
      // 未显式配置 intake 的 router 保持静默；只有拥有配置面的插件才默认开启。
      config: options.config.strangerIntake ?? { enabled: false },
      send: request => this.send({
        accountId: request.accountId,
        conversationId: request.conversationId,
        content: { type: 'text', text: request.text },
      }),
      ...(options.now === undefined ? {} : { now: options.now }),
    })
  }
  /** One registered provider, by id. */
  getProvider(id: string): ImProvider {
    return this.registry.get(id)
  }
  /** Resolve an optional provider id, defaulting only when exactly one exists. */
  resolveProvider(id?: string): ImProvider {
    if (id !== undefined) return this.registry.get(id)
    const providers = this.registry.list()
    const first = providers[0]
    if (providers.length === 1 && first !== undefined) return first
    if (providers.length === 0) {
      throw new ImError('IM_NOT_FOUND', 'no IM provider is registered')
    }
    throw new ImError('IM_INVALID_REQUEST', 'provider is required when more than one provider is registered')
  }
  /** Start one account authorization attempt. */
  beginBind(providerId: string, request: ImBindRequest): Promise<ImBindAttempt> {
    return this.bindings.beginBind(providerId, request)
  }
  /** Read one authorization attempt and persist the account once bound. */
  pollBind(bindId: string): Promise<ImBindPollResult> {
    return this.bindings.pollBind(bindId)
  }
  /** Bind or re-bind one conversation to one Session. */
  async link(request: ImLinkRequest): Promise<ImBinding> {
    const binding = await this.bindings.link(request)
    await this.observePerson(binding.accountId, binding.conversationId)
    return binding
  }
  /** List or search the people directory; never sends. */
  listPeople(request: ImPersonQuery = {}): ImPersonView[] {
    return this.people.list(request)
  }
  /** Resolve one name without sending; exposes ambiguity to the caller. */
  resolvePerson(query: string, filter: ImPersonAddressFilter = {}): ImPersonResolution {
    return this.people.resolve(query, filter)
  }
  /** The automatic-intake switch, counts, and recent audit records. */
  intakeStatus(limit?: number): ImIntakeStatusView {
    return this.intake.status(limit)
  }
  /** Create or enrich one person. An unknown account fails loudly. */
  async savePerson(request: ImPersonSaveInput): Promise<ImPersonView> {
    const base: ImPersonSaveRequest = {
      ...(request.personId === undefined ? {} : { personId: request.personId }),
      ...(request.displayName === undefined ? {} : { displayName: request.displayName }),
      ...(request.realName === undefined ? {} : { realName: request.realName }),
      ...(request.aliases === undefined ? {} : { aliases: request.aliases }),
      ...(request.contacts === undefined ? {} : { contacts: request.contacts }),
      ...(request.bio === undefined ? {} : { bio: request.bio }),
      ...(request.notes === undefined ? {} : { notes: request.notes }),
      ...(request.clearClaim === undefined ? {} : { clearClaim: request.clearClaim }),
    }
    const address = request.address
    if (address === undefined) return this.people.save(base)
    const account = this.bindings.account(address.accountId)
    if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${address.accountId}`)
    const provider = address.provider ?? account.provider
    if (provider !== account.provider) {
      throw new ImError(
        'IM_INVALID_REQUEST',
        `account ${address.accountId} belongs to ${account.provider}, not ${provider}`,
      )
    }
    return this.people.save({
      ...base,
      address: {
        provider,
        accountId: address.accountId,
        conversationId: address.conversationId,
        ...(address.externalId === undefined ? {} : { externalId: address.externalId }),
        ...(address.displayName === undefined ? {} : { displayName: address.displayName }),
      },
    })
  }
  /**
   * Send to a person, resolving the name first. Exactly one person and one
   * address are required; every other outcome refuses before any provider call.
   * 按人发送，先解析名字。必须恰好一个人、一个地址；其他结果都在调用 provider 前拒绝。
   */
  async sendToPerson(request: ImPersonSendRequest): Promise<ImPersonSendResult> {
    const filter: ImPersonAddressFilter = {
      ...(request.provider === undefined ? {} : { provider: request.provider }),
      ...(request.accountId === undefined ? {} : { accountId: request.accountId }),
    }
    if (request.provider !== undefined) this.registry.get(request.provider)
    if (request.accountId !== undefined) {
      const account = this.bindings.account(request.accountId)
      if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${request.accountId}`)
      if (request.provider !== undefined && account.provider !== request.provider) {
        throw new ImError(
          'IM_INVALID_REQUEST',
          `account ${request.accountId} belongs to ${account.provider}, not ${request.provider}`,
        )
      }
    }
    const match = this.matchOf(request.person, this.people.resolve(request.person, filter))
    // A query that named an address is pinned to that address. If the caller's
    // filter excludes it, refuse instead of silently sending to another address.
    // 查询点名了某个地址时就锁定该地址。若调用方的过滤条件排除了它，直接拒绝，绝不改发另一个地址。
    const addresses = match.address === undefined
      ? this.people.addressesOf(match.person.id, filter)
      : addressAccepted(match.address, filter) ? [match.address] : []
    if (addresses.length === 0) {
      throw new ImError('IM_NO_ADDRESS', `no reachable address for ${match.person.displayName}`, {
        details: {
          query: request.person,
          person: match.person,
          ...(request.provider === undefined ? {} : { provider: request.provider }),
          ...(request.accountId === undefined ? {} : { accountId: request.accountId }),
        },
      })
    }
    if (addresses.length > 1) {
      throw new ImError('IM_AMBIGUOUS', `${match.person.displayName} has more than one reachable address`, {
        details: {
          query: request.person,
          reason: 'address',
          person: match.person,
          addresses,
        },
      })
    }
    const address = addresses[0]!
    const result = await this.send({
      accountId: address.accountId,
      conversationId: address.conversationId,
      content: request.content,
      ...(request.replyToMessageId === undefined ? {} : { replyToMessageId: request.replyToMessageId }),
    })
    return {
      result,
      recipient: {
        personId: match.person.id,
        displayName: match.person.displayName,
        matchedBy: match.matchedBy,
        matchedValue: match.matchedValue,
        identityStatus: match.person.identityStatus,
        ...(match.person.claimedName === undefined ? {} : { claimedName: match.person.claimedName }),
        provider: address.provider,
        accountId: address.accountId,
        conversationId: address.conversationId,
      },
    }
  }
  /** Remove one conversation binding. */
  unbindBinding(bindingId: string): Promise<void> {
    return this.bindings.unbindBinding(bindingId)
  }
  /** Remove an account, its runtime state, credential, and rows. */
  async unbindAccount(accountId: string): Promise<ImUnbindAccountResult> {
    const account = this.bindings.account(accountId)
    if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${accountId}`)
    let provider: ImProvider | undefined
    let warning: string | undefined
    try {
      provider = this.registry.get(account.provider)
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
      await this.credentials.remove(accountId)
      await this.bindings.removeAccountRows(accountId)
      await this.clearPersonAddresses(accountId)
      try {
        await provider.service.start()
      } catch (error: unknown) {
        throw new ImError('IM_INTERNAL', `account removed but the provider did not restart: ${errorMessage(error)}`)
      }
      return { removed: true, revoked: false, ...(warning === undefined ? {} : { warning }) }
    }
    await this.credentials.remove(accountId)
    await this.bindings.removeAccountRows(accountId)
    await this.clearPersonAddresses(accountId)
    return { removed: true, revoked: false, ...(warning === undefined ? {} : { warning }) }
  }
  /** Replace fields of one binding's settings. */
  settings(bindingId: string, patch: ImBindingSettings): Promise<ImBinding> {
    return this.bindings.settings(bindingId, patch)
  }
  /** Send one content block to an explicit target. */
  async send(request: ImRouterSendRequest): Promise<ImSendResult> {
    const target = this.targetOf(request)
    const account = this.bindings.account(target.accountId)
    if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${target.accountId}`)
    const provider = this.registry.get(account.provider)
    const content = degradeContent(provider.features, request.content)
    return provider.service.send({
      target,
      content,
      ...(request.replyToMessageId === undefined ? {} : { replyToMessageId: request.replyToMessageId }),
    })
  }
  /** Read accounts, bindings, or conversations. */
  list(type?: 'accounts' | 'bindings' | 'conversations'): Promise<ImListResult> {
    return this.bindings.list(type)
  }
  /**
   * Route one inbound message. Messages from one conversation run in order.
   * @param providerId - provider that emitted the message.
   * @param message - normalized inbound message.
   */
  handle(providerId: string, message: ImMessage): Promise<void> {
    const key = `${providerId}\u0000${message.accountId}\u0000${message.conversationId}`
    return this.serialize(key, async () => {
      // Directory bookkeeping must never drop a message: a storage failure is
      // reported, then routing proceeds.
      // 目录记账绝不能丢消息：存储失败只记日志，路由继续。
      let person: ImPersonView | undefined
      try {
        person = await this.people.observeMessage(providerId, message)
      } catch (error: unknown) {
        this.logger.error(
          `[im:${providerId}] inbound sender could not be recorded in the people directory: ${errorMessage(error)}`,
        )
      }
      // Intake runs before routing and owns its own failure containment: the
      // fixed question is not an agent turn.
      // 采集在路由之前运行，并自行收敛失败：固定询问不是 agent turn。
      await this.intake.handle(providerId, message, person)
      return this.route(providerId, message)
    })
  }
  /** Resolve a send target from the exactly-one target form. */
  private targetOf(request: ImRouterSendRequest): { accountId: string; conversationId: string } {
    const hasBinding = request.bindingId !== undefined
    const hasPair = request.accountId !== undefined || request.conversationId !== undefined
    if (hasBinding === hasPair) {
      throw new ImError('IM_INVALID_REQUEST', 'specify bindingId or accountId + conversationId, exactly one')
    }
    const bindingId = request.bindingId
    if (bindingId !== undefined) {
      const binding = this.bindings.binding(bindingId)
      if (binding === undefined) throw new ImError('IM_NOT_FOUND', `unknown binding: ${bindingId}`)
      return { accountId: binding.accountId, conversationId: binding.conversationId }
    }
    if (request.accountId === undefined || request.conversationId === undefined) {
      throw new ImError('IM_INVALID_REQUEST', 'accountId and conversationId are both required')
    }
    return { accountId: request.accountId, conversationId: request.conversationId }
  }
  /** Resolve a binding, auto-create one, ask the Session, and reply to the source. */
  private async route(providerId: string, message: ImMessage): Promise<void> {
    try {
      let binding = this.bindings.activeBinding(message.accountId, message.conversationId)
      if (binding === undefined) {
        if (!this.config.autoCreateSession) {
          this.logger.warn(
            `[im:${providerId}] no active binding for ${message.accountId}/${message.conversationId}; message ignored`,
          )
          return
        }
        const { sessionId } = await this.gateway.ensureSession({ settings: {} })
        binding = await this.bindings.createActiveBinding(message.accountId, message.conversationId, sessionId)
        this.logger.info?.(
          `[im:${providerId}] auto-created session ${sessionId} for ${message.accountId}/${message.conversationId}`,
        )
      }
      const answer = await this.gateway.ask({
        sessionId: binding.sessionId,
        prompt: renderPrompt(providerId, message, this.knownSenderName(providerId, message)),
        source: {
          providerId,
          accountId: message.accountId,
          conversationId: message.conversationId,
          messageId: message.id,
        },
      })
      if (answer === undefined || answer.trim() === '') return
      const provider = this.registry.get(providerId)
      await provider.service.send({
        target: { accountId: message.accountId, conversationId: message.conversationId },
        content: { type: 'text', text: answer },
        replyToMessageId: message.id,
      })
    } catch (error: unknown) {
      this.logger.error(`[im:${providerId}] inbound handling failed: ${errorMessage(error)}`)
    }
  }
  /** Turn a resolution into one match or a refusal carrying its evidence. */
  private matchOf(query: string, resolution: ImPersonResolution): ImPersonMatch {
    if (resolution.status === 'matched') return resolution.match
    if (resolution.status === 'ambiguous') {
      throw new ImError('IM_AMBIGUOUS', `more than one person matches "${query}"`, {
        details: { query, status: 'ambiguous', candidates: resolution.candidates },
      })
    }
    throw new ImError('IM_NOT_FOUND', `no person matches "${query}"`, {
      details: { query, status: 'not-found', suggestions: resolution.suggestions },
    })
  }
  /** Record one conversation's address under its account's provider. */
  private async observePerson(accountId: string, conversationId: string): Promise<void> {
    const account = this.bindings.account(accountId)
    if (account === undefined) return
    try {
      await this.people.observeConversation({
        provider: account.provider,
        accountId,
        conversationId,
      })
    } catch (error: unknown) {
      this.logger.warn(
        `[im:people] ${accountId}/${conversationId} could not be recorded: ${errorMessage(error)}`,
      )
    }
  }
  /** Remove one account's addresses; profiles and names stay for a later rebind. */
  private async clearPersonAddresses(accountId: string): Promise<void> {
    try {
      await this.people.removeAddressesOf(accountId)
    } catch (error: unknown) {
      this.logger.warn(`[im:people] addresses of ${accountId} were not removed: ${errorMessage(error)}`)
    }
  }
  /** The known sender label, marking a self-reported name as unverified. */
  private knownSenderName(providerId: string, message: ImMessage): string | undefined {
    try {
      const person = this.people.viewAt(providerId, message.accountId, message.conversationId)
      if (person === undefined) return undefined
      if (person.identityStatus === 'self-reported' && person.claimedName !== undefined
        && person.displayName === message.sender.id) {
        return `${person.claimedName}（自称）`
      }
      return person.displayName
    } catch (error: unknown) {
      this.logger.warn(`[im:people] sender lookup failed: ${errorMessage(error)}`)
      return undefined
    }
  }
  /** Serialize one conversation's inbound processing. */
  private serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.conversationChains.get(key) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tail = next.catch(() => undefined)
    this.conversationChains.set(key, tail)
    return next.finally(() => {
      if (this.conversationChains.get(key) === tail) this.conversationChains.delete(key)
    })
  }
}
