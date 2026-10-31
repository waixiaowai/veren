/**
 * Sign-in surface of the auth-local provider: first-run setup, login, logout,
 * the principal probe and self-service password change.
 *
 * Handlers stay thin: parse nothing (the gateway validated the body), call one
 * provider method, and attach the session cookies where sign-in succeeded.
 *
 * auth-local provider 的登录面：首次初始化、登录、登出、主体探针与自助改密。
 * handler 保持轻薄：不做解析（网关已校验请求体），只调用一个 provider 方法，并在
 * 登录成功处附加会话 Cookie。
 *
 * @module @veren/admin-auth-local/session-routes
 */

import {
  ADMIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  type AdminRoute,
  type AuthenticatedPrincipal,
} from '@veren/admin-contract'
import type { LocalAuth } from './local-auth.ts'
import type { ResolvedAuthConfig } from './config.ts'
import { changePasswordBody, loginBody, setupBody } from './route-bodies.ts'
import { applySessionCookies } from './session-cookies.ts'
import { z as zod } from 'zod'

/** `GET /setup` — whether the deployment still needs its first administrator. 部署是否仍需要首个管理员。 */
function setupStatusRoute(auth: LocalAuth): AdminRoute {
  return {
    audience: 'public',
    method: 'GET',
    path: '/setup',
    summary: 'Report whether the deployment still needs its first administrator',
    tags: ['auth'],
    handler: async () => ({ required: await auth.setupRequired() }),
  }
}

/** `POST /setup` — create the first administrator and sign it in. 创建首个管理员并登录。 */
function setupRoute(auth: LocalAuth, config: ResolvedAuthConfig): AdminRoute {
  return {
    audience: 'public',
    method: 'POST',
    path: '/setup',
    summary: 'Create the first administrator and sign in',
    tags: ['auth'],
    audit: true,
    action: 'auth.setup',
    input: setupBody,
    handler: async ({ request, response }) => {
      const body = request.body as zod.infer<typeof setupBody>
      const result = await auth.setup(body)
      applySessionCookies(response, result, config)
      return { user: result.principal, csrfToken: result.csrfToken, expiresAt: result.session.expiresAt }
    },
  }
}

/** `POST /login` — verify credentials and open a session. 校验凭据并建立会话。 */
function loginRoute(auth: LocalAuth, config: ResolvedAuthConfig): AdminRoute {
  return {
    audience: 'public',
    method: 'POST',
    path: '/login',
    summary: 'Verify credentials and open a session',
    tags: ['auth'],
    audit: true,
    action: 'auth.login',
    input: loginBody,
    handler: async ({ request, response }) => {
      const body = request.body as zod.infer<typeof loginBody>
      const result = await auth.login({
        email: body.email,
        password: body.password,
        ip: request.ip,
        userAgent: request.header('user-agent') ?? '',
      })
      applySessionCookies(response, result, config)
      return { user: result.principal, csrfToken: result.csrfToken, expiresAt: result.session.expiresAt }
    },
  }
}

/** `POST /logout` — close the session carried by the cookie. 关闭 Cookie 携带的会话。 */
function logoutRoute(auth: LocalAuth): AdminRoute {
  return {
    audience: 'admin',
    method: 'POST',
    path: '/logout',
    summary: 'Close the current session',
    tags: ['auth'],
    audit: true,
    action: 'auth.logout',
    handler: async ({ request, response }) => {
      const token = request.cookie(ADMIN_SESSION_COOKIE)
      if (token !== undefined) await auth.logout(token)
      response.clearCookie(ADMIN_SESSION_COOKIE)
      response.clearCookie(ADMIN_CSRF_COOKIE)
      return { signedOut: true }
    },
  }
}

/** `GET /me` — read the authenticated principal. 读取当前认证主体。 */
function meRoute(): AdminRoute {
  return {
    audience: 'admin',
    method: 'GET',
    path: '/me',
    summary: 'Read the authenticated principal',
    tags: ['auth'],
    handler: ({ request }) => ({ user: request.principal }),
  }
}

/** `POST /me/password` — self-service password change. 自助修改密码。 */
function changePasswordRoute(auth: LocalAuth): AdminRoute {
  return {
    audience: 'admin',
    method: 'POST',
    path: '/me/password',
    summary: 'Change the signed-in user password',
    tags: ['auth'],
    audit: true,
    action: 'auth.changePassword',
    input: changePasswordBody,
    handler: async ({ request }) => {
      const body = request.body as zod.infer<typeof changePasswordBody>
      const principal = request.principal as AuthenticatedPrincipal
      return auth.changePassword(principal.userId, {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        // The session that made the request survives the change; every other
        // session of this user is revoked by the provider.
        // 发起请求的会话在改密后保留；该用户的其它会话由 provider 吊销。
        ...(principal.sessionId === undefined ? {} : { keepSessionId: principal.sessionId }),
      })
    },
  }
}

/**
 * Build the sign-in routes.
 *
 * @param auth - the provider instance provider 实例
 * @param config - resolved auth config 解析后的认证配置
 * @returns the routes to register 要注册的路由
 */
export function sessionRoutes(auth: LocalAuth, config: ResolvedAuthConfig): AdminRoute[] {
  return [setupStatusRoute(auth), setupRoute(auth, config), loginRoute(auth, config), logoutRoute(auth), meRoute(), changePasswordRoute(auth)]
}
