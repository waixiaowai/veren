/**
 * `@veren/admin-navigation-default` — the default `navigation` capability
 * provider.
 *
 * It owns no HTTP surface: the shell reads the tree through `ctx.adminNavigation`
 * and the gateway enforces every route permission independently. The defaults
 * are registered in the provider constructor, so the capability is complete the
 * moment the kernel activates it.
 *
 * `@veren/admin-navigation-default` — 默认的 `navigation` 能力 provider。它不拥有任何
 * HTTP 面：外壳通过 `ctx.adminNavigation` 读取树，网关独立执行每条路由的权限。默认项在
 * provider 构造函数中注册，因此内核一激活该能力，它就是完整的。
 *
 * @module @veren/admin-navigation-default
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ProviderManifest } from '@veren/admin-contract'
import type {} from '@veren/admin-kernel'
import { DefaultNavigation } from './provider.ts'

/** Plugin name used by the loader and diagnostics. 加载器与诊断使用的插件名。 */
export const name = 'admin-navigation-default'

/** Services this plugin needs before it may load. 本插件加载前需要的服务。 */
export const inject = ['admin', 'adminAccess'] as const

/**
 * Plugin configuration.
 *
 * Navigation has no tunables: default entries are code and contributions come
 * from other modules at runtime. The empty shape keeps loader validation and
 * profile rows honest instead of accepting ignored keys.
 *
 * 插件配置。导航没有可调项：默认条目是代码，贡献项在运行期来自其他模块。空形状让加载器校验
 * 与 profile 行保持诚实，而不是接受被忽略的键。
 */
export type Config = Record<string, never>

/** Schemastery schema the loader validates before {@link apply}. 加载器在 {@link apply} 之前校验的 schemastery schema。 */
export const Config = z.object({})

/** What this provider declares to the kernel. 本 provider 向内核声明的内容。 */
export const MANIFEST: ProviderManifest = {
  id: 'navigation-default',
  capability: 'navigation',
  contract: '^1.0',
  priority: 0,
  label: 'Default navigation',
}

/**
 * Plugin entry: register the navigation capability.
 *
 * @param ctx - plugin context 插件上下文
 * @returns a disposer that removes the registration 移除注册项的 disposer
 */
export function apply(ctx: Context): () => void {
  return ctx.effect(() => ctx.admin.register(MANIFEST, new DefaultNavigation(ctx)), 'admin-navigation-registration')
}

export { DefaultNavigation } from './provider.ts'
export { DEFAULT_NAVIGATION } from './contributions.ts'
export { arrange, toNode } from './order.ts'
