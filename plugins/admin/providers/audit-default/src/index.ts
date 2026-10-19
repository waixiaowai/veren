/**
 * `@veren/admin-audit-default` — the default `audit` capability provider.
 *
 * It registers {@link AuditDefault} behind the kernel façade and mounts the
 * list route on the API gateway. Both registrations live in `ctx.effect`, so a
 * profile reload removes the provider, the route and the capability together;
 * `apply` also returns a disposer for callers that embed the plugin directly.
 *
 * `@veren/admin-audit-default` — 默认的 `audit` 能力 provider。它把 {@link AuditDefault}
 * 注册到内核 façade 之后，并把列表路由挂到 API 网关上。两个注册都放在 `ctx.effect` 中，
 * 因此 profile 重载会一并移除 provider、路由与能力；`apply` 还返回一个 disposer，供直接
 * 嵌入本插件的调用方使用。
 *
 * @module @veren/admin-audit-default
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ProviderManifest } from '@veren/admin-contract'
import type {} from '@veren/admin-api-kernel'
import type {} from '@veren/admin-kernel'
import { resolveConfig, type Config } from './config.ts'
import { AuditDefault } from './provider.ts'
import { createAuditRoute } from './route.ts'

/** Plugin name used by the loader and diagnostics. 加载器与诊断使用的插件名。 */
export const name = 'admin-audit-default'

/** Services this plugin needs before it may load. 本插件加载前需要的服务。 */
export const inject = ['admin', 'adminApi', 'adminData'] as const

/** What this provider declares to the kernel. 本 provider 向内核声明的内容。 */
export const MANIFEST: ProviderManifest = {
  id: 'audit-default',
  capability: 'audit',
  contract: '^1.0',
  priority: 0,
  dataDomain: 'admin_audit',
  label: 'Default audit trail',
}

/**
 * Plugin entry: register the capability and its route.
 *
 * @param ctx - plugin context 插件上下文
 * @param config - plugin config, possibly partial 插件配置，可以是部分对象
 * @returns a disposer that removes both registrations 移除两个注册项的 disposer
 */
export function apply(ctx: Context, config: Config): () => void {
  const provider = new AuditDefault(ctx, resolveConfig(config))
  const disposeRegistration = ctx.effect(() => ctx.admin.register(MANIFEST, provider), 'admin-audit-registration')
  const disposeRoute = ctx.effect(() => ctx.adminApi.register(createAuditRoute(provider)), 'admin-audit-route')
  return () => {
    void disposeRoute()
    void disposeRegistration()
  }
}

export { AuditDefault, AUDIT_TABLE } from './provider.ts'
export { auditQuerySchema, createAuditRoute, readAuditQuery } from './route.ts'
export { DEFAULT_LIMIT, MAX_LIMIT, type AuditPage } from './query.ts'
export {
  Config,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_RETENTION_DAYS,
  resolveConfig,
  type ResolvedConfig,
} from './config.ts'
