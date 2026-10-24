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
 * The DSH session gateway lives in `gateway.ts`; the module split keeps the
 * plugin assembly under the file-size ceiling.
 * DSH 会话网关在 `gateway.ts`；模块拆分让插件装配保持在单文件行数上限内。
 *
 * @module @veren/im
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ImRegistry, ImToken, imCredentialKey } from './contract.ts'
import type { ImMessage } from './contract.ts'
import { ImStorage } from './store.ts'
import { ImPeople, ImPeopleToken } from './people.ts'
import { ImRouter, ImRouterToken } from './router.ts'
import type { ImRouterOptions } from './router-types.ts'
import { errorMessage } from './runtime-seams.ts'
import { DshSessionGateway } from './gateway.ts'
import { STRANGER_INTAKE_ASK, STRANGER_INTAKE_DEFAULTS } from './intake.ts'
import type { ImStrangerIntakeConfig } from './intake.ts'
import type { ImCredentialStore, ImLogger } from './router.ts'

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
        `[im:people] stored conversation ${row.account_id}/${row.conversation_id} was not seeded: ${errorMessage(error)}`,
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

/**
 * Build the registry and the router it feeds, then publish the router.
 *
 * The registry starts delivering as soon as a provider registers, so messages
 * that arrive before the router exists are buffered and replayed in order
 * instead of being dropped silently.
 * 构建注册表与它供养的 router，然后发布 router。
 *
 * registry 在 provider 注册后即刻投递消息，router 就绪前到达的消息先缓冲，router 建好后
 * 按序回放，而不是被静默丢弃。
 *
 * @param ctx - host context.
 * @param options - router construction options without the registry.
 */
function wireRouter(ctx: Context, options: Omit<ImRouterOptions, 'registry'>): void {
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
  router = new ImRouter({ ...options, registry })
  const liveRouter = router
  for (const { providerId, message } of early.splice(0)) void liveRouter.handle(providerId, message)
  ctx.effect(() => ctx.provide(ImRouterToken, liveRouter), 'im:router')
  // Registered last so it runs first on unload: drop the remembered bind
  // attempts before the router service itself leaves the context.
  // 最后注册、卸载时最先执行：在 router 服务离开 context 之前丢弃已记住的 bind 尝试。
  ctx.effect(() => () => liveRouter.dispose(), 'im:bindings')
}
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
  wireRouter(ctx, {
    store: storage,
    gateway,
    credentials: new DshCredentialStore(ctx),
    people,
    logger,
    config: {
      autoCreateSession: config.autoCreateSession,
      strangerIntake: config.strangerIntake,
    },
  })
}
