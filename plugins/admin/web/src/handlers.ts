/**
 * The routes the SPA needs besides the capability routes: bootstrap and the two
 * UI manifests.
 *
 * Bootstrap is the one place that joins identity, permissions, navigation and
 * feature flags, so the SPA renders its first screen from a single response.
 *
 * SPA 除能力路由外需要的路由：bootstrap 与两份 UI 清单。bootstrap 是唯一把身份、权限、
 * 导航与功能开关连接起来的地方，因此 SPA 用一次响应渲染首个界面。
 *
 * @module @veren/admin-web/handlers
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  ADMIN_CSRF_COOKIE,
  type AdminNavNode,
  type AdminRoute,
  type AuthenticatedPrincipal,
  type CapabilityCatalog,
} from '@veren/admin-contract'
import type { UiManifest } from '@veren/admin-ui-contract'
import type {} from '@veren/admin-ui-kernel'

/** Bootstrap payload consumed by the SPA. SPA 使用的 bootstrap 载荷。 */
export interface BootstrapPayload {
  /** Authenticated principal with resolved permissions. 带已解析权限的已认证主体。 */
  readonly user: AuthenticatedPrincipal
  /** Effective permissions. 生效权限。 */
  readonly permissions: readonly string[]
  /** Visible navigation nodes. 可见导航节点。 */
  readonly nav: readonly AdminNavNode[]
  /** Capability availability flags. 能力可用标志。 */
  readonly features: Readonly<Record<string, boolean>>
  /** Contract version of the Host capability contract. Host 契约版本。 */
  readonly contractVersion: string
  /** Double-submit CSRF token, when the caller has one. 调用方的双提交 CSRF token。 */
  readonly csrfToken: string | null
}

/**
 * Build the bootstrap payload for one authenticated principal.
 *
 * @param ctx - plugin context 插件上下文
 * @param principal - authenticated principal 已认证主体
 * @param csrfToken - CSRF token read from the cookie Cookie 中读取的 CSRF token
 * @returns the payload 载荷
 */
export async function bootstrapPayload(
  ctx: Context,
  principal: AuthenticatedPrincipal,
  csrfToken: string | null,
): Promise<BootstrapPayload> {
  const catalog: CapabilityCatalog = ctx.admin.catalog()
  const nav = await ctx.adminNavigation.tree(principal)
  return {
    user: principal,
    permissions: principal.permissions,
    nav,
    features: catalog.features,
    contractVersion: catalog.contractVersion,
    csrfToken,
  }
}

/**
 * Build the UI manifest for one audience, degrading to an empty manifest when
 * no UI kernel is mounted.
 *
 * @param ctx - plugin context 插件上下文
 * @param audience - manifest audience 清单受众
 * @returns the manifest 清单
 */
export function uiManifest(ctx: Context, audience: 'public' | 'admin'): UiManifest {
  const kernel = ctx.get('adminUi')
  return kernel === undefined ? { uiContract: '1.0.0', packs: [] } : kernel.manifest(audience)
}

/**
 * Build the routes this package registers.
 *
 * @param ctx - plugin context 插件上下文
 * @returns the routes 路由
 */
export function webRoutes(ctx: Context): AdminRoute[] {
  return [
    {
      audience: 'admin',
      method: 'GET',
      path: '/bootstrap',
      summary: 'Identity, permissions, navigation and feature flags for the SPA',
      tags: ['web'],
      handler: async ({ request }) => {
        const principal = request.principal
        if (principal === undefined) return {}
        return bootstrapPayload(ctx, principal, request.cookie(ADMIN_CSRF_COOKIE) ?? null)
      },
    },
    {
      audience: 'public',
      method: 'GET',
      path: '/ui-manifest',
      summary: 'Core UI packs available before sign-in',
      tags: ['web'],
      handler: () => uiManifest(ctx, 'public'),
    },
    {
      audience: 'admin',
      method: 'GET',
      path: '/ui-manifest',
      summary: 'Every UI pack available after sign-in',
      tags: ['web'],
      handler: () => uiManifest(ctx, 'admin'),
    },
  ]
}
