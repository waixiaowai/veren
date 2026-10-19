/**
 * `@veren/admin-auth-local` — the default `auth` provider.
 *
 * Registers the local-account implementation, its sign-in and user-management
 * routes, and the session cookies the SPA and the gateway both depend on. Every
 * registration is an effect, so unloading the provider removes its routes and
 * its capability in reverse order.
 *
 * `@veren/admin-auth-local` — 默认的 `auth` provider。注册本地账号实现、登录与用户管理
 * 路由，以及 SPA 与网关共同依赖的会话 Cookie。每个注册都是 effect，因此卸载时按相反
 * 顺序移除路由与能力。
 *
 * @module @veren/admin-auth-local
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_PERMISSIONS,
  ADMIN_SESSION_COOKIE,
  type AdminLoginResult,
  type AdminResponse,
  type AdminRoute,
  type ProviderManifest,
} from '@veren/admin-contract'
import type {} from '@veren/admin-api-kernel'
import type {} from '@veren/admin-kernel'
import { LocalAuth, resolveAuthConfig, type AuthConfig, type ResolvedAuthConfig } from './provider.ts'

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

/** Sign-in request body. 登录请求体。 */
const loginBody = zod.object({ email: zod.string().min(1), password: zod.string().min(1) })

/** First-run setup request body. 首次初始化请求体。 */
const setupBody = zod.object({ email: zod.string().min(1), password: zod.string().min(1), name: zod.string().min(1) })

/** User creation request body. 用户创建请求体。 */
const createUserBody = zod.object({
  email: zod.string().min(1),
  password: zod.string().min(1),
  name: zod.string().min(1),
  roles: zod.array(zod.string()).optional(),
})

/** User update request body. 用户更新请求体。 */
const updateUserBody = zod.object({
  name: zod.string().min(1).optional(),
  active: zod.boolean().optional(),
  password: zod.string().min(1).optional(),
})

/** Token creation request body. Token 创建请求体。 */
const createTokenBody = zod.object({
  name: zod.string().min(1),
  scopes: zod.array(zod.string()).default([]),
})

/**
 * Attach the session and CSRF cookies of a successful sign-in.
 *
 * @param response - response controls 响应控制
 * @param result - sign-in material 登录材料
 * @param config - resolved auth config 解析后的认证配置
 */
function applySessionCookies(response: AdminResponse, result: AdminLoginResult, config: ResolvedAuthConfig): void {
  const maxAgeSeconds = config.sessionDays * 86_400
  response.setCookie(ADMIN_SESSION_COOKIE, result.sessionToken, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
    maxAgeSeconds,
  })
  response.setCookie(ADMIN_CSRF_COOKIE, result.csrfToken, {
    httpOnly: false,
    sameSite: 'Lax',
    secure: config.secureCookies,
    maxAgeSeconds,
  })
}

/**
 * Build the routes this provider registers.
 *
 * @param auth - the provider instance provider 实例
 * @param config - resolved auth config 解析后的认证配置
 * @returns the routes to register 要注册的路由
 */
export function authRoutes(auth: LocalAuth, config: ResolvedAuthConfig): AdminRoute[] {
  return [
    {
      audience: 'public',
      method: 'GET',
      path: '/setup',
      summary: 'Report whether the deployment still needs its first administrator',
      tags: ['auth'],
      handler: async () => ({ required: await auth.setupRequired() }),
    },
    {
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
    },
    {
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
    },
    {
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
    },
    {
      audience: 'admin',
      method: 'GET',
      path: '/me',
      summary: 'Read the authenticated principal',
      tags: ['auth'],
      handler: ({ request }) => ({ user: request.principal }),
    },
    {
      audience: 'admin',
      method: 'GET',
      path: '/users',
      permission: ADMIN_PERMISSIONS.usersManage,
      summary: 'List users with their roles',
      tags: ['users'],
      handler: async () => ({ items: await auth.listUsers() }),
    },
    {
      audience: 'admin',
      method: 'POST',
      path: '/users',
      permission: ADMIN_PERMISSIONS.usersManage,
      summary: 'Create a user',
      tags: ['users'],
      audit: true,
      action: 'users.create',
      input: createUserBody,
      handler: async ({ request }) => {
        // schema 推断出的可选/数组是可变的，契约要求 readonly：在交接处收窄，
        // 而不是放宽契约。
        // The schema's inferred optional and array members are mutable while the
        // contract is readonly; narrow at the hand-off rather than loosen the
        // contract.
        const body = request.body as zod.infer<typeof createUserBody>
        return auth.createUser({
          email: body.email,
          password: body.password,
          name: body.name,
          ...(body.roles === undefined ? {} : { roles: [...body.roles] }),
        })
      },
    },
    {
      audience: 'admin',
      method: 'PATCH',
      path: '/users/:id',
      permission: ADMIN_PERMISSIONS.usersManage,
      summary: 'Update a user',
      tags: ['users'],
      audit: true,
      action: 'users.update',
      input: updateUserBody,
      handler: async ({ request }) => {
        // 同上：exactOptionalPropertyTypes 下不能把 `string | undefined` 交给
        // `string | absent`，因此逐字段判断后再交接。
        // Same reason: exactOptionalPropertyTypes forbids handing `string |
        // undefined` to `string | absent`, so each field is checked first.
        const body = request.body as zod.infer<typeof updateUserBody>
        return auth.updateUser(request.params.id as string, {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.active === undefined ? {} : { active: body.active }),
          ...(body.password === undefined ? {} : { password: body.password }),
        })
      },
    },
    {
      audience: 'admin',
      method: 'DELETE',
      path: '/users/:id',
      permission: ADMIN_PERMISSIONS.usersManage,
      summary: 'Delete a user and its sessions and tokens',
      tags: ['users'],
      audit: true,
      action: 'users.delete',
      handler: async ({ request }) => {
        await auth.deleteUser(request.params.id as string)
        return { deleted: true }
      },
    },
    {
      audience: 'admin',
      method: 'GET',
      path: '/users/:id/tokens',
      permission: ADMIN_PERMISSIONS.tokensManage,
      summary: 'List a user API tokens',
      tags: ['tokens'],
      handler: async ({ request }) => ({ items: await auth.listTokens(request.params.id as string) }),
    },
    {
      audience: 'admin',
      method: 'POST',
      path: '/users/:id/tokens',
      permission: ADMIN_PERMISSIONS.tokensManage,
      summary: 'Mint an API token; the secret is returned once',
      tags: ['tokens'],
      audit: true,
      action: 'tokens.create',
      input: createTokenBody,
      handler: async ({ request }) => {
        const body = request.body as zod.infer<typeof createTokenBody>
        return auth.createToken({ userId: request.params.id as string, name: body.name, scopes: body.scopes })
      },
    },
    {
      audience: 'admin',
      method: 'DELETE',
      path: '/tokens/:id',
      permission: ADMIN_PERMISSIONS.tokensManage,
      summary: 'Revoke an API token',
      tags: ['tokens'],
      audit: true,
      action: 'tokens.revoke',
      handler: async ({ request }) => {
        await auth.revokeToken(request.params.id as string)
        return { revoked: true }
      },
    },
  ]
}

/**
 * Plugin entry.
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

export { LocalAuth, resolveAuthConfig }
export type { AuthConfig, ResolvedAuthConfig }
