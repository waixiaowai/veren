/**
 * `@veren/admin-access-rbac` — the default `access` provider.
 *
 * Registers the RBAC facade implementation and its routes, and removes both on
 * unload so a replacement provider can take over without a restart of the
 * kernel or the gateway.
 *
 * `@veren/admin-access-rbac` — 默认的 `access` provider。注册 RBAC façade 实现及其
 * 路由，卸载时两者一并移除，因此替换 provider 无需重启内核或网关。
 *
 * @module @veren/admin-access-rbac
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ProviderManifest } from '@veren/admin-contract'
import type {} from '@veren/admin-api-kernel'
import type {} from '@veren/admin-kernel'
import { RbacAccess } from './provider.ts'
import { accessRoutes } from './routes.ts'

/** Plugin display name. 插件显示名。 */
export const name = 'admin-access-rbac'

/** The provider needs the registry, the gateway and the data capability. 该 provider 需要注册表、网关与数据能力。 */
export const inject = ['admin', 'adminApi', 'adminData'] as const

/** Provider configuration; the RBAC provider has no tunables yet. provider 配置；RBAC provider 暂无可调项。 */
export interface Config {}

export const Config: z<Config> = z.object({})

/** What this provider declares to the kernel. 该 provider 向内核声明的信息。 */
export const manifest: ProviderManifest = {
  id: 'access-rbac',
  capability: 'access',
  contract: '^1.0',
  priority: 0,
  dataDomain: 'admin_access',
  label: 'Role-based access control',
}

/**
 * Plugin entry.
 *
 * @param ctx - plugin context 插件上下文
 * @param config - validated config 已校验配置
 */
export function apply(ctx: Context, config: Config): void {
  void config
  const access = new RbacAccess(ctx)
  ctx.effect(() => ctx.admin.register(manifest, access), 'admin-access-provider')
  for (const route of accessRoutes(access)) {
    ctx.effect(() => ctx.adminApi.register(route), `admin-access-${route.method}-${route.path}`)
  }
}

export { RbacAccess } from './provider.ts'
export type { BindingRecord, RoleRecord } from './provider.ts'
export { ALL_PERMISSIONS, BUILT_IN_ROLES, OWNER_ROLE } from './roles.ts'
export { accessRoutes } from './routes.ts'
