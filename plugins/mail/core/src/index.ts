/**
 * `@veren/mail`: the notification domain, as a DSH plugin.
 *
 * The plugin owns the durable store, the channel providers, and the service
 * the rest of the world talks to. Its apply is deliberately small: open the
 * storage domain, build the providers, provide the service, and mount the
 * web gateway. Everything the plugin does afterwards is driven by the host's
 * lifecycle, and everything it registers is released in reverse order when
 * the plugin unloads.
 *
 * `@veren/mail`：作为 DSH 插件的通知领域。
 *
 * 插件拥有持久化存储、渠道提供方，以及外界对话的服务。它的 apply 刻意保持精简：打开存储域、
 * 构建提供方、提供服务、并挂载 Web 网关。此后插件所做的一切由宿主生命周期驱动，而它注册的
 * 一切在插件卸载时按逆序释放。
 *
 * @module @veren/mail
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MailGatewayService } from './gateway.ts'
import type { ChannelProvider } from './deliver.ts'
import { inAppProvider, smtpProvider, type SmtpConfig } from './providers.ts'
import { MailService, MailServiceToken } from './service.ts'
import { ensureStationSeed } from './seed.ts'
import { MailStore } from './store.ts'
import type { ChannelKind } from './types.ts'

/** The plugin name the loader row references. / 加载器行引用的插件名。 */
export const name = 'mail'

/** The services this plugin consumes. / 本插件消费的服务。 */
export const inject = ['storageDomain'] as const

/** The services this plugin provides. / 本插件提供的服务。 */
export const provide = [MailServiceToken] as const

/** The plugin's configuration. / 插件配置。 */
export interface Config {
  /** Whether the plugin registers its service and gateway at all. / 插件是否注册其服务与网关。 */
  readonly enabled: boolean
  /** The mail server the email channel sends through. / 邮件渠道所用的邮件服务器。 */
  readonly smtp: SmtpConfig | undefined
  /** Write the built-in `station-notice` workflow and `host` recipient when absent. / 缺省时写入内置 `station-notice` 工作流与 `host` 收件人。 */
  readonly seed: boolean
}

/** The configuration schema. / 配置 schema。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  seed: z.boolean().default(true),
  smtp: z.object({
    host: z.string().required(),
    port: z.number().default(587),
    secure: z.boolean().default(false),
    from: z.string().required(),
    user: z.string().default(''),
    password: z.string().default(''),
  }).default(undefined as never),
}) as z<Config>

/**
 * Assemble the plugin.
 *
 * @param ctx - the host context / 宿主上下文
 * @param config - the validated configuration / 已校验的配置
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!config.enabled) return
  const store = new MailStore()
  await store.open(ctx)
  ctx.effect(() => async () => { await store.close() }, 'mail:storage-close')
  if (config.seed) await ensureStationSeed(store)
  const providers = buildProviders(config)
  const service = new MailService(store, providers)
  ctx.effect(() => ctx.provide(MailServiceToken, service), 'mail:service')
  ctx.plugin(MailGatewayService)
}

/**
 * Build the channel providers the configuration enables.
 *
 * The station inbox always ships: it needs no credential and no external
 * call, so it is the one channel a deployment can rely on from the start.
 *
 * 构建配置所启用的渠道提供方。
 *
 * 站内收件箱始终提供：它无需凭据、无需外呼，因此是部署从一开始即可依赖的渠道。
 *
 * @param config - the validated configuration / 已校验的配置
 * @returns the providers, keyed by the channel they serve / 按所服务渠道归集的提供方
 */
function buildProviders(config: Config): Map<ChannelKind, ChannelProvider> {
  const providers = new Map<ChannelKind, ChannelProvider>()
  providers.set('in_app', inAppProvider)
  if (config.smtp !== undefined) {
    providers.set('email', smtpProvider(config.smtp))
  }
  return providers
}

export { MailGatewayService, MAIL_GATEWAY_NAME, MAIL_REMOTE_NAMESPACE } from './gateway.ts'
export { MailService, MailServiceToken } from './service.ts'
export { STATION_TRIGGER, STATION_SUBSCRIBER } from './seed.ts'
export type { MessageView, RunView, StepView } from './service.ts'
export { MailStore } from './store.ts'
export { MailError, mailError, type MailErrorCode } from './errors.ts'
export { inAppProvider, smtpProvider, type SmtpConfig } from './providers.ts'
export type {
  ChannelKind,
  ConversationRecord,
  JobRecord,
  MessageRecord,
  RunRecord,
  SubscriberRecord,
  WorkflowRecord,
} from './types.ts'
export type {
  ConversationId,
  JobId,
  MessageId,
  RunId,
  SubscriberId,
  TopicKey,
  TransactionId,
  WorkflowId,
} from './types.ts'
export type { TriggerRecipient, TriggerRequest, TriggerResult } from './trigger.ts'
