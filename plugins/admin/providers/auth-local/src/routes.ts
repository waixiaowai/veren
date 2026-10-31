/**
 * Route composition of the auth-local provider.
 *
 * Routes are grouped by responsibility (sign-in surface vs directory
 * management); this module only composes the groups in registration order.
 *
 * auth-local provider 的路由组合。路由按职责分组（登录面与目录管理）；本模块只按
 * 注册顺序组装各组。
 *
 * @module @veren/admin-auth-local/routes
 */

import type { AdminRoute } from '@veren/admin-contract'
import type { LocalAuth } from './local-auth.ts'
import type { ResolvedAuthConfig } from './config.ts'
import { directoryRoutes } from './directory-routes.ts'
import { sessionRoutes } from './session-routes.ts'

/**
 * Build the routes this provider registers.
 *
 * @param auth - the provider instance provider 实例
 * @param config - resolved auth config 解析后的认证配置
 * @returns the routes to register 要注册的路由
 */
export function authRoutes(auth: LocalAuth, config: ResolvedAuthConfig): AdminRoute[] {
  return [...sessionRoutes(auth, config), ...directoryRoutes(auth)]
}
