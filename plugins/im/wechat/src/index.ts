/**
 * @veren/im-wechat plugin: register the WeChat provider and start its runtime.
 *
 * Durable state lives in the provider's `im_wechat` storage domain on the
 * profile's default backend; secrets live only in `ctx.credentials`. There is no
 * data-directory setting. The plugin registers the provider before starting it,
 * so the registry's disposer and the runtime stop unwind in reverse order, and
 * the storage domain closes last.
 *
 * @veren/im-wechat 插件：注册微信 provider 并启动 runtime。
 *
 * 持久化状态位于 provider 的 `im_wechat` 存储域，走 profile 的默认后端；Secret 只进
 * `ctx.credentials`。没有数据目录配置项。插件先注册 provider 再启动，因此注册表注销与
 * runtime 停止会按逆序清理，存储域最后关闭。
 *
 * @module @veren/im-wechat
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 类型-only import：只为拉取 im/message-new 事件面的 declaration merge，运行时零依赖。
// Type-only import: pulls in the im/message-new event declaration merge; nothing at runtime.
import type {} from '@veren/im-conversation'
import { DshWechatSecrets, openWechatStore } from './state.ts'
import { WEIXIN_BASE_URL, WEIXIN_BOT_TYPE } from './api.ts'
import { WEIXIN_FEATURES, WechatProvider } from './provider.ts'
import { deliverRoomMessage } from './delivery.ts'
import { captureFromEnv } from './capture.ts'

export { WEIXIN_BASE_URL, WEIXIN_BOT_TYPE, WEIXIN_LONG_POLL_MS } from './api.ts'
export { WechatApi, WechatTimeoutError, normalizeBaseUrl, normalizeQrUrl } from './api.ts'
export { DshWechatSecrets, parseSecrets } from './state.ts'
export type {
  WechatLoginStatus,
  WechatMessage,
  WechatProviderOptions,
  WechatSecretStore,
  WechatSecrets,
  WechatState,
  WechatStore,
} from './state.ts'
export { WEIXIN_FEATURES, WechatProvider, splitText } from './provider.ts'
export { WechatBindAttempt } from './runtime.ts'
export { channelTargetOf, deliverRoomMessage } from './delivery.ts'
export type { DeliveryOptions, DeliveryTarget } from './delivery.ts'

/** Plugin name. */
export const name = 'imWechat'

/** Services this plugin consumes; it cannot start without the storage domain. */
export const inject = ['im', 'credentials', 'storageDomain'] as const

/** This plugin provides no service of its own. */
export const provide = [] as const

/** Plugin configuration. */
export interface Config {
  /** iLink bot type sent to the QR endpoint. */
  botType: string
  /** iLink API base URL. */
  baseUrl: string
}

/** Configuration schema. */
export const Config: z<Config> = z.object({
  botType: z.string().default(WEIXIN_BOT_TYPE),
  baseUrl: z.string().default(WEIXIN_BASE_URL),
})

/** Construction options the provider needs from config and the environment. */
/** provider 需要从配置与环境拿的构造选项。 */
type ProviderConfig = Pick<Config, 'botType' | 'baseUrl'>

/**
 * Wire the provider: registration and the long-poll runtime.
 * 接线 provider：注册与长轮询运行时。
 */
function wireProvider(ctx: Context, config: ProviderConfig, store: ReturnType<typeof openWechatStore> extends Promise<infer T> ? T : never): void {
  const provider = new WechatProvider({
    store,
    botType: config.botType,
    baseUrl: config.baseUrl,
    logger: ctx.logger,
    secrets: new DshWechatSecrets(ctx.credentials),
    // 取证仪表（非功能）：设 DSH_IM_WECHAT_CAPTURE=<file> 时记录脱敏原始流量。
    // Evidence instrumentation (not a feature): set DSH_IM_WECHAT_CAPTURE=<file>
    // to record the redacted raw traffic.
    fetchImpl: captureFromEnv(process.env.DSH_IM_WECHAT_CAPTURE),
  })
  ctx.effect(() => ctx.im.register({
    id: 'wechat',
    displayName: 'WeChat',
    features: WEIXIN_FEATURES,
    service: provider,
  }), 'im-wechat:register')
  ctx.effect(() => {
    void provider.start().catch((error: unknown) => {
      ctx.logger.error(`[im:wechat] runtime failed to start: ${error instanceof Error ? error.message : String(error)}`)
    })
    return () => provider.stop()
  }, 'im-wechat:runtime')
}

/**
 * Apply the WeChat provider plugin.
 * @param ctx - host context carrying `im`, `credentials`, and `storageDomain`.
 * @param config - validated plugin configuration.
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const store = await openWechatStore(ctx)
  ctx.effect(() => () => store.close(), 'im-wechat:storage')
  wireProvider(ctx, config, store)
  // 出站投递：会话域持久提交的智能体消息经 im/message-new 流回微信。投递尽力而为，
  // 失败只在 delivery 内部记警告；先注册、卸载时最先关闭，避免停机窗口里的竞态发送。
  // Outbound delivery: agent messages the conversation domain durably committed
  // flow back to WeChat via im/message-new. Delivery is best-effort — failures
  // warn inside the delivery; registered last so it closes first on unload,
  // avoiding racing sends during teardown.
  ctx.effect(
    () => ctx.on('im/message-new', payload => deliverRoomMessage({
      providerId: 'wechat',
      registry: ctx.im,
      logger: ctx.logger,
    }, payload)),
    'im-wechat:delivery',
  )
}
