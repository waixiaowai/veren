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
import { consolidatePeople } from './people-merge.ts'
import { ImMessageQueue } from './queue.ts'
import { reconcileProviderAccounts, retireOwnerAccounts as retireAccounts } from './account-replace.ts'
import { ImRouter, ImRouterToken } from './router.ts'
import type { ImRouterOptions } from './router-types.ts'
import { errorMessage } from './runtime-seams.ts'
import type { ImCredentialStore, ImLogger } from './runtime-seams.ts'
import { ImGatewayService } from './gateway-remote.ts'
import { DshSessionGateway } from './gateway.ts'
import { STRANGER_INTAKE_ASK, STRANGER_INTAKE_DEFAULTS } from './intake.ts'
import type { ImStrangerIntakeConfig } from './intake.ts'

export * from './contract.ts'
export * from './people.ts'
export * from './router.ts'
export * from './intake.ts'
export {
  IM_DOMAIN_NAME, ImStorage, conversationKey, imDomain, messageKey, personAddressKey,
} from './store.ts'
export { ImMessageQueue, MAX_MESSAGE_ATTEMPTS } from './queue.ts'
export type {
  ImAccountRow,
  ImBindingRow,
  ImConversationRow,
  ImConversationSessionRow,
  ImCoreStore,
  ImIntakeStatus,
  ImMessageRow,
  ImMessageStatus,
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
/**
 * Host services the core needs. `agentDefaultModel` and `workspaceRegistry`
 * back the session gateway's create/resume paths — missing either used to
 * throw (or silently fall back to cwd) inside ensureSession, killing every
 * inbound message with three instant retries (live defect, 2026-10-27).
 * 核心依赖的宿主服务。`agentDefaultModel` 与 `workspaceRegistry` 支撑会话网关的
 * 创建/恢复路径——缺了任何一个，ensureSession 内部就会抛错（或静默退回 cwd），
 * 每条入站消息三次立死（真机缺陷，2026-10-27）。
 */
export const inject = ['storageDomain', 'credentials', 'agents', 'agentDefaultModel', 'workspaceRegistry'] as const
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
  }, provider => {
    // Provider 就绪即对账：崩溃或清理失手窗口留下的同主死账号行，以服务器的活名单为裁决自愈。
    // Reconcile the moment a provider is ready: same-owner rows left by a crash
    // or a missed cleanup heal against the server's own live-account list.
    void reconcileProviderAccounts({ store: options.store, logger: options.logger }, provider.id, provider.service)
      .catch((error: unknown) => options.logger.warn(
        `[im:bindings] account reconciliation failed: ${errorMessage(error)}`,
      ))
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
 * Open the durable IM domain and register its disposer.
 * 打开持久化 IM 域并注册其释放器。
 */
async function openStorage(ctx: Context): Promise<ImStorage> {
  const storage = new ImStorage()
  await storage.open(ctx)
  ctx.effect(() => () => storage.close(), 'im:storage')
  return storage
}

/** Project the host logger onto the seam the IM core reads. */
/** 把宿主 logger 投影到 IM 核心依赖的接缝上。 */
function buildLogger(ctx: Context): ImLogger {
  return {
    info: message => ctx.logger.info(message),
    warn: message => ctx.logger.warn(message),
    error: message => ctx.logger.error(message),
  }
}

/**
 * Build the people directory: consolidate stored duplicates, seed from stored
 * conversations, and publish the service.
 * 构建人员目录：归并存量重复档案、从已存会话播种，并发布服务。
 */
async function buildPeople(ctx: Context, storage: ImStorage, logger: ImLogger): Promise<ImPeople> {
  const people = new ImPeople({ store: storage, logger })
  // 先归并存量重复档案再播种：归并回退只防新增，重启时的存量修复在这里。
  // Consolidate stored duplicates before seeding: the runtime fallback only
  // prevents new ones; the stored repair happens here, once per activation.
  await consolidatePeople(storage, logger)
  await seedPeople(people, storage, logger)
  ctx.effect(() => ctx.provide(ImPeopleToken, people), 'im:people')
  return people
}

/**
 * Recover in-flight queue rows left by a crash back to the queued state.
 * 把崩溃遗留的在途队列行恢复回排队状态。
 */
async function recoverQueue(ctx: Context, storage: ImStorage): Promise<void> {
  // 重启恢复：消费中的行回到排队（至少一次契约），消息绝不因崩溃而消失。
  // Restart recovery: consuming rows return to queued (the at-least-once
  // contract); a crash never makes a message vanish.
  const queue = new ImMessageQueue({ store: storage })
  const recovered = await queue.recoverStuck()
  if (recovered > 0) {
    ctx.logger.warn(`im: ${recovered} in-flight message(s) returned to the queue after the restart`)
  }
}

/**
 * Wire the session gateway and the queue-fed router, with disposers in
 * unload order.
 * 接线会话网关与队列供养的 router，并按卸载顺序注册释放器。
 */
function wireRuntime(ctx: Context, storage: ImStorage, logger: ImLogger, config: Config, people: ImPeople): void {
  const gateway = new DshSessionGateway(ctx, config.replyTimeoutMs)
  ctx.effect(() => () => gateway.dispose(), 'im:gateway')
  wireRouter(ctx, {
    store: storage,
    gateway,
    credentials: new DshCredentialStore(ctx),
    people,
    logger,
    // 一个微信号 = 一只活 bot：新授权确认时把同 owner 死账号的行整体迁移过来。
    // One WeChat, one live bot: a fresh confirmation migrates the owner's dead
    // accounts' rows onto the new account before it is persisted.
    retireOwnerAccounts: (providerId, account) =>
      retireAccounts({ store: storage, logger }, providerId, account).then(() => undefined),
    config: {
      strangerIntake: config.strangerIntake,
    },
  })
}

/**
 * Apply the IM core plugin.
 * @param ctx - host context.
 * @param config - validated plugin configuration.
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const storage = await openStorage(ctx)
  const logger = buildLogger(ctx)
  const people = await buildPeople(ctx, storage, logger)
  ctx.logger.info(
    `im: stranger intake is ${config.strangerIntake.enabled ? 'enabled' : 'disabled'}`
    + ` (ask: ${STRANGER_INTAKE_ASK})`,
  )
  await recoverQueue(ctx, storage)
  wireRuntime(ctx, storage, logger, config, people)
  // Web 面板的后端：`im` 远端命名空间（QR data URL、目录/绑定/采集的读写面）。
  // router 由注入解析，挂载顺序无关。
  // The web panel's backend: the `im` remote namespace (QR data URLs plus the
  // read/write faces for catalog, bindings, and intake). The router resolves
  // by injection, so mount order is irrelevant.
  ctx.plugin(ImGatewayService)
}
