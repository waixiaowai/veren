/**
 * Directory-management surface of the auth-local provider: the user directory
 * and per-user API tokens.
 *
 * auth-local provider 的目录管理面：用户目录与逐用户的 API token。
 *
 * @module @veren/admin-auth-local/directory-routes
 */

import { ADMIN_PERMISSIONS, type AdminRoute } from '@veren/admin-contract'
import type { LocalAuth } from './local-auth.ts'
import { createTokenBody, createUserBody, updateUserBody } from './route-bodies.ts'
import { z as zod } from 'zod'

/** `GET /users` — list users with their bound roles. 列出用户及其绑定角色。 */
function listUsersRoute(auth: LocalAuth): AdminRoute {
  return {
    audience: 'admin',
    method: 'GET',
    path: '/users',
    permission: ADMIN_PERMISSIONS.usersManage,
    summary: 'List users with their roles',
    tags: ['users'],
    handler: async () => ({ items: await auth.listUsers() }),
  }
}

/** `POST /users` — create a user. 创建用户。 */
function createUserRoute(auth: LocalAuth): AdminRoute {
  return {
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
  }
}

/** `PATCH /users/:id` — update one user. 更新单个用户。 */
function updateUserRoute(auth: LocalAuth): AdminRoute {
  return {
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
  }
}

/** `DELETE /users/:id` — delete a user and its sessions and tokens. 删除用户及其会话与 token。 */
function deleteUserRoute(auth: LocalAuth): AdminRoute {
  return {
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
  }
}

/** `GET /users/:id/tokens` — list a user's API tokens. 列出用户的 API token。 */
function listTokensRoute(auth: LocalAuth): AdminRoute {
  return {
    audience: 'admin',
    method: 'GET',
    path: '/users/:id/tokens',
    permission: ADMIN_PERMISSIONS.tokensManage,
    summary: 'List a user API tokens',
    tags: ['tokens'],
    handler: async ({ request }) => ({ items: await auth.listTokens(request.params.id as string) }),
  }
}

/** `POST /users/:id/tokens` — mint an API token; the secret is returned once. 签发 API token；密钥只返回一次。 */
function createTokenRoute(auth: LocalAuth): AdminRoute {
  return {
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
  }
}

/** `DELETE /tokens/:id` — revoke an API token. 吊销一个 API token。 */
function revokeTokenRoute(auth: LocalAuth): AdminRoute {
  return {
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
  }
}

/**
 * Build the directory-management routes.
 *
 * @param auth - the provider instance provider 实例
 * @returns the routes to register 要注册的路由
 */
export function directoryRoutes(auth: LocalAuth): AdminRoute[] {
  return [
    listUsersRoute(auth),
    createUserRoute(auth),
    updateUserRoute(auth),
    deleteUserRoute(auth),
    listTokensRoute(auth),
    createTokenRoute(auth),
    revokeTokenRoute(auth),
  ]
}
