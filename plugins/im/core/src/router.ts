/**
 * Message routing and session hand-off over the durable queue. 持久化队列上的消息路由与会话交接。
 *
 * This file keeps the public face: the `ImRouter` facade, its token, and the
 * unchanged re-export surface. By responsibility the module is split into
 * `router-types.ts` (configuration and person-send shapes), `router-prompt.ts`
 * (prompt rendering and content degradation), `router-inbound.ts` (serialized
 * inbound handling), `router-people.ts` (the directory face), `router-accounts.ts`
 * (account removal), and `router-send.ts` (outbound sends).
 *
 * 本文件保留公开门面：`ImRouter`、服务令牌与原样不变的再导出面。模块按职责拆为
 * `router-types.ts`（配置与按人发送形状）、`router-prompt.ts`（Prompt 渲染与内容降级）、
 * `router-inbound.ts`（串行入站处理）、`router-people.ts`（目录面）、`router-accounts.ts`
 * （账号删除）与 `router-send.ts`（出站发送）。
 *
 * @module @veren/im/router
 */
import { defineToken } from '@veren/core'
import { ImError } from './contract.ts'
import type {
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
  ImPersonView,
} from './people-types.ts'
import { RouterInbound } from './router-inbound.ts'
import { RouterPeople } from './router-people.ts'
import { ImMessageQueue } from './queue.ts'
import { RouterSend } from './router-send.ts'
import type {
  ImPersonSaveInput,
  ImPersonSendRequest,
  ImPersonSendResult,
  ImRouterOptions,
  ImUnbindAccountResult,
} from './router-types.ts'
import type { ImBindPollResult } from './bindings.ts'
import type { ImListResult } from './router-types.ts'
import type { ImMessageRow } from './store.ts'
import type {
  ImCredentialStore, ImLogger, ImRouterSendRequest,
} from './runtime-seams.ts'
export { ImBindings } from './bindings.ts'
export { ImMessageQueue } from './queue.ts'
export type {
  ImBindPollResult,
  ImCredentialStore,
  ImLogger,
  ImPromptSource,
  ImRouterSendRequest,
  ImSessionGateway,
} from './bindings.ts'
export type {
  ImListResult,
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

/** Route inbound messages through the durable queue and expose the tool operations. */
export class ImRouter {
  private readonly registry: ImRegistry
  private readonly credentials: ImCredentialStore
  private readonly logger: ImLogger
  private readonly bindings: ImBindings
  private readonly people: ImPeople
  private readonly intake: ImStrangerIntake
  private readonly queue: ImMessageQueue
  private readonly inbound: RouterInbound
  private readonly sender: RouterSend
  private readonly directory: RouterPeople
  /**
   * Build the stranger-intake engine over this router's own send path.
   * 基于本 router 自己的发送路径构建陌生人采集引擎。
   */
  private buildIntake(options: ImRouterOptions): ImStrangerIntake {
    return new ImStrangerIntake({
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

  /**
   * @param options - storage, registry, session gateway, credentials, people, and config.
   */
  constructor(options: ImRouterOptions) {
    this.registry = options.registry
    this.credentials = options.credentials
    this.logger = options.logger
    this.people = options.people
    this.bindings = new ImBindings(options)
    this.queue = new ImMessageQueue({ store: options.store, ...(options.now === undefined ? {} : { now: options.now }) })
    this.sender = new RouterSend({
      bindings: this.bindings,
      registry: this.registry,
      people: this.people,
    })
    this.directory = new RouterPeople({
      bindings: this.bindings,
      people: this.people,
    })
    this.intake = this.buildIntake(options)
    this.inbound = new RouterInbound({
      gateway: options.gateway,
      registry: this.registry,
      people: this.people,
      intake: this.intake,
      queue: this.queue,
      logger: this.logger,
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
  /** List or search the people directory; never sends. See `router-people.ts`. */
  listPeople(request: ImPersonQuery = {}): ImPersonView[] {
    return this.directory.list(request)
  }
  /** Resolve one name without sending; exposes ambiguity to the caller. */
  resolvePerson(query: string, filter: ImPersonAddressFilter = {}): ImPersonResolution {
    return this.directory.resolve(query, filter)
  }
  /** The automatic-intake switch, counts, and recent audit records. */
  intakeStatus(limit?: number): ImIntakeStatusView {
    return this.intake.status(limit)
  }
  /**
   * Resolve the person seen at one conversation address, for tools that know
   * the conversation but not the person id. See `router-people.ts`.
   * 解析某个会话地址上观察到的人，供只知道会话、不知道 personId 的工具使用。
   */
  personAt(accountId: string, conversationId: string): ImPersonView | undefined {
    return this.directory.personAt(accountId, conversationId)
  }
  /** Read one person by id, for tools that already hold a personId. */
  personById(personId: string): ImPersonView | undefined {
    return this.directory.personById(personId)
  }
  /**
   * Record one unverified self-report from the conversation model. The
   * provider comes from the account; the claim path never touches `realName`.
   * 记录会话模型带来的一条未核实自述。provider 取自账号；claim 路径绝不碰 realName。
   */
  reportPersonClaim(personId: string, claim: {
    name?: string
    contacts?: ImPersonContact[]
    accountId: string
    conversationId: string
    messageId: string
  }): Promise<ImPersonView> {
    return this.directory.reportClaim(personId, claim)
  }
  /** Settle one person's open intake question from the model's report. */
  settleIntake(personId: string, outcome: ImIntakeSettle, detail?: 'name' | 'contact' | 'both'): Promise<boolean> {
    return this.intake.settleByModel(personId, outcome, detail)
  }
  /** Create or enrich one person. An unknown account fails loudly. See `router-people.ts`. */
  savePerson(request: ImPersonSaveInput): Promise<ImPersonView> {
    return this.directory.save(request)
  }
  /** Send to a person, resolving the name first; see `router-send.ts`. */
  sendToPerson(request: ImPersonSendRequest): Promise<ImPersonSendResult> {
    return this.sender.sendToPerson(request)
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
  /** Send one content block to an explicit target; see `router-send.ts`. */
  send(request: ImRouterSendRequest): Promise<ImSendResult> {
    return this.sender.send(request)
  }
  /** Read accounts, or the per-conversation queue state. */
  async list(type?: 'accounts' | 'conversations'): Promise<ImListResult> {
    if (type === 'conversations') return { conversations: this.queue.conversationSummaries() }
    if (type === undefined) {
      return {
        accounts: await this.bindings.listAccounts(),
        conversations: this.queue.conversationSummaries(),
      }
    }
    return { accounts: await this.bindings.listAccounts() }
  }
  /** The recent queue rows, for the audit view. */
  messages(): ImMessageRow[] {
    return this.queue.recent()
  }
  /** Route one inbound message; see `router-inbound.ts`. */
  handle(providerId: string, message: ImMessage): Promise<void> {
    return this.inbound.handle(providerId, message)
  }
}
