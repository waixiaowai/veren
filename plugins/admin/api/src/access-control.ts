/**
 * Identity and permission enforcement of the API gateway.
 *
 * These four steps always run in the same order — resolve the caller, attach
 * resolved permissions, enforce the route permission, enforce token scopes —
 * so a new endpoint cannot skip one by re-implementing them.
 *
 * API 网关的身份与权限执行。四步始终按同一顺序运行——解析调用者、附加已解析权限、
 * 执行路由权限、执行 token scope——因此新端点无法绕开任何一步自行实现。
 *
 * @module @veren/admin-api-kernel/access-control
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  ADMIN_SESSION_COOKIE,
  AdminError,
  type AdminAccess,
  type AdminAuth,
  type AdminIdentity,
  type AdminRoute,
  type AuthenticatedPrincipal,
} from '@veren/admin-contract'
import type {} from '@veren/admin-kernel'
import type { RequestFacts } from './http.ts'

/**
 * Resolve the caller identity for a route's audience.
 *
 * @param ctx - owning context 所属上下文
 * @param route - matched route 匹配路由
 * @param facts - request facts 请求事实
 * @returns the identity, or `undefined` for an anonymous public caller 身份；公开匿名调用为 `undefined`
 */
export async function resolveCaller(ctx: Context, route: AdminRoute, facts: RequestFacts): Promise<AdminIdentity | undefined> {
  if (!ctx.admin.has('auth')) return undefined
  const auth = ctx.admin.require<AdminAuth>('auth')
  if (route.audience === 'terminal') {
    const header = facts.headers.authorization ?? ''
    const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined
    if (bearer === undefined || bearer.length === 0) return undefined
    return auth.authenticate({ bearer })
  }
  const sessionId = facts.cookies[ADMIN_SESSION_COOKIE]
  if (sessionId === undefined) return undefined
  return auth.authenticate({ sessionId })
}

/**
 * Attach resolved permissions to an identity.
 *
 * @param ctx - owning context 所属上下文
 * @param identity - the authenticated identity 已认证身份
 * @returns the principal 主体
 */
export async function principalOf(ctx: Context, identity: AdminIdentity): Promise<AuthenticatedPrincipal> {
  const access = ctx.admin.has('access') ? ctx.admin.require<AdminAccess>('access') : undefined
  const permissions = access === undefined ? [] : await access.permissionsOf(identity)
  return { ...identity, permissions }
}

/**
 * Enforce one route permission.
 *
 * @param ctx - owning context 所属上下文
 * @param route - matched route 匹配路由
 * @param principal - resolved principal 已解析主体
 */
export function assertPermission(ctx: Context, route: AdminRoute, principal: AuthenticatedPrincipal | undefined): void {
  const permission = route.permission as string
  if (principal === undefined) throw new AdminError('AUTH_REQUIRED', `authentication is required for ${permission}`)
  const access = ctx.admin.has('access') ? ctx.admin.require<AdminAccess>('access') : undefined
  if (access === undefined || !access.can(principal, permission)) {
    throw new AdminError('FORBIDDEN', `missing permission ${permission}`, { permission })
  }
}

/**
 * Enforce the scopes a terminal route requires.
 *
 * @param route - matched route 匹配路由
 * @param principal - resolved principal 已解析主体
 */
export function assertScopes(route: AdminRoute, principal: AuthenticatedPrincipal | undefined): void {
  const required = route.scopes as readonly string[]
  const granted = principal?.scopes ?? []
  const missing = required.filter((scope) => !granted.includes(scope))
  if (missing.length > 0) {
    throw new AdminError('FORBIDDEN', `token is missing scopes: ${missing.join(', ')}`, { missingScopes: missing })
  }
}
