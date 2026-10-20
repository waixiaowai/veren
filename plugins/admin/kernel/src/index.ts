/**
 * Public entry of `@veren/admin-kernel`.
 *
 * Besides re-exporting the kernel, this module declares the Host service names
 * the kernel mounts, so consumers get `ctx.admin` and the per-capability
 * façades with full types.
 *
 * `@veren/admin-kernel` 的公开入口。除重新导出内核外，本模块声明内核挂载的 Host
 * 服务名，使消费方获得带完整类型的 `ctx.admin` 与逐能力 façade。
 *
 * @module @veren/admin-kernel
 */

import type {
  AdminAccess,
  AdminAudit,
  AdminAuth,
  AdminDatabase,
  AdminDocs,
  AdminNavigation,
  AdminSettings,
} from '@veren/admin-contract'
import type { AdminKernel } from './plugin.ts'
import type { AdminReadiness } from './registry.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The kernel: registration, catalog, health and the boot gate. 内核：注册、目录、健康与启动门禁。 */
    admin: AdminKernel
    /**
     * Published once every essential capability has a provider. Injecting it
     * orders consumers after the provider rows.
     *
     * 全部必需能力都有 provider 后发布。注入它会把消费方排在 provider 行之后。
     */
    adminReadiness: AdminReadiness
    /** Stable `data` façade. 稳定的 `data` façade。 */
    adminData: AdminDatabase
    /** Stable `auth` façade. 稳定的 `auth` façade。 */
    adminAuth: AdminAuth
    /** Stable `access` façade. 稳定的 `access` façade。 */
    adminAccess: AdminAccess
    /** Stable `navigation` façade. 稳定的 `navigation` façade。 */
    adminNavigation: AdminNavigation
    /** Stable `audit` façade. 稳定的 `audit` façade。 */
    adminAudit: AdminAudit
    /** Stable `settings` façade. 稳定的 `settings` façade。 */
    adminSettings: AdminSettings
    /** Stable `docs` façade. 稳定的 `docs` façade。 */
    adminDocs: AdminDocs
  }
}

export * from './plugin.ts'
export * from './registry.ts'
export * from './range.ts'
export * from './facades.ts'
