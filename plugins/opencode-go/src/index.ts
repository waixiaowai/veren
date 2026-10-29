/**
 * @veren/opencode-go —— OpenCode Go 订阅的专用模型路由。
 * 挂载即注册：`opencode-go` provider 路由（经 dsh-llm 适配器 SPI）+
 * 引导式登录授权流（经 dsh-authorization/dsh-credentials 缝）。
 * @veren/opencode-go — the dedicated model route for the OpenCode Go
 * subscription. Mounting registers the `opencode-go` provider route (via the
 * dsh-llm adapter SPI) plus the guided sign-in flow (via the
 * dsh-authorization/dsh-credentials seams).
 *
 * @module @veren/opencode-go
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-authorization'
import z from '@deepseek-ai/schemastery'
import { OpencodeGoAdapter } from './adapter.js'
import { GoCatalog, OPENCODE_GO_PROVIDER } from './catalog.js'
import { resolveConfig, type Config as ConfigShape } from './config.js'
import { registerOpencodeGoFlow } from './auth-flow.js'
import { ListingClient } from './listing.js'
import { OpencodeGoGatewayService } from './gateway-remote.js'

/** Cordis 插件名。The Cordis plugin name. */
export const name = 'opencode-go'

/** 插件配置形状。The plugin config shape. */
export interface Config extends ConfigShape {}

/** 宿主统一配置契约。The host's uniform config contract. */
export const Config: z<Config> = z.object({
  baseURL: z.string(),
  listingBaseURL: z.string(),
  modelsTimeoutMs: z.number(),
  modelsMaxAgeMs: z.number(),
  requestTimeoutMs: z.number(),
}).description('OpenCode Go bridge endpoints and timeouts')

/**
 * 依赖的能力面：llm（路由注册）、credentials（key 记录）、
 * authorization（登录流）。
 * The injected capabilities: llm (route registration), credentials (the key
 * record), authorization (the sign-in flow).
 */
export const inject = ['llm', 'credentials', 'authorization']

/** 本插件不提供服务面。This plugin provides no service face. */
export const provide = []

/** 插件入口：注册路由、登录流与 Web 网关；都随插件卸载逆序清理。Plugin entry: registers the route, the sign-in flow, and the web gateway; all unwind in reverse order on unload. */
export const apply = (ctx: Context, config: Config): void => {
  const resolved = resolveConfig(config)
  const listing = new ListingClient(resolved)
  const catalog = new GoCatalog(resolved, listing)
  registerOpencodeGoFlow(ctx, resolved, catalog)
  const adapter = new OpencodeGoAdapter({ ctx, config: resolved, catalog })
  const disposeRoutes = ctx.llm.registerAdapter([OPENCODE_GO_PROVIDER], adapter)
  ctx.effect(() => disposeRoutes, 'opencode-go.registerAdapter')
  ctx.plugin(OpencodeGoGatewayService)
}
