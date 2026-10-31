/**
 * The `access` capability: roles, permission resolution and role bindings.
 *
 * `access` 能力：角色、权限解析与角色绑定。
 *
 * @module @veren/admin-contract/access
 */

import type { HealthReport } from './index.ts'
import type { AdminIdentity, AuthenticatedPrincipal } from './identity.ts'

/** A role as the admin UI sees it. 管理界面看到的角色。 */
export interface AdminRoleView {
  /** Role id. 角色 id。 */
  readonly id: string
  /** Display label. 显示名。 */
  readonly label: string
  /** Granted permission strings. 授予的权限串。 */
  readonly permissions: readonly string[]
  /** Whether the role ships with the platform and cannot be deleted. 是否为平台内置、不可删除的角色。 */
  readonly builtIn: boolean
}

/**
 * The `access` capability: roles, permission resolution and role bindings.
 * Authorization is enforced server-side by the gateway, never by hiding UI.
 *
 * `access` 能力：角色、权限解析与角色绑定。授权由网关在服务端执行，绝不靠隐藏 UI。
 */
export interface AdminAccess {
  /**
   * The platform-wide permission catalog.
   * @returns every known permission string 全部已知权限串
   */
  permissions(): readonly string[]

  /**
   * Read the role directory.
   * @returns every role 全部角色
   */
  roles(): Promise<readonly AdminRoleView[]>

  /**
   * Resolve the permissions of one identity.
   * @param identity - the authenticated identity 已认证身份
   * @returns the effective permission strings 生效权限串
   */
  permissionsOf(identity: AdminIdentity): Promise<readonly string[]>

  /**
   * Resolve the role ids bound to one user.
   * @param userId - target user 目标用户
   * @returns the bound role ids 已绑定角色 id
   */
  rolesOf(userId: string): Promise<readonly string[]>

  /**
   * Bind one role to one user.
   * @param userId - target user 目标用户
   * @param roleId - role to bind 要绑定的角色
   */
  assignRole(userId: string, roleId: string): Promise<void>

  /**
   * Remove one role binding.
   * @param userId - target user 目标用户
   * @param roleId - role to remove 要移除的角色
   */
  revokeRole(userId: string, roleId: string): Promise<void>

  /**
   * Whether a principal holds one permission.
   * @param principal - the authenticated principal 已认证主体
   * @param permission - permission string 权限串
   * @returns true when permitted 有权限时为 true
   */
  can(principal: AuthenticatedPrincipal, permission: string): boolean

  /**
   * Probe the provider.
   * @returns the health verdict 健康结论
   */
  health?(): Promise<HealthReport>
}
