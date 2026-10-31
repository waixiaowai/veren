/**
 * HTTP routes of the RBAC provider.
 *
 * Every write is audited and permission-gated; role changes are the operations
 * most likely to be challenged later, so they carry an explicit `action` name.
 *
 * RBAC provider 的 HTTP 路由。每次写入都有审计与权限门禁；角色变更最可能在事后被
 * 追问，因此带有明确的 `action` 名。
 *
 * @module @veren/admin-access-rbac/routes
 */

import { z } from 'zod'
import { ADMIN_PERMISSIONS, type AdminRoute } from '@veren/admin-contract'
import type { RbacAccess } from './provider.ts'

/** Body of a role creation request. 创建角色请求体。 */
const createRoleBody = z.object({
  id: z.string().min(2).max(32),
  label: z.string().min(1).max(80),
  permissions: z.array(z.string()).default([]),
})

/** Body of a role update request; the id travels in the path. 更新角色请求体；id 走路径。 */
const updateRoleBody = z.object({
  label: z.string().min(1).max(80).optional(),
  permissions: z.array(z.string()).optional(),
})

/** Body of a role binding request. 角色绑定请求体。 */
const bindRoleBody = z.object({
  roleId: z.string().min(1),
})

/**
 * Build the routes this provider registers.
 *
 * @param access - the provider instance provider 实例
 * @returns the routes to register 要注册的路由
 */
export function accessRoutes(access: RbacAccess): AdminRoute[] {
  return [
    listRolesRoute(access),
    listPermissionsRoute(access),
    createRoleRoute(access),
    updateRoleRoute(access),
    deleteRoleRoute(access),
    assignRoleRoute(access),
    revokeRoleRoute(access),
  ]
}

/** GET /roles：角色清单（含各自权限）。GET /roles: the role list with each role's permissions. */
function listRolesRoute(access: RbacAccess): AdminRoute {
  return {
    audience: 'admin',
    method: 'GET',
    path: '/roles',
    permission: ADMIN_PERMISSIONS.rolesManage,
    summary: 'List roles with their permissions',
    tags: ['access'],
    handler: async () => ({ items: await access.roles() }),
  }
}

/** GET /permissions：权限目录。GET /permissions: the permission catalog. */
function listPermissionsRoute(access: RbacAccess): AdminRoute {
  return {
    audience: 'admin',
    method: 'GET',
    path: '/permissions',
    permission: ADMIN_PERMISSIONS.capabilitiesRead,
    summary: 'List the permission catalog',
    tags: ['access'],
    handler: () => ({ items: access.permissions() }),
  }
}

/** POST /roles：创建自定义角色（审计）。POST /roles: create a custom role (audited). */
function createRoleRoute(access: RbacAccess): AdminRoute {
  return {
    audience: 'admin',
    method: 'POST',
    path: '/roles',
    permission: ADMIN_PERMISSIONS.rolesManage,
    summary: 'Create a custom role',
    tags: ['access'],
    action: 'roles.create',
    audit: true,
    input: createRoleBody,
    handler: async ({ request }) => {
      const body = request.body as z.infer<typeof createRoleBody>
      return access.createRole(body)
    },
  }
}

/** PATCH /roles/:id：更新自定义角色的标签或权限（审计）。PATCH /roles/:id: update a custom role's label or permissions (audited). */
function updateRoleRoute(access: RbacAccess): AdminRoute {
  return {
    audience: 'admin',
    method: 'PATCH',
    path: '/roles/:id',
    permission: ADMIN_PERMISSIONS.rolesManage,
    summary: 'Update a custom role label or permissions',
    tags: ['access'],
    action: 'roles.update',
    audit: true,
    input: updateRoleBody,
    handler: async ({ request }) => {
      const body = request.body as z.infer<typeof updateRoleBody>
      return access.updateRole(request.params.id as string, body)
    },
  }
}

/** DELETE /roles/:id：删除自定义角色（审计）。DELETE /roles/:id: delete a custom role (audited). */
function deleteRoleRoute(access: RbacAccess): AdminRoute {
  return {
    audience: 'admin',
    method: 'DELETE',
    path: '/roles/:id',
    permission: ADMIN_PERMISSIONS.rolesManage,
    summary: 'Delete a custom role',
    tags: ['access'],
    action: 'roles.delete',
    audit: true,
    handler: async ({ request }) => {
      await access.deleteRole(request.params.id as string)
      return { deleted: true }
    },
  }
}

/** POST /users/:id/roles：给用户绑定角色（审计）。POST /users/:id/roles: bind a role to a user (audited). */
function assignRoleRoute(access: RbacAccess): AdminRoute {
  return {
    audience: 'admin',
    method: 'POST',
    path: '/users/:id/roles',
    permission: ADMIN_PERMISSIONS.rolesManage,
    summary: 'Bind a role to a user',
    tags: ['access'],
    action: 'roles.assign',
    audit: true,
    input: bindRoleBody,
    handler: async ({ request }) => {
      const body = request.body as z.infer<typeof bindRoleBody>
      await access.assignRole(request.params.id as string, body.roleId)
      return { roles: await access.rolesOf(request.params.id as string) }
    },
  }
}

/** DELETE /users/:id/roles/:roleId：移除用户的角色绑定（审计）。DELETE /users/:id/roles/:roleId: remove a role binding from a user (audited). */
function revokeRoleRoute(access: RbacAccess): AdminRoute {
  return {
    audience: 'admin',
    method: 'DELETE',
    path: '/users/:id/roles/:roleId',
    permission: ADMIN_PERMISSIONS.rolesManage,
    summary: 'Remove a role binding from a user',
    tags: ['access'],
    action: 'roles.revoke',
    audit: true,
    handler: async ({ request }) => {
      await access.revokeRole(request.params.id as string, request.params.roleId as string)
      return { roles: await access.rolesOf(request.params.id as string) }
    },
  }
}
