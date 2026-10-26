/**
 * Active-binding routing and session hand-off. 活跃绑定路由与会话交接。
 *
 * This file keeps the public face: the `ImRouter` facade, its token, and the
 * unchanged re-export surface. By responsibility the module is split into
 * `router-types.ts` (configuration and person-send shapes), `router-prompt.ts`
 * (prompt rendering and content degradation), `router-inbound.ts` (serialized
 * inbound handling), and `router-send.ts` (outbound sends).
 *
 * 本文件保留公开门面：`ImRouter`、服务令牌与原样不变的再导出面。模块按职责拆为
 * `router-types.ts`（配置与按人发送形状）、`router-prompt.ts`（Prompt 渲染与内容降级）、
 * `router-inbound.ts`（串行入站处理）与 `router-send.ts`（出站发送）。
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
  ImPersonContact,
  ImProvider,
  ImRegistry,
  ImSendResult,
} from './contract.ts'
import { ImBindings } from './bindings.ts'
import { unbindAccount as removeAccount } from './router-accounts.ts'

import { ImStrangerIntake } from './intake.ts'
import type { ImIntakeSettle, ImIntakeStatusView } from './intake.ts'
import type { ImPeople } from './people.ts'
import type {
  ImPersonAddressFilter,
  ImPersonQuery,
  ImPersonResolution,
  ImPersonSaveRequest,
  ImPersonView,
} from './people-types.ts'
import { observePerson, RouterInbound } from './router-inbound.ts'
import { RouterSend } from './router-send.ts'
import type {
  ImPersonSaveInput,
  ImPersonSendRequest,
  ImPersonSendResult,
  ImRouterOptions,
  ImUnbindAccountResult,
} from './router-types.ts'
import type { ImBindPollResult, ImLinkRequest, ImListResult } from './bindings.ts'
import type {
  ImCredentialStore, ImLogger, ImRouterSendRequest,
} from './runtime-seams.ts'
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
export type {
  ImPersonRecipient, ImPersonSaveInput, ImPersonSendRequest, ImPersonSendResult,
  ImRouterConfig, ImRouterOptions, ImUnbindAccountResult,
} from './router-types.ts'

/** Router service token, consumed by @veren/im-tool. */
export const ImRouterToken = defineToken<ImRouter>('imRouter')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Active-binding router, provided by @veren/im. */
    imRouter: ImRouter
  }
}

/**
 * The directory-save request a router save maps onto, without its address;
 * undefined fields stay untouched, exactly as the caller left them.
 * 路由层保存请求映射成的目录保存请求，不含地址；未定义字段原样保持不动。
 */
function saveBaseOf(request: ImPersonSaveInput): ImPersonSaveRequest {
  return {
    ...(request.personId === undefined ? {} : { personId: request.personId }),
    ...(request.displayName === undefined ? {} : { displayName: request.displayName }),
    ...(request.realName === undefined ? {} : { realName: request.realName }),
    ...(request.aliases === undefined ? {} : { aliases: request.aliases }),
    ...(request.contacts === undefined ? {} : { contacts: request.contacts }),
    ...(request.bio === undefined ? {} : { bio: request.bio }),
    ...(request.notes === undefined ? {} : { notes: request.notes }),
    ...(request.clearClaim === undefined ? {} : { clearClaim: request.clearClaim }),
  }
}

/** Route inbound messages and expose the binding/tool operations. */
export class ImRouter {
  private readonly registry: ImRegistry
  private readonly credentials: ImCredentialStore
  private readonly logger: ImLogger
  private readonly bindings: ImBindings
  private readonly people: ImPeople
  private readonly intake: ImStrangerIntake
  private readonly inbound: RouterInbound
  private readonly sender: RouterSend
  /**
   * @param options - storage, registry, session gateway, credentials, people, and config.
   */
  constructor(options: ImRouterOptions) {
    this.registry = options.registry
    this.credentials = options.credentials
    this.logger = options.logger
    this.people = options.people
    this.bindings = new ImBindings(options)
    this.sender = new RouterSend({
      bindings: this.bindings,
      registry: this.registry,
      people: this.people,
    })
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
    this.inbound = new RouterInbound({
      bindings: this.bindings,
      gateway: options.gateway,
      registry: this.registry,
      people: this.people,
      intake: this.intake,
      logger: this.logger,
      config: options.config,
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
  /** Submit a verification code for a needs-code attempt, then poll. */
  submitBindCode(bindId: string, code: string): Promise<ImBindPollResult> {
    return this.bindings.submitBindCode(bindId, code)
  }
  /** Bind or re-bind one conversation to one Session. */
  async link(request: ImLinkRequest): Promise<ImBinding> {
    const binding = await this.bindings.link(request)
    await observePerson(this.bindings, this.people, this.logger, binding.accountId, binding.conversationId)
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
  /**
   * Resolve the person seen at one conversation address, for tools that know
   * the conversation but not the person id.
   * 解析某个会话地址上观察到的人，供只知道会话、不知道 personId 的工具使用。
   */
  personAt(accountId: string, conversationId: string): ImPersonView | undefined {
    const account = this.bindings.account(accountId)
    if (account === undefined) return undefined
    return this.people.viewAt(account.provider, accountId, conversationId)
  }
  /** Read one person by id, for tools that already hold a personId. */
  personById(personId: string): ImPersonView | undefined {
    return this.people.person(personId)
  }
  /**
   * Record one unverified self-report from the conversation model. The
   * provider comes from the account; the claim path never touches `realName`.
   * 记录会话模型带来的一条未核实自述。provider 取自账号；claim 路径绝不碰 realName。
   */
  async reportPersonClaim(personId: string, claim: {
    name?: string
    contacts?: ImPersonContact[]
    accountId: string
    conversationId: string
    messageId: string
  }): Promise<ImPersonView> {
    const account = this.bindings.account(claim.accountId)
    if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${claim.accountId}`)
    return this.people.recordClaim(personId, {
      ...(claim.name === undefined ? {} : { name: claim.name }),
      ...(claim.contacts === undefined ? {} : { contacts: claim.contacts }),
      provider: account.provider,
      accountId: claim.accountId,
      conversationId: claim.conversationId,
      messageId: claim.messageId,
    })
  }
  /** Settle one person's open intake question from the model's report. */
  settleIntake(personId: string, outcome: ImIntakeSettle, detail?: 'name' | 'contact' | 'both'): Promise<boolean> {
    return this.intake.settleByModel(personId, outcome, detail)
  }
  /** Create or enrich one person. An unknown account fails loudly. */
  async savePerson(request: ImPersonSaveInput): Promise<ImPersonView> {
    const base = saveBaseOf(request)
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
  /** Send to a person, resolving the name first; see `router-send.ts`. */
  sendToPerson(request: ImPersonSendRequest): Promise<ImPersonSendResult> {
    return this.sender.sendToPerson(request)
  }
  /** Remove one conversation binding. */
  unbindBinding(bindingId: string): Promise<void> {
    return this.bindings.unbindBinding(bindingId)
  }
  /** Remove an account, its runtime state, credential, and rows. */
  unbindAccount(accountId: string): Promise<ImUnbindAccountResult> {
    return removeAccount({
      bindings: this.bindings,
      registry: this.registry,
      credentials: this.credentials,
      people: this.people,
      logger: this.logger,
    }, accountId)
  }
  /**
   * Release runtime-only state — the remembered bind attempts; called on
   * plugin unload.
   * 释放仅运行期状态——已记住的 bind 尝试；插件卸载时调用。
   */
  dispose(): void {
    this.bindings.dispose()
  }
  /** Replace fields of one binding's settings. */
  settings(bindingId: string, patch: ImBindingSettings): Promise<ImBinding> {
    return this.bindings.settings(bindingId, patch)
  }
  /** Send one content block to an explicit target; see `router-send.ts`. */
  send(request: ImRouterSendRequest): Promise<ImSendResult> {
    return this.sender.send(request)
  }
  /** Read accounts, bindings, or conversations. */
  list(type?: 'accounts' | 'bindings' | 'conversations'): Promise<ImListResult> {
    return this.bindings.list(type)
  }
  /** Route one inbound message; see `router-inbound.ts`. */
  handle(providerId: string, message: ImMessage): Promise<void> {
    return this.inbound.handle(providerId, message)
  }
}
