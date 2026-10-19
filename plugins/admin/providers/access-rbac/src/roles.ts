/**
 * Built-in roles and their permission sets.
 *
 * Built-in roles are code, not rows: a deployment cannot accidentally delete
 * `owner` and lock itself out, and an upgrade can widen a role's permissions
 * without a migration. Custom roles live in the database and are additive.
 *
 * 内置角色是代码而非数据行：部署无法误删 `owner` 把自己锁死，升级也能直接扩宽角色
 * 权限而无需迁移。自定义角色存放在数据库中，且只做叠加。
 *
 * @module @veren/admin-access-rbac/roles
 */

import { ADMIN_PERMISSIONS, type AdminPermission } from '@veren/admin-contract'

/** One built-in role declaration. 单个内置角色声明。 */
export interface BuiltInRole {
  /** Stable role id. 稳定角色 id。 */
  readonly id: string
  /** Display label. 显示名。 */
  readonly label: string
  /** Granted permissions. 授予的权限。 */
  readonly permissions: readonly AdminPermission[]
}

/** Every permission in the catalog, in declaration order. 目录中的全部权限，按声明顺序。 */
export const ALL_PERMISSIONS: readonly AdminPermission[] = Object.values(ADMIN_PERMISSIONS)

/** Role id reserved for the deployment owner; it can never be removed from the last owner. 部署所有者保留角色 id；绝不能从最后一位所有者身上移除。 */
export const OWNER_ROLE = 'owner'

/** The built-in role catalog, ordered from most to least privileged. 内置角色目录，按权限从高到低排序。 */
export const BUILT_IN_ROLES: readonly BuiltInRole[] = [
  {
    id: OWNER_ROLE,
    label: 'Owner',
    permissions: ALL_PERMISSIONS,
  },
  {
    id: 'admin',
    label: 'Administrator',
    permissions: [
      ADMIN_PERMISSIONS.dashboardRead,
      ADMIN_PERMISSIONS.usersManage,
      ADMIN_PERMISSIONS.rolesManage,
      ADMIN_PERMISSIONS.tokensManage,
      ADMIN_PERMISSIONS.auditRead,
      ADMIN_PERMISSIONS.capabilitiesRead,
      ADMIN_PERMISSIONS.settingsWrite,
    ],
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    permissions: [
      ADMIN_PERMISSIONS.dashboardRead,
      ADMIN_PERMISSIONS.auditRead,
      ADMIN_PERMISSIONS.terminalTasksRead,
      ADMIN_PERMISSIONS.terminalTasksDecide,
    ],
  },
  {
    id: 'operator',
    label: 'Operator',
    permissions: [
      ADMIN_PERMISSIONS.dashboardRead,
      ADMIN_PERMISSIONS.capabilitiesRead,
    ],
  },
  {
    id: 'auditor',
    label: 'Auditor',
    permissions: [
      ADMIN_PERMISSIONS.dashboardRead,
      ADMIN_PERMISSIONS.auditRead,
      ADMIN_PERMISSIONS.capabilitiesRead,
    ],
  },
  {
    id: 'viewer',
    label: 'Viewer',
    permissions: [ADMIN_PERMISSIONS.dashboardRead],
  },
]

/**
 * Look up a built-in role.
 *
 * @param roleId - role id 角色 id
 * @returns the declaration, or `undefined` for a custom role 声明；自定义角色为 `undefined`
 */
export function builtInRole(roleId: string): BuiltInRole | undefined {
  return BUILT_IN_ROLES.find((role) => role.id === roleId)
}

/**
 * Validate a role id: lowercase letters, digits and hyphens, 2-32 characters.
 *
 * @param roleId - candidate id 候选 id
 * @returns whether the id is well formed 是否格式正确
 */
export function isRoleId(roleId: string): boolean {
  return /^[a-z][a-z0-9-]{1,31}$/.test(roleId)
}
