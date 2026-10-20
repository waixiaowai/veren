/**
 * @veren/im plugin entry: registry, router, storage, people directory, and the
 * DSH session bridge.
 * The core package owns no channel-specific code. It opens the durable IM
 * domain, constructs the people directory, the registry, and the router,
 * publishes them under `imPeople` and `imRouter`, and hands inbound messages to
 * the active-binding router. The model-facing `im_*` tools are registered by
 * @veren/im-tool.
 *
 * @veren/im 插件入口：注册表、路由、存储、人员目录与 DSH 会话桥。
 *
 * 核心包不含任何渠道特判。它打开持久化 IM 域，构造人员目录、注册表与路由，把它们发布为
 * `imPeople` 与 `imRouter`，并把入站消息交给 active-binding 路由。面向模型的 `im_*` 工具由
 * @veren/im-tool 注册。
 *
 * @module @veren/im
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { ImError, ImRegistry, ImToken, imCredentialKey } from './contract.ts'
import type { ImBindingSettings, ImMessage } from './contract.ts'
import { ImStorage } from './store.ts'
import { ImPeople, ImPeopleToken } from './people.ts'
import { ImRouter, ImRouterToken } from './router.ts'
import { STRANGER_INTAKE_ASK, STRANGER_INTAKE_DEFAULTS } from './intake.ts'
import type { ImStrangerIntakeConfig } from './intake.ts'
import type { ImCredentialStore, ImLogger, ImSessionGateway } from './router.ts'

export * from './contract.ts'
export * from './people.ts'
export * from './router.ts'
export * from './intake.ts'
export {
  IM_DOMAIN_NAME, ImStorage, conversationKey, imDomain, parseSettings, personAddressKey,
} from './store.ts'
export type {
  ImAccountRow,
  ImBindingRow,
  ImBindingStore,
  ImConversationRow,
  ImIntakeStatus,
  ImPersonAddressRow,
  ImPersonIntakeRow,
  ImPersonRow,
  ImPersonStore,
  ImStore,
} from './store.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** One inbound IM message promoted into a DSH Session. @persistenceSource user */
    'im-message': {
      kind: 'im-message'
      providerId: string
      accountId: string
      conversationId: string
      messageId: string
    }
  }
}

/** One reply the gateway is waiting for. */
interface PendingReply {
  /** True until this prompt's own `user/message` event is observed. */
  awaitingMessage: boolean
  /** The prompt id sent through `followup`; identifies exactly our turn. */
  messageId: string
  text: string
  resolve: (value: string | undefined) => void
  reject: (error: unknown) => void
  timer: NodeJS.Timeout
}

/**
 * DSH-backed session gateway.
 *
 * A delivered prompt starts one turn; the answer is the concatenated text of
 * that turn's `assistant/message` events, settled at `turn/end`. The capture is
 * armed only by this prompt's own `user/message` event (matched through the
 * `im-message` source), so a human turn running concurrently in the same
 * Session can never leak its answer back to the channel.
 */
class DshSessionGateway implements ImSessionGateway {
  private readonly pending = new Map<string, PendingReply>()
  private readonly chains = new Map<string, Promise<unknown>>()

  /**
   * @param ctx - context carrying `agents` and the session event bus.
   * @param replyTimeoutMs - maximum wait for one turn to end.
   */
  constructor(
    private readonly ctx: Context,
    private readonly replyTimeoutMs: number,
  ) {
    ctx.effect(
      () => ctx.on('session/event', (session, event) => this.observe(session.id, event)),
      'im:session-events',
    )
  }

  async ensureSession(request: {
    sessionId?: string
    settings: ImBindingSettings
  }): Promise<{ sessionId: string; created: boolean }> {
    const existing = request.sessionId
    if (existing !== undefined) {
      const id = brandString<SessionId>(existing)
      if (this.ctx.agents.get(id) !== undefined) return { sessionId: existing, created: false }
      try {
        await this.ctx.agents.resume({ resumeSessionId: id })
        return { sessionId: existing, created: false }
      } catch (error: unknown) {
        throw new ImError('IM_INTERNAL', `session could not be resumed: ${messageOf(error)}`)
      }
    }
    const id = brandString<SessionId>(`session-${randomUUID()}`)
    try {
      await this.ctx.agents.create({
        sessionId: id,
        ...(request.settings.presetId === undefined
          ? {}
          : { meta: { agentPreset: request.settings.presetId } }),
        ...agentOptionsOf(request.settings),
      })
      return { sessionId: id, created: true }
    } catch (error: unknown) {
      throw new ImError('IM_INTERNAL', `session could not be created: ${messageOf(error)}`)
    }
  }

  ask(request: {
    sessionId: string
    prompt: string
    source: {
      providerId: string
      accountId: string
      conversationId: string
      messageId: string
    }
  }): Promise<string | undefined> {
    return this.serialize(request.sessionId, () => new Promise<string | undefined>((resolve, reject) => {
      const agent = this.ctx.agents.get(brandString<SessionId>(request.sessionId))
      if (agent === undefined) {
        reject(new ImError('IM_NOT_FOUND', `session is not live: ${request.sessionId}`))
        return
      }
      const timer = setTimeout(() => {
        this.settle(request.sessionId, {
          error: new ImError('IM_INTERNAL', `session did not answer within ${this.replyTimeoutMs}ms`),
        })
      }, this.replyTimeoutMs)
      timer.unref()
      this.pending.set(request.sessionId, {
        awaitingMessage: true,
        messageId: request.source.messageId,
        text: '',
        resolve,
        reject,
        timer,
      })
      try {
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: request.prompt }],
          source: { kind: 'im-message', ...request.source },
        }))
      } catch (error: unknown) {
        this.settle(request.sessionId, { error })
      }
    }))
  }

  /** Stop waiting for replies; called on plugin unload. */
  dispose(): void {
    for (const [sessionId, pending] of [...this.pending]) {
      clearTimeout(pending.timer)
      pending.reject(new ImError('IM_INTERNAL', 'IM plugin is unloading'))
      this.pending.delete(sessionId)
    }
    this.chains.clear()
  }

  /** Consume one session event for the pending reply of that session. */
  private observe(sessionId: SessionId, event: SessionEvent): void {
    const pending = this.pending.get(sessionId)
    if (pending === undefined) return
    if (event.type === 'user/message') {
      // Arm only on this prompt's own user message; anything else in the same
      // Session (a human typing meanwhile) belongs to another turn.
      // 只在本 prompt 自己的 user message 上武装；同一 Session 里的其他输入属于别的 turn。
      const source: unknown = event.data.source
      if (pending.awaitingMessage
        && typeof source === 'object' && source !== null
        && (source as { kind?: unknown }).kind === 'im-message'
        && (source as { messageId?: unknown }).messageId === pending.messageId) {
        pending.awaitingMessage = false
      }
      return
    }
    if (event.type === 'assistant/message') {
      if (pending.awaitingMessage) return
      for (const block of event.data.message.content) {
        if (block.type === 'text') pending.text += block.text
      }
      return
    }
    if (event.type === 'turn/end' && !pending.awaitingMessage) {
      this.settle(sessionId, { value: pending.text.trim() || undefined })
    }
  }

  /** Settle one pending reply exactly once. */
  private settle(sessionId: string, outcome: { value?: string; error?: unknown }): void {
    const pending = this.pending.get(sessionId)
    if (pending === undefined) return
    this.pending.delete(sessionId)
    clearTimeout(pending.timer)
    if (outcome.error !== undefined) pending.reject(outcome.error)
    else pending.resolve(outcome.value)
  }

  /** Serialize prompts per Session so a reply cannot bind to the wrong turn. */
  private serialize<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tail = next.catch(() => undefined)
    this.chains.set(sessionId, tail)
    return next.finally(() => {
      if (this.chains.get(sessionId) === tail) this.chains.delete(sessionId)
    })
  }
}

/** DSH credential-backed account removal. */
class DshCredentialStore implements ImCredentialStore {
  /**
   * @param ctx - context carrying `credentials`.
   */
  constructor(private readonly ctx: Context) {}

  async remove(accountId: string): Promise<void> {
    await this.ctx.credentials.deleteRecord(imCredentialKey(accountId))
  }
}

/** Build the per-agent options a new Session receives. */
function agentOptionsOf(settings: ImBindingSettings): { agentOptions: AgentOptions } | Record<string, never> {
  const options: AgentOptions = {}
  if (settings.provider !== undefined) options.provider = settings.provider
  if (settings.model !== undefined) options.model = settings.model
  if (settings.reasoning !== undefined) {
    options.reasoningEffort = brandString<NonNullable<AgentOptions['reasoningEffort']>>(settings.reasoning)
  }
  return Object.keys(options).length === 0 ? {} : { agentOptions: options }
}

/** One log-safe error account. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Seed the people directory from conversations that are already persisted.
 *
 * A stored direct conversation is a known address even before its next message,
 * so binding history survives a restart. Failures are logged per row: one bad
 * row must not stop the plugin from loading the rest of the directory.
 * 用已持久化的会话为人员目录播种。
 *
 * 已存储的私聊会话在下一条消息到来前就是已知地址，因此绑定历史能跨重启保留。逐行记录失败：
 * 一行有问题不能阻止插件加载目录的其余部分。
 */
async function seedPeople(people: ImPeople, storage: ImStorage, logger: ImLogger): Promise<void> {
  for (const row of storage.conversations()) {
    if (row.kind !== 'direct') continue
    const account = storage.getAccount(row.account_id)
    if (account === undefined) continue
    try {
      await people.observeConversation({
        provider: account.provider,
        accountId: row.account_id,
        conversationId: row.conversation_id,
        ...(row.title === undefined ? {} : { displayName: row.title }),
      })
    } catch (error: unknown) {
      logger.warn(
        `[im:people] stored conversation ${row.account_id}/${row.conversation_id} was not seeded: ${messageOf(error)}`,
      )
    }
  }
}

/** Plugin name. */
export const name = 'im'
/** Host services the core needs. */
export const inject = ['storageDomain', 'credentials', 'agents'] as const
/** Services this plugin provides. */
export const provide = [ImToken, ImRouterToken, ImPeopleToken] as const
/** Plugin configuration. */
export interface Config {
  /** Auto-create a Session for an inbound conversation without an active binding. */
  autoCreateSession: boolean
  /** Maximum wait for one Session turn to finish. */
  replyTimeoutMs: number
  /**
   * Automatic stranger-intake question. `enabled: false` is the total switch:
   * no question is sent and no intake row is written.
   * 自动陌生人询问。`enabled: false` 是总开关：一条都不发，也不写 intake 记录。
   */
  strangerIntake: ImStrangerIntakeConfig
}
/** Configuration schema. */
export const Config: z<Config> = z.object({
  autoCreateSession: z.boolean().default(false),
  replyTimeoutMs: z.number().default(120_000),
  strangerIntake: z.object({
    enabled: z.boolean().default(STRANGER_INTAKE_DEFAULTS.enabled),
    replyWindowMs: z.number().min(1).default(STRANGER_INTAKE_DEFAULTS.replyWindowMs),
    maxAsksPerHour: z.number().min(1).default(STRANGER_INTAKE_DEFAULTS.maxAsksPerHour),
    minAskIntervalMs: z.number().min(0).default(STRANGER_INTAKE_DEFAULTS.minAskIntervalMs),
  }),
})
/**
 * Apply the IM core plugin.
 * @param ctx - host context.
 * @param config - validated plugin configuration.
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const storage = new ImStorage()
  await storage.open(ctx)
  ctx.effect(() => () => storage.close(), 'im:storage')
  const logger: ImLogger = {
    info: message => ctx.logger.info(message),
    warn: message => ctx.logger.warn(message),
    error: message => ctx.logger.error(message),
  }
  const people = new ImPeople({ store: storage, logger })
  await seedPeople(people, storage, logger)
  ctx.effect(() => ctx.provide(ImPeopleToken, people), 'im:people')
  ctx.logger.info(
    `im: stranger intake is ${config.strangerIntake.enabled ? 'enabled' : 'disabled'}`
    + ` (ask: ${STRANGER_INTAKE_ASK})`,
  )
  const gateway = new DshSessionGateway(ctx, config.replyTimeoutMs)
  ctx.effect(() => () => gateway.dispose(), 'im:gateway')
  // The registry starts delivering as soon as a provider registers, so messages
  // that arrive before the router exists are buffered here and replayed in order
  // instead of being dropped silently.
  // registry 在 provider 注册后即刻投递消息，router 就绪前到达的消息先在这里缓冲，
  // router 建好后按序回放，而不是被静默丢弃。
  let router: ImRouter | undefined
  const early: Array<{ providerId: string; message: ImMessage }> = []
  const registry = new ImRegistry(ctx, (providerId, message) => {
    const live = router
    if (live === undefined) {
      early.push({ providerId, message })
      return
    }
    void live.handle(providerId, message)
  })
  router = new ImRouter({
    store: storage,
    registry,
    gateway,
    credentials: new DshCredentialStore(ctx),
    people,
    logger,
    config: {
      autoCreateSession: config.autoCreateSession,
      strangerIntake: config.strangerIntake,
    },
  })
  const liveRouter = router
  for (const { providerId, message } of early.splice(0)) void liveRouter.handle(providerId, message)
  ctx.effect(() => ctx.provide(ImRouterToken, liveRouter), 'im:router')
}
