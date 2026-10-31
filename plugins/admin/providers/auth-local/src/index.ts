/**
 * `@veren/admin-auth-local` — the default `auth` provider.
 *
 * Registers the local-account implementation, its sign-in and user-management
 * routes, and the session cookies the SPA and the gateway both depend on. Every
 * registration is an effect, so unloading the provider removes its routes and
 * its capability in reverse order.
 *
 * The module surface is assembly only: declaration (name / inject / Config /
 * manifest) and wiring (`apply`). The provider implementation lives in
 * `./local-auth.ts`, the routes in `./routes.ts` and their grouped files.
 *
 * `@veren/admin-auth-local` — 默认的 `auth` provider。注册本地账号实现、登录与用户
 * 管理路由，以及 SPA 与网关共同依赖的会话 Cookie。每个注册都是 effect，因此卸载时
 * 按相反顺序移除路由与能力。
 *
 * 模块面只做组装：声明（name / inject / Config / manifest）与接线（`apply`）。
 * provider 实现在 `./local-auth.ts`，路由在 `./routes.ts` 及其分组文件中。
 *
 * @module @veren/admin-auth-local
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { type ProviderManifest } from '@veren/admin-contract'
import type {} from '@veren/admin-api-kernel'
import type {} from '@veren/admin-kernel'
import { resolveAuthConfig, type AuthConfig } from './config.ts'
import { LocalAuth } from './local-auth.ts'
import { authRoutes } from './routes.ts'

export { LocalAuth, resolveAuthConfig } from './provider.ts'
export type { AuthConfig, ResolvedAuthConfig } from './provider.ts'
export { authRoutes } from './routes.ts'

/** Plugin display name. 插件显示名。 */
export const name = 'admin-auth-local'

/** The provider needs the registry, the gateway and the two capabilities it joins. 该 provider 需要注册表、网关与它连接的两个能力。 */
export const inject = ['admin', 'adminApi', 'adminData', 'adminAccess'] as const

/** Provider configuration. provider 配置。 */
export type Config = AuthConfig

export const Config: z<Config> = z.object({
  sessionDays: z.natural().min(1).max(365).default(7),
  idleHours: z.natural().min(1).max(720).default(12),
  secureCookies: z.boolean().default(false),
  passwordMinLength: z.natural().min(8).max(128).default(8),
  loginRateLimit: z.object({
    window: z.natural().min(1).default(60),
    max: z.natural().min(1).default(10),
  }).default(undefined as never),
})

/** What this provider declares to the kernel. 该 provider 向内核声明的信息。 */
export const manifest: ProviderManifest = {
  id: 'auth-local',
  capability: 'auth',
  contract: '^1.0',
  priority: 0,
  dataDomain: 'admin_auth',
  label: 'Local accounts',
}

/**
 * Plugin entry: resolve the config, register the provider and its routes, each
 * as its own effect so unload disposes them in reverse order.
 *
 * 插件入口：解析配置，注册 provider 与其路由，各自作为独立 effect，使卸载按相反
 * 顺序释放。
 *
 * @param ctx - plugin context 插件上下文
 * @param config - validated config 已校验配置
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveAuthConfig(config)
  const auth = new LocalAuth(ctx, resolved)
  ctx.effect(() => ctx.admin.register(manifest, auth), 'admin-auth-provider')
  for (const route of authRoutes(auth, resolved)) {
    ctx.effect(() => ctx.adminApi.register(route), `admin-auth-${route.method}-${route.path}`)
  }
}
