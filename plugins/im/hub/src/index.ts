/**
 * @veren/im-hub plugin: this device receives WeChat messages through the cloud
 * im-hub gateway. The plugin is a provider — it registers `hub` into the
 * provider-neutral registry, inbound messages enter the conversation domain
 * through the core's observed-message event, and agent-authored room messages
 * are delivered back to the hub by subscribing `im/message-new`. It holds no
 * iLink session; authorization lives on the hub.
 *
 * @veren/im-hub 插件：本设备经云端 im-hub 网关接收微信消息。插件是一个 provider——
 * 它把 `hub` 注册进 provider 中立的注册表，入站消息经核心的观察事件进入会话域，
 * 智能体写的房间消息通过订阅 `im/message-new` 交付回 hub。它不持有 iLink 会话；
 * 授权住在 hub 上。
 *
 * @module @veren/im-hub
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 类型-only import：只为拉取 im/message-new 事件面的 declaration merge，运行时零依赖。
// Type-only import: pulls in the im/message-new event declaration merge; nothing at runtime.
import type {} from '@veren/im-conversation'
import { DomainHubCursorStore } from './store.ts'
import { HubDirectory } from './directory.ts'
import { HubProvider, HUB_FEATURES } from './provider.ts'
import { deliverRoomMessage } from './delivery.ts'

export { HUB_FEATURES, HubProvider } from './provider.ts'
export { DomainHubCursorStore, hubDomain } from './store.ts'
export { HubDirectory } from './directory.ts'
export { channelTargetOf, deliverRoomMessage } from './delivery.ts'
export type { DeliveryOptions, DeliveryTarget } from './delivery.ts'

/** Plugin name. */
export const name = 'imHub'

/** Services this plugin consumes. */
export const inject = ['im', 'storageDomain'] as const

/** This plugin provides no service of its own. */
export const provide = [] as const

/** Plugin configuration. */
export interface Config {
  /** The CMS origin serving the im-hub module. */
  hubBaseUrl: string
  /** The device's CMS API Key (imhub:read granted); empty disables the channel. */
  apiKey: string
  /** This device's registration name at the hub. */
  deviceId: string
}

/** Configuration schema. */
export const Config: z<Config> = z.object({
  hubBaseUrl: z.string().default('http://127.0.0.1:8080'),
  apiKey: z.string().default(''),
  deviceId: z.string().default('main'),
})

/** Construction options the hub provider needs from config. */
/** hub provider 需要从配置拿的构造选项。 */
type HubProviderConfig = Pick<Config, 'hubBaseUrl' | 'apiKey' | 'deviceId'>

/**
 * Wire the provider: registration, the cloud directory, and the runtime.
 * 接线 provider：注册、云端目录与运行时。
 */
function wireHubProvider(ctx: Context, config: HubProviderConfig, cursor: DomainHubCursorStore): HubProvider {
  const provider = new HubProvider({
    hubBaseUrl: config.hubBaseUrl,
    apiKey: config.apiKey,
    deviceId: config.deviceId,
    logger: ctx.logger,
    cursor,
  })
  ctx.effect(() => ctx.im.register({
    id: 'hub',
    displayName: 'Hub',
    features: HUB_FEATURES,
    service: provider,
  }), 'im-hub:register')
  // 人员身份归云（归属表第 4 行）：挂云端目录缝——观察上报 + 首拉采纳进本地缓存。
  // People identity lives on the cloud (data-home row 4): attach the cloud
  // directory seam — observations push upstream, the first pull adopts locally.
  ctx.effect(() => ctx.im.attachDirectory(
    new HubDirectory({ hubBaseUrl: config.hubBaseUrl, apiKey: config.apiKey }),
    { provider: 'hub', accountId: config.deviceId },
  ), 'im-hub:directory')
  ctx.effect(() => {
    void provider.start()
    return () => provider.stop()
  }, 'im-hub:runtime')
  return provider
}

/**
 * Apply the hub-device plugin.
 * @param ctx - host context carrying `im` and `storageDomain`.
 * @param config - validated plugin configuration.
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  // misconfiguration fails loud：没令牌就是没通道，静默跳过只会让消息石沉大海。
  // Misconfiguration fails loud: no token means no channel; skipping silently
  // would only make messages vanish.
  if (config.apiKey.trim() === '') {
    throw new Error('[im:hub] apiKey is required — create a CMS API Key with imhub:read granted')
  }
  const cursor = new DomainHubCursorStore(ctx)
  await cursor.open()
  ctx.effect(() => () => cursor.close(), 'im-hub:storage')
  wireHubProvider(ctx, config, cursor)
  // 出站投递：会话域持久提交的智能体消息经 im/message-new POST 回 hub。投递尽力而为，
  // 失败只在 delivery 内部记警告；先注册、卸载时最先关闭，避免停机窗口里的竞态发送。
  // Outbound delivery: agent messages the conversation domain durably committed
  // are POSTed back to the hub via im/message-new. Delivery is best-effort —
  // failures warn inside the delivery; registered last so it closes first on
  // unload, avoiding racing sends during teardown.
  ctx.effect(
    () => ctx.on('im/message-new', payload => deliverRoomMessage({
      providerId: 'hub',
      registry: ctx.im,
      logger: ctx.logger,
    }, payload)),
    'im-hub:delivery',
  )
}
