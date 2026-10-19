/**
 * RBAC implementation of the `access` capability.
 *
 * Users are owned by `auth`; this provider owns the role catalog and the
 * user-to-role bindings. Permissions are always derived from bindings, so
 * hiding a menu is never what grants access: the gateway asks
 * {@link RbacAccess.can} on the server.
 *
 * `access` 能力的 RBAC 实现。用户由 `auth` 拥有；本 provider 拥有角色目录与用户到
 * 角色的绑定。权限始终由绑定推导，因此“隐藏菜单”从来不是授权手段：网关在服务端询问
 * {@link RbacAccess.can}。
 *
 * @module @veren/admin-access-rbac/provider
 */

import { AdminError, type AdminAccess, type AdminEntity, type AdminIdentity, type AdminRoleView, type AuthenticatedPrincipal, type HealthReport } from '@veren/admin-contract'
import type { Context } from '@deepseek-ai/cordis'
import { BUILT_IN_ROLES, builtInRole, isRoleId, OWNER_ROLE } from './roles.ts'

/** A stored custom role. 存储的自定义角色。 */
export interface RoleRecord extends AdminEntity {
  /** Display label. 显示名。 */
  readonly label: string
  /** Granted permissions. 授予的权限。 */
  readonly permissions: readonly string[]
  /** Creation instant. 创建时刻。 */
  readonly createdAt: string
}

/** A stored user-to-role binding; the id is `${userId}:${roleId}`. 存储的用户角色绑定；id 为 `${userId}:${roleId}`。 */
export interface BindingRecord extends AdminEntity {
  /** Bound user. 绑定的用户。 */
  readonly userId: string
  /** Bound role. 绑定的角色。 */
  readonly roleId: string
  /** Creation instant. 创建时刻。 */
  readonly createdAt: string
}

/** Collection holding custom roles. 存放自定义角色的集合。 */
const ROLES = 'admin_roles'

/** Collection holding user-to-role bindings. 存放用户角色绑定的集合。 */
const BINDINGS = 'admin_bindings'

/** The RBAC access provider. RBAC 授权 provider。 */
export class RbacAccess implements AdminAccess {
  /** Owning context, used to resolve data and audit lazily. 所属上下文，用于惰性解析数据与审计。 */
  private readonly ctx: Context

  /**
   * @param ctx - owning context 所属上下文
   */
  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /** @returns every permission string this deployment understands 本部署认识的全部权限串 */
  permissions(): readonly string[] {
    return [...new Set(BUILT_IN_ROLES.flatMap((role) => role.permissions))]
  }

  /** @returns built-in roles followed by stored custom roles 内置角色加上已存自定义角色 */
  async roles(): Promise<readonly AdminRoleView[]> {
    const builtIns: AdminRoleView[] = BUILT_IN_ROLES.map((role) => ({
      id: role.id,
      label: role.label,
      permissions: [...role.permissions],
      builtIn: true,
    }))
    const custom = this.rolesTable().list().map((record) => ({
      id: record.id,
      label: record.label,
      permissions: [...record.permissions],
      builtIn: false,
    }))
    return [...builtIns, ...custom.sort((a, b) => a.id.localeCompare(b.id))]
  }

  /**
   * Resolve effective permissions from the role ids already carried by an identity.
   *
   * @param identity - authenticated identity 已认证身份
   * @returns the union of the roles' permissions 各角色权限的并集
   */
  async permissionsOf(identity: AdminIdentity): Promise<readonly string[]> {
    const stored = new Map(this.rolesTable().list().map((record) => [record.id, record.permissions]))
    const granted = new Set<string>()
    for (const roleId of identity.roles) {
      const builtIn = builtInRole(roleId)
      const permissions = builtIn === undefined ? stored.get(roleId) ?? [] : builtIn.permissions
      for (const permission of permissions) granted.add(permission)
    }
    return [...granted]
  }

  /**
   * @param userId - target user 目标用户
   * @returns the role ids bound to the user 绑定到该用户的角色 id
   */
  async rolesOf(userId: string): Promise<readonly string[]> {
    return this.bindingsTable()
      .list()
      .filter((binding) => binding.userId === userId)
      .map((binding) => binding.roleId)
      .sort()
  }

  /**
   * Bind a role to a user. Binding an existing pair is a no-op.
   *
   * @param userId - target user 目标用户
   * @param roleId - role to bind 要绑定的角色
   */
  async assignRole(userId: string, roleId: string): Promise<void> {
    const known = builtInRole(roleId) !== undefined || this.rolesTable().find(roleId) !== undefined
    if (!known) throw new AdminError('NOT_FOUND', `unknown role '${roleId}'`, { roleId })
    const id = `${userId}:${roleId}`
    const existing = this.bindingsTable().find(id)
    if (existing !== undefined) return
    await this.bindingsTable().save({
      id,
      userId,
      roleId,
      createdAt: new Date().toISOString(),
    } satisfies BindingRecord)
  }

  /**
   * Remove a role binding, refusing to strip the last owner.
   *
   * @param userId - target user 目标用户
   * @param roleId - role to remove 要移除的角色
   * @throws AdminError `LAST_OWNER` when this would leave the deployment without an owner
   */
  async revokeRole(userId: string, roleId: string): Promise<void> {
    if (roleId === OWNER_ROLE) this.assertNotLastOwner(userId)
    await this.bindingsTable().remove(`${userId}:${roleId}`)
  }

  /**
   * Create one custom role.
   *
   * @param input - role id, label and permissions 角色 id、显示名与权限
   * @returns the created role 创建的角色
   */
  async createRole(input: { id: string; label: string; permissions: readonly string[] }): Promise<AdminRoleView> {
    if (!isRoleId(input.id)) throw new AdminError('VALIDATION_FAILED', `invalid role id '${input.id}'`)
    if (builtInRole(input.id) !== undefined) {
      throw new AdminError('CONFLICT', `'${input.id}' is a built-in role`, { roleId: input.id })
    }
    if (this.rolesTable().find(input.id) !== undefined) {
      throw new AdminError('CONFLICT', `role '${input.id}' already exists`, { roleId: input.id })
    }
    const unknown = input.permissions.filter((permission) => !this.permissions().includes(permission))
    if (unknown.length > 0) {
      throw new AdminError('VALIDATION_FAILED', `unknown permissions: ${unknown.join(', ')}`, { unknown })
    }
    const record: RoleRecord = {
      id: input.id,
      label: input.label,
      permissions: [...input.permissions],
      createdAt: new Date().toISOString(),
    }
    await this.rolesTable().save(record)
    return { id: record.id, label: record.label, permissions: [...record.permissions], builtIn: false }
  }

  /**
   * Delete one custom role and every binding that referenced it.
   *
   * @param roleId - role to delete 要删除的角色
   */
  async deleteRole(roleId: string): Promise<void> {
    if (builtInRole(roleId) !== undefined) {
      throw new AdminError('CONFLICT', `built-in role '${roleId}' cannot be deleted`, { roleId })
    }
    if (this.rolesTable().find(roleId) === undefined) {
      throw new AdminError('NOT_FOUND', `role '${roleId}' does not exist`, { roleId })
    }
    for (const binding of this.bindingsTable().list()) {
      if (binding.roleId === roleId) await this.bindingsTable().remove(binding.id)
    }
    await this.rolesTable().remove(roleId)
  }

  /**
   * @param principal - authenticated principal 已认证主体
   * @param permission - permission to test 要测试的权限
   * @returns whether the principal holds it 主体是否持有该权限
   */
  can(principal: AuthenticatedPrincipal, permission: string): boolean {
    return principal.permissions.includes(permission)
  }

  /** @returns the provider health verdict provider 健康结论 */
  async health(): Promise<HealthReport> {
    try {
      this.bindingsTable().size
      return { status: 'ok' }
    } catch (error) {
      return { status: 'down', detail: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Refuse to remove the owner role from the deployment's last owner.
   *
   * @param userId - user losing the owner role 将要失去所有者角色的用户
   * @throws AdminError `LAST_OWNER` when no other owner remains
   */
  private assertNotLastOwner(userId: string): void {
    const owners = this.bindingsTable().list().filter((binding) => binding.roleId === OWNER_ROLE)
    if (owners.length > 1) return
    if (owners.length === 1 && owners[0]?.userId === userId) {
      throw new AdminError('LAST_OWNER', 'the last owner role cannot be removed', { userId })
    }
  }

  /** @returns the custom-role collection 自定义角色集合 */
  private rolesTable() {
    return this.ctx.adminData.table<RoleRecord>(ROLES)
  }

  /** @returns the binding collection 绑定集合 */
  private bindingsTable() {
    return this.ctx.adminData.table<BindingRecord>(BINDINGS)
  }
}
