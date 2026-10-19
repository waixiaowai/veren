/**
 * RBAC behavior: permission resolution, role bindings, custom roles and the
 * anti-lockout rule.
 *
 * RBAC 行为：权限解析、角色绑定、自定义角色与防自锁规则。
 */

import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_PERMISSIONS, type AdminIdentity, type ProviderManifest } from '@veren/admin-contract'
import { AdminKernel } from '@veren/admin-kernel'
import { RbacAccess } from '../src/provider.ts'
import { accessRoutes } from '../src/routes.ts'
import { BUILT_IN_ROLES, OWNER_ROLE } from '../src/roles.ts'

/** Manifest helper for the fake data provider. 伪数据 provider 的清单辅助函数。 */
function manifest(id: string, capability: ProviderManifest['capability']): ProviderManifest {
  return { id, capability, contract: '^1.0', priority: 0, label: id }
}

/** Build one in-memory database. 构建一个内存数据库。 */
function memoryDatabase() {
  const tables = new Map<string, Map<string, { id: string }>>()
  const table = (name: string) => {
    const rows = tables.get(name) ?? new Map<string, { id: string }>()
    tables.set(name, rows)
    return {
      find: (id: string) => rows.get(id),
      list: () => [...rows.values()],
      save: async (record: { id: string }) => {
        rows.set(record.id, record)
      },
      remove: async (id: string) => rows.delete(id),
      size: rows.size,
    }
  }
  return {
    features: { transactions: false, secondaryIndexes: false, fullText: false },
    table,
    transaction: async (work: (uow: { table: typeof table }) => Promise<unknown>) => work({ table }),
    health: async () => ({ status: 'ok' as const }),
  }
}

/** Build the identity a user has once roles are bound. 构建用户绑定角色后的身份。 */
function identity(userId: string, roles: readonly string[]): AdminIdentity {
  return { userId, email: `${userId}@example.com`, name: userId, roles, scope: 'all' }
}

describe('RBAC access provider', () => {
  let ctx: Context
  let access: RbacAccess

  beforeEach(() => {
    ctx = new Context()
    const kernel = new AdminKernel(ctx, { essential: [] })
    kernel.register(manifest('fake-data', 'data'), memoryDatabase() as never)
    access = new RbacAccess(ctx)
  })

  it('ships the built-in role catalog with owner holding every permission', async () => {
    const roles = await access.roles()
    expect(roles.map((role) => role.id)).toEqual(BUILT_IN_ROLES.map((role) => role.id))
    const owner = roles.find((role) => role.id === OWNER_ROLE)
    expect(owner?.builtIn).toBe(true)
    expect(owner?.permissions).toEqual(expect.arrayContaining([ADMIN_PERMISSIONS.usersManage]))
  })

  it('binds and unbinds roles per user', async () => {
    await access.assignRole('u1', 'auditor')
    await access.assignRole('u1', 'viewer')
    expect(await access.rolesOf('u1')).toEqual(['auditor', 'viewer'])

    await access.revokeRole('u1', 'viewer')
    expect(await access.rolesOf('u1')).toEqual(['auditor'])
  })

  it('is idempotent when a binding already exists', async () => {
    await access.assignRole('u1', 'viewer')
    await access.assignRole('u1', 'viewer')
    expect(await access.rolesOf('u1')).toEqual(['viewer'])
  })

  it('refuses an unknown role and a non-owner binding with no owner at all', async () => {
    await expect(access.assignRole('u1', 'ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(access.revokeRole('u1', OWNER_ROLE)).resolves.toBeUndefined()
  })

  it('resolves the union of permissions across roles', async () => {
    const permissions = await access.permissionsOf(identity('u1', ['auditor', 'operator']))
    expect(permissions).toEqual(expect.arrayContaining([
      ADMIN_PERMISSIONS.dashboardRead,
      ADMIN_PERMISSIONS.auditRead,
      ADMIN_PERMISSIONS.capabilitiesRead,
    ]))
    expect(permissions).not.toContain(ADMIN_PERMISSIONS.usersManage)
  })

  it('creates and deletes custom roles, refusing built-ins and unknown permissions', async () => {
    const created = await access.createRole({ id: 'support', label: 'Support', permissions: [ADMIN_PERMISSIONS.dashboardRead] })
    expect(created.builtIn).toBe(false)
    expect((await access.roles()).some((role) => role.id === 'support')).toBe(true)

    await expect(access.createRole({ id: 'owner', label: 'X', permissions: [] })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(access.createRole({ id: 'bad id', label: 'X', permissions: [] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(access.createRole({ id: 'ghostly', label: 'X', permissions: ['admin.nope'] }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    await access.assignRole('u2', 'support')
    await access.deleteRole('support')
    expect(await access.rolesOf('u2')).toEqual([])
    await expect(access.deleteRole(OWNER_ROLE)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('updates a custom role and refuses built-ins with a stable code', async () => {
    await access.createRole({ id: 'support', label: 'Support', permissions: [ADMIN_PERMISSIONS.dashboardRead] })

    const updated = await access.updateRole('support', {
      label: 'Support desk',
      permissions: [ADMIN_PERMISSIONS.dashboardRead, ADMIN_PERMISSIONS.auditRead],
    })
    expect(updated.label).toBe('Support desk')
    expect(updated.permissions).toEqual([ADMIN_PERMISSIONS.dashboardRead, ADMIN_PERMISSIONS.auditRead])
    expect(updated.builtIn).toBe(false)

    // A label-only patch keeps the stored permissions. 只改显示名时保留已存权限。
    const renamed = await access.updateRole('support', { label: 'Help desk' })
    expect(renamed.permissions).toEqual([ADMIN_PERMISSIONS.dashboardRead, ADMIN_PERMISSIONS.auditRead])

    const listed = (await access.roles()).find((role) => role.id === 'support')
    expect(listed?.label).toBe('Help desk')

    await expect(access.updateRole(OWNER_ROLE, { label: 'X' }))
      .rejects.toMatchObject({ code: 'CONFLICT', details: { builtIn: true } })
    await expect(access.updateRole('ghost', { label: 'X' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(access.updateRole('support', { permissions: ['admin.nope'] }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('refuses to strip the owner role from the last owner', async () => {
    await access.assignRole('u1', OWNER_ROLE)
    await expect(access.revokeRole('u1', OWNER_ROLE)).rejects.toMatchObject({ code: 'LAST_OWNER' })

    await access.assignRole('u2', OWNER_ROLE)
    await expect(access.revokeRole('u1', OWNER_ROLE)).resolves.toBeUndefined()
  })

  it('checks permissions from the resolved principal', () => {
    expect(access.can({ ...identity('u1', ['owner']), permissions: [ADMIN_PERMISSIONS.auditRead] }, ADMIN_PERMISSIONS.auditRead)).toBe(true)
    expect(access.can({ ...identity('u1', ['viewer']), permissions: [] }, ADMIN_PERMISSIONS.auditRead)).toBe(false)
  })

  it('registers permission-gated, audited routes', () => {
    const routes = accessRoutes(access)
    expect(routes.some((route) => route.path === '/roles' && route.method === 'POST')).toBe(true)
    for (const route of routes.filter((entry) => entry.method !== 'GET')) {
      expect(route.permission).toBe(ADMIN_PERMISSIONS.rolesManage)
      expect(route.audit).toBe(true)
    }
  })
})
