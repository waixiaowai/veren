/**
 * Public entry of `@veren/admin-api-kernel`.
 *
 * Mounts the gateway on the web server, declares `ctx.adminApi`, and re-exports
 * the route vocabulary providers register with.
 *
 * `@veren/admin-api-kernel` 的公开入口。把网关挂载到 web 服务器，声明
 * `ctx.adminApi`，并重新导出 provider 注册所用的路由词汇。
 *
 * @module @veren/admin-api-kernel
 */

import type { Context } from '@deepseek-ai/cordis'
// 类型-only 导入：只为拉起 webServer 的 declaration merge，使 `ctx.webServer`
// 在本文件里可用，运行时并不加载它。
// Type-only import: pulls the webServer declaration merge so `ctx.webServer`
// is typed here; nothing is loaded at runtime.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { AdminApi, Config, resolveConfig, type ResolvedConfig } from './api.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The unified API gateway. 统一 API 网关。 */
    adminApi: AdminApi
  }
}

/** Plugin display name. 插件显示名。 */
export const name = 'admin-api-kernel'

/** The gateway needs the kernel registry and the HTTP carrier. 网关需要内核注册表与 HTTP 载体。 */
export const inject = ['admin', 'webServer'] as const

/**
 * Plugin entry: create the gateway and mount it on the configured prefix.
 *
 * @param ctx - plugin context 插件上下文
 * @param config - validated config 已校验配置
 */
export function apply(ctx: Context, config: Config): void {
  const api = new AdminApi(ctx, config)
  const mountPath = api.config.mountPath
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: mountPath,
      handler: (req, res) => api.handle(req, res),
    }),
    'admin-api-route',
  )
}

export { AdminApi, Config, resolveConfig }
export type { ResolvedConfig }
export * from './http.ts'
export * from './openapi.ts'
export * from './router.ts'
