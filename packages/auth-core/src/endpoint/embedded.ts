/**
 * 钩子收集：用户级与插件级钩子的固定时序（设计文档 modules/02-endpoint.md
 * §2.2）——用户 before → 插件 before → 处理器 → 插件 after → 用户 after。
 * HTTP 路由与内嵌调用共用本实现，保证两条入口行为一致（§3.14）。
 *
 * Hook collection: the fixed user/plugin timing (design
 * modules/02-endpoint.md §2.2) — user before → plugin before → handler →
 * plugin after → user after. HTTP routes and embedded calls share this
 * implementation so both entries behave identically (§3.14).
 *
 * @module @veren/auth-core/endpoint/embedded.ts
 */

import type { AuthContext } from '../context/auth-context.ts'
import type { AuthHook, EndpointContext } from './endpoint-types.ts'

/** 用户钩子的适配：按路径匹配器命中。 / The user-hook adapter: hit by path matcher. */
function adaptUserHooks(context: AuthContext, routePath: string, kind: 'before' | 'after'): AuthHook[] {
  return (context.options.hooks?.[kind] ?? [])
    .filter((hook) => hook.matcher(routePath))
    .map((hook) => ({
      matcher: () => true,
      handler: hook.handler as (ctx: EndpointContext) => Promise<unknown>,
      source: 'user',
    }))
}

/** 收集一次调用的钩子集。 / Collect the hook set for one call. */
export function collectHooksForRoute(context: AuthContext, routePath: string): { before: AuthHook[], after: AuthHook[] } {
  const pluginBefore = context.plugins.flatMap((plugin) => plugin.hooks?.before ?? [])
  const pluginAfter = context.plugins.flatMap((plugin) => plugin.hooks?.after ?? [])
  return {
    before: [...adaptUserHooks(context, routePath, 'before'), ...pluginBefore],
    after: [...pluginAfter, ...adaptUserHooks(context, routePath, 'after')],
  }
}
