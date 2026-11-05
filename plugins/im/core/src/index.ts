/**
 * @veren/im plugin entry: storage, the people directory, the participant
 * roster, agent memory, the provider registry, and stranger intake.
 *
 * The core owns the fact pipeline's mouth: providers register here, and every
 * inbound observation leaves as one `im/message-observed` event. Downstream
 * domains own their own stages — @veren/im-conversation turns observations
 * into durable room messages, @veren/im-coordination decides who wakes,
 * @veren/im-turn runs the replies. The core ships no wake policy and no
 * session code.
 *
 * @veren/im 插件入口：存储、人员目录、参与者名册、智能体记忆、provider 注册表与陌生人采集。
 *
 * 核心拥有事实管线的入口：provider 在此注册，每一条入站观察都以一次 `im/message-observed`
 * 事件离开。下游各域拥有自己的阶段——@veren/im-conversation 把观察变成持久的房间消息，
 * @veren/im-coordination 决定谁被唤醒，@veren/im-turn 跑出回复。核心不带唤醒策略，也不带
 * 会话代码。
 *
 * @module @veren/im
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: the optional `agentPresets` service this core reads when present.
// 仅类型：本核心在存在时读取的可选 `agentPresets` 服务。
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { ImRegistry, ImToken, imCredentialKey } from './contract.ts'
import { ImStorage } from './store.ts'
import { ImPeople, ImPeopleToken } from './people.ts'
import { consolidatePeople } from './people-merge.ts'
import { ImBindings, ImBindingsToken } from './bindings.ts'
import type { ImCredentialStore, ImLogger } from './runtime-seams.ts'
import { ImCredentialToken, ImLoggerToken, errorMessage } from './runtime-seams.ts'
import { ImParticipants, ImParticipantsToken } from './participants.ts'
import type { ImRosterEntry } from './participants.ts'
import { discoverPresets } from './preset-roster.ts'
import { ImMemory, ImMemoryToken } from './memory.ts'
import { ImDirectory, ImDirectoryToken } from './directory.ts'
import { ImStrangerIntake, ImIntakeToken } from './intake.ts'
import { STRANGER_INTAKE_ASK, STRANGER_INTAKE_DEFAULTS } from './intake.ts'
import type { ImStrangerIntakeConfig } from './intake.ts'
import { reconcileProviderAccounts, retireOwnerAccounts as retireAccounts } from './account-replace.ts'
import { ImRemoteService } from './remote.ts'
import './events.ts'

export * from './contract.ts'
export * from './people.ts'
export * from './intake.ts'
export {
  IM_DOMAIN_NAME, ImStorage, conversationKey, imDomain, messageKey, personAddressKey,
} from './store.ts'
export type {
  ImAccountRow,
  ImBindingRow,
  ImConversationRow,
  ImConversationSessionRow,
  ImCoreStore,
  ImIntakeStatus,
  ImMemoryRow,
  ImMemoryStore,
  ImMessageRow,
  ImMessageStatus,
  ImPersonAddressRow,
  ImPersonIntakeRow,
  ImPersonRow,
  ImPersonStore,
  ImStore,
} from './store.ts'
export { ImBindings } from './bindings.ts'
export type { ImBindPollResult, ImBindingsOptions } from './bindings.ts'
export { ImRemoteService } from './remote.ts'

/** DSH credential-backed account removal. */
/** 基于 DSH 凭据的账号删除。 */
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
 * Build the registry: providers it will receive emit `im/message-observed`,
 * and a provider joining triggers the account reconciliation self-heal.
 * 构建注册表：后续注册的 provider 发出 `im/message-observed`；provider 加入的瞬间触发
 * 账号对账自愈。
 */
function buildRegistry(ctx: Context, storage: ImStorage, logger: ImLogger): ImRegistry {
  const registry = new ImRegistry(ctx, provider => {
    // Provider 就绪即对账：崩溃或清理失手窗口留下的同主死账号行，以服务器的活名单为裁决自愈。
    // Reconcile the moment a provider is ready: same-owner rows left by a crash
    // or a missed cleanup heal against the server's own live-account list.
    void reconcileProviderAccounts({ store: storage, logger }, provider.id, provider.service)
      .catch((error: unknown) => logger.warn(
        `[im:bindings] account reconciliation failed: ${errorMessage(error)}`,
      ))
  })
  // ImRegistry extends Service：构造即以 ImToken 注册，绝不能再手动 provide。
  // ImRegistry extends Service: construction registers under ImToken already;
  // never provide it manually on top.
  return registry
}

/** Plugin name. */
/** 插件名。 */
export const name = 'im'

/**
 * Host services the core needs: durable storage and credentials. Session
 * provisioning belongs to the turn domain — the core injects no agent-facing
 * services.
 * 核心依赖的宿主服务：持久化存储与凭据。会话筹备属于回合域——核心不注入任何面向 agent 的
 * 服务。
 */
export const inject = ['storageDomain', 'credentials'] as const
/** Services this plugin provides. */
/** 本插件提供的服务。 */
export const provide = [
  ImToken, ImPeopleToken, ImParticipantsToken, ImMemoryToken, ImBindingsToken, ImDirectoryToken,
  ImIntakeToken,
] as const

/** Plugin configuration. */
/** 插件配置。 */
export interface Config {
  /** Display name of the owner human in prompts and rosters. */
  /** prompt 与名册中所有者人类的展示名。 */
  ownerName: string
  /**
   * The preset-backed agents of this workspace. Each entry is one agent
   * participant (`agent:<presetId>`); the preset carries persona, model, and
   * engine.
   * 本工作区的 preset 智能体。每条是一个智能体参与者（`agent:<presetId>`）；preset 承载
   * 人格、模型与引擎。
   */
  roster: ImRosterEntry[]
  /**
   * Extra names the default agent answers to. The panel renders a localized
   * name (Chinese "助手") that differs from the host display name, so mention
   * routing has to accept it too.
   * 默认智能体额外应答的名字。面板渲染的是本地化名字（中文「助手」），与宿主展示名不同，
   * 因此提及路由也必须接受它。
   */
  defaultAgentAliases: string[]
  /**
   * Automatic stranger-intake question. `enabled: false` is the total switch:
   * no question is sent and no intake row is written.
   * 自动陌生人询问。`enabled: false` 是总开关：一条都不发，也不写 intake 记录。
   */
  strangerIntake: ImStrangerIntakeConfig
}
/** Configuration schema. */
/** 配置 schema。 */
export const Config: z<Config> = z.object({
  ownerName: z.string().default('Owner'),
  defaultAgentAliases: z.array(z.string().min(1)).default(['助手']),
  roster: z.array(z.object({
    presetId: z.string().min(1),
    name: z.string().min(1).required(false),
  })).default([]),
  strangerIntake: z.object({
    enabled: z.boolean().default(STRANGER_INTAKE_DEFAULTS.enabled),
    replyWindowMs: z.number().min(1).default(STRANGER_INTAKE_DEFAULTS.replyWindowMs),
    maxAsksPerHour: z.number().min(1).default(STRANGER_INTAKE_DEFAULTS.maxAsksPerHour),
    minAskIntervalMs: z.number().min(0).default(STRANGER_INTAKE_DEFAULTS.minAskIntervalMs),
  }),
})

/**
 * Apply the IM core plugin: storage, people, roster, memory, registry,
 * bindings, intake, and the web remote.
 * 应用 IM 核心插件：存储、人员、名册、记忆、注册表、绑定、采集与 Web 远端。
 *
 * @param ctx - host context.
 * @param config - validated plugin configuration.
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const storage = await openStorage(ctx)
  const logger = buildLogger(ctx)
  ctx.effect(() => ctx.provide(ImLoggerToken, logger), 'im:logger')
  ctx.effect(() => ctx.provide(ImCredentialToken, new DshCredentialStore(ctx)), 'im:credentials')

  const people = await buildPeople(ctx, storage, logger)
  // 智能体就是 DSH preset：注册表出现后自动并进名册，无需重启。
  // Agents are DSH presets: once the registry exists they join the roster live.
  const presets = discoverPresets(ctx)
  ctx.effect(
    () => ctx.provide(ImParticipantsToken, new ImParticipants({
      roster: config.roster,
      ownerName: config.ownerName,
      defaultAgentAliases: config.defaultAgentAliases,
      discoveredAgents: presets.rows,
      people,
    })),
    'im:participants',
  )
  ctx.effect(() => ctx.provide(ImMemoryToken, new ImMemory({ store: storage })), 'im:memory')

  buildIntakeAndRemote(ctx, config, logger, people, storage)
}

/** The stranger-intake wiring plus the Web panel's backend namespace. */
function buildIntakeAndRemote(
  ctx: Context,
  config: Config,
  logger: ImLogger,
  people: Awaited<ReturnType<typeof buildPeople>>,
  storage: Awaited<ReturnType<typeof openStorage>>,
): void {
  const registry = buildRegistry(ctx, storage, logger)
  const bindings = buildBindings(ctx, storage, logger, registry, people)
  buildIntake(ctx, config, logger, people, bindings, registry)
  ctx.logger.info(
    `im: stranger intake is ${config.strangerIntake.enabled ? 'enabled' : 'disabled'}`
    + ` (ask: ${STRANGER_INTAKE_ASK})`,
  )
  // Web 面板的后端：`im` 远端命名空间（QR data URL、账号/目录/采集的读写面）。
  // The web panel's backend: the `im` remote namespace (QR data URLs plus the
  // read/write faces for accounts, directory, and intake).
  ctx.plugin(ImRemoteService)
}

/**
 * Wire the account-authorization service and its disposers.
 * 接线账号授权服务及其释放器。
 */
function buildBindings(
  ctx: Context,
  storage: ImStorage,
  logger: ImLogger,
  registry: ImRegistry,
  people: ImPeople,
): ImBindings {
  const bindings = new ImBindings({
    store: storage,
    registry,
    logger,
    // 一个微信号 = 一只活 bot：新授权确认时把同 owner 死账号的行整体迁移过来。
    // One WeChat, one live bot: a fresh confirmation migrates the owner's dead
    // accounts' rows onto the new account before it is persisted.
    retireOwnerAccounts: (providerId, account) =>
      retireAccounts({ store: storage, logger }, providerId, account).then(() => undefined),
  })
  ctx.effect(() => ctx.provide(ImBindingsToken, bindings), 'im:bindings')
  ctx.effect(() => ctx.provide(ImDirectoryToken, new ImDirectory({ bindings, people })), 'im:directory')
  // Registered last so it runs first on unload: drop the remembered bind
  // attempts before the registry service itself leaves the context.
  // 最后注册、卸载时最先执行：在 registry 服务离开 context 之前丢弃已记住的 bind 尝试。
  ctx.effect(() => () => bindings.dispose(), 'im:bindings-dispose')
  return bindings
}

/**
 * Wire stranger intake over the registry's own send path, and consume the
 * observed-message event.
 * 在注册表自己的发送路径上接线陌生人采集，并消费观察消息事件。
 */
function buildIntake(
  ctx: Context,
  config: Config,
  logger: ImLogger,
  people: ImPeople,
  bindings: ImBindings,
  registry: ImRegistry,
): ImStrangerIntake {
  // 陌生人采集直接消费观察事件：提问是确定性动作，不是回合。
  // Stranger intake consumes observations directly: the question is a
  // deterministic act, not a turn.
  const intake = new ImStrangerIntake({
    people,
    logger,
    config: config.strangerIntake,
    send: async request => sendThroughRegistry(registry, bindings, request),
  })
  ctx.effect(() => ctx.provide(ImIntakeToken, intake), 'im:intake')
  ctx.effect(
    () => ctx.on('im/message-observed', async ({ providerId, message }) => {
      // Directory bookkeeping (including the cloud push) must never drop a
      // message: a storage failure is reported, then intake proceeds.
      // 目录记账（含云端上报）绝不能丢消息：存储失败只记日志，采集继续。
      const person = await registry.observeInbound(providerId, message)
      await intake.handle(providerId, message, person)
    }),
    'im:intake-observe',
  )
  return intake
}

/** Send one intake question through the account's own provider path. */
/** 经账号自身的 provider 路径发送一条采集询问。 */
async function sendThroughRegistry(
  registry: ImRegistry,
  bindings: ImBindings,
  request: { accountId: string; conversationId: string; text: string },
): Promise<import('./contract-bind.ts').ImSendResult> {
  const account = bindings.account(request.accountId)
  if (account === undefined) {
    throw new Error(`unknown account: ${request.accountId}`)
  }
  const provider = registry.get(account.provider)
  return provider.service.send({
    target: { accountId: request.accountId, conversationId: request.conversationId },
    content: { type: 'text', text: request.text },
  })
}
