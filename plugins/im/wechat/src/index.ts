/**
 * @veren/im-wechat plugin: register the WeChat provider and start its runtime.
 *
 * State lives under the plugin's own data directory, defaulting to
 * `<DSH_HOME>/im/wechat`; secrets live only in `ctx.credentials`. The plugin
 * registers the provider before starting it, so the registry's disposer and the
 * runtime stop unwind in reverse order.
 *
 * @veren/im-wechat 插件：注册微信 provider 并启动 runtime。
 *
 * 状态位于插件自己的数据目录，默认 `<DSH_HOME>/im/wechat`；Secret 只进 `ctx.credentials`。
 * 插件先注册 provider 再启动，因此注册表注销与 runtime 停止会按逆序清理。
 *
 * @module @veren/im-wechat
 */

import { resolve, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DshWechatSecrets } from './state.ts'
import { WEIXIN_BASE_URL, WEIXIN_BOT_TYPE } from './api.ts'
import { WEIXIN_FEATURES, WechatProvider } from './provider.ts'

export { WEIXIN_BASE_URL, WEIXIN_BOT_TYPE, WEIXIN_LONG_POLL_MS } from './api.ts'
export { WechatApi, WechatTimeoutError, normalizeBaseUrl, normalizeQrUrl } from './api.ts'
export { DshWechatSecrets, WechatStateStore, parseSecrets } from './state.ts'
export type {
  WechatLoginStatus,
  WechatMessage,
  WechatProviderOptions,
  WechatSecretStore,
  WechatSecrets,
  WechatState,
  WechatUpdates,
} from './state.ts'
export { WEIXIN_FEATURES, WechatProvider, splitText } from './provider.ts'
export { WechatBindAttempt } from './runtime.ts'

/** Plugin name. */
export const name = 'imWechat'

/** Services this plugin consumes. */
export const inject = ['im', 'credentials'] as const

/** This plugin provides no service of its own. */
export const provide = [] as const

/** Plugin configuration. */
export interface Config {
  /** Provider data directory; empty means `<DSH_HOME>/im/wechat`. */
  dataDir: string
  /** iLink bot type sent to the QR endpoint. */
  botType: string
  /** iLink API base URL. */
  baseUrl: string
}

/** Configuration schema. */
export const Config: z<Config> = z.object({
  dataDir: z.string().default(''),
  botType: z.string().default(WEIXIN_BOT_TYPE),
  baseUrl: z.string().default(WEIXIN_BASE_URL),
})

/**
 * Apply the WeChat provider plugin.
 * @param ctx - host context carrying `im` and `credentials`.
 * @param config - validated plugin configuration.
 */
export const apply = (ctx: Context, config: Config): void => {
  const dataDir = config.dataDir.trim() === ''
    ? join(resolveDshHome(), 'im', 'wechat')
    : resolve(config.dataDir)
  const provider = new WechatProvider({
    dataDir,
    botType: config.botType,
    baseUrl: config.baseUrl,
    logger: ctx.logger,
    secrets: new DshWechatSecrets(ctx.credentials),
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
