/**
 * Local auth provider behavior: first-run setup, sign-in, session expiry, API
 * tokens and the anti-lockout rule that keeps the last owner in place.
 *
 * 本地认证 provider 行为：首次初始化、登录、会话过期、API token，以及保住最后一位
 * 所有者的防自锁规则。
 */

import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdminError, type AdminAccess, type AdminIdentity, type ProviderManifest } from '@veren/admin-contract'
import { AdminKernel } from '@veren/admin-kernel'
import { LocalAuth, resolveAuthConfig } from '../src/provider.ts'
import { authRoutes } from '../src/index.ts'
import type { BindingRecord } from '@veren/admin-access-rbac'

/** Manifest helper for the fake providers. 伪 provider 的清单辅助函数。 */
function manifest(id: string, capability: ProviderManifest['capability']): ProviderManifest {
  return { id, capability, contract: '^1.0', priority: 0, label: id }
}

/** In-memory tables shared by the fake data provider. 伪数据 provider 共享的内存表。 */
type Tables = Map<string, Map<string, { id: string }>>

/** Build one in-memory database over a table map. 在表映射上构建内存数据库。 */
function memoryDatabase(tables: Tables) {
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

/** Minimal in-memory RBAC provider used as the `access` capability. 作为 `access` 能力的最小内存 RBAC provider。 */
class MemoryAccess implements AdminAccess {
  /** userId to role ids. 用户到角色。 */
  readonly bindings = new Map<string, Set<string>>()

  permissions() {
    return ['admin.users.manage', 'admin.roles.manage', 'admin.audit.read']
  }

  async roles() {
    return []
  }

  async permissionsOf(identity: AdminIdentity) {
    return identity.roles.includes('owner') ? this.permissions() : ['admin.dashboard.read']
  }

  async rolesOf(userId: string) {
    return [...(this.bindings.get(userId) ?? new Set<string>())]
  }

  async assignRole(userId: string, roleId: string) {
    const roles = this.bindings.get(userId) ?? new Set<string>()
    roles.add(roleId)
    this.bindings.set(userId, roles)
  }

  async revokeRole(userId: string, roleId: string) {
    this.bindings.get(userId)?.delete(roleId)
  }

  can(principal: { permissions: readonly string[] }, permission: string) {
    return principal.permissions.includes(permission)
  }
}

describe('local auth provider', () => {
  let ctx: Context
  let auth: LocalAuth
  let access: MemoryAccess
  let tables: Tables

  beforeEach(() => {
    ctx = new Context()
    const kernel = new AdminKernel(ctx, { essential: [] })
    tables = new Map()
    access = new MemoryAccess()
    kernel.register(manifest('fake-data', 'data'), memoryDatabase(tables) as never)
    kernel.register(manifest('rbac', 'access'), access)
    auth = new LocalAuth(ctx, resolveAuthConfig({ sessionDays: 7, idleHours: 12, passwordMinLength: 8 }))
  })

  it('requires setup until the first administrator exists', async () => {
    expect(await auth.setupRequired()).toBe(true)
    await auth.setup({ email: 'Owner@Example.com', password: 'correct horse', name: 'Owner' })
    expect(await auth.setupRequired()).toBe(false)
    expect(await access.rolesOf((tables.get('admin_users') as Map<string, { id: string }>).keys().next().value as string))
      .toEqual(['owner'])
  })

  it('refuses a second setup', async () => {
    await auth.setup({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' })
    await expect(auth.setup({ email: 'other@example.com', password: 'correct horse', name: 'Other' }))
      .rejects.toMatchObject({ code: 'ALREADY_INITIALIZED' })
  })

  it('rejects a wrong password and an unknown email with the same error', async () => {
    await auth.setup({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' })
    await expect(auth.login({ email: 'owner@example.com', password: 'wrong horse' }))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    await expect(auth.login({ email: 'nobody@example.com', password: 'correct horse' }))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('opens a session that authenticates and stops after logout', async () => {
    const result = await auth.setup({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' })
    const identity = await auth.authenticate({ sessionId: result.sessionToken })
    expect(identity?.email).toBe('owner@example.com')
    expect(identity?.roles).toEqual(['owner'])

    await auth.logout(result.sessionToken)
    expect(await auth.authenticate({ sessionId: result.sessionToken })).toBeUndefined()
  })

  it('mints a token that authenticates and stops after revocation', async () => {
    const result = await auth.setup({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' })
    const created = await auth.createToken({ userId: result.principal.userId, name: 'cli', scopes: ['terminal.tasks.read'] })

    const identity = await auth.authenticate({ bearer: created.token })
    expect(identity?.tokenId).toBe(created.view.id)
    expect(identity?.scopes).toEqual(['terminal.tasks.read'])
    expect(await auth.authenticate({ bearer: 'adm_wrong' })).toBeUndefined()

    await auth.revokeToken(created.view.id)
    expect(await auth.authenticate({ bearer: created.token })).toBeUndefined()
  })

  it('enforces the password policy and email uniqueness', async () => {
    await auth.setup({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' })
    await expect(auth.createUser({ email: 'short@example.com', password: 'short', name: 'Short' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(auth.createUser({ email: 'owner@example.com', password: 'correct horse', name: 'Dup' }))
      .rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('resets a password and refuses a reset to the same value', async () => {
    await auth.setup({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' })
    const created = await auth.createUser({ email: 'alice@example.com', password: 'alice pass 1', name: 'Alice' })

    await auth.updateUser(created.id, { password: 'alice pass 2' })
    await expect(auth.login({ email: 'alice@example.com', password: 'alice pass 2' }))
      .resolves.toMatchObject({ principal: { email: 'alice@example.com' } })
    await expect(auth.login({ email: 'alice@example.com', password: 'alice pass 1' }))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' })

    // Same password as the stored one is a form mistake, not a reset.
    // 与已存口令相同属于表单笔误，而不是重置。
    await expect(auth.updateUser(created.id, { password: 'alice pass 2' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'UNCHANGED' } })

    // An omitted password keeps the current one, and the policy still applies to a
    // supplied one. 省略密码保持原值；提供密码时策略仍然生效。
    await auth.updateUser(created.id, { name: 'Alice Chen' })
    await expect(auth.login({ email: 'alice@example.com', password: 'alice pass 2' })).resolves.toBeTruthy()
    await expect(auth.updateUser(created.id, { password: 'short' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('changes the signed-in password, keeping the current session and revoking the others', async () => {
    const first = await auth.setup({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' })
    const second = await auth.login({ email: 'owner@example.com', password: 'correct horse' })
    const keepSessionId = first.session.id

    await expect(auth.changePassword(first.principal.userId, {
      currentPassword: 'wrong horse',
      newPassword: 'another horse 2',
      keepSessionId,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'WRONG_PASSWORD' } })

    await expect(auth.changePassword(first.principal.userId, {
      currentPassword: 'correct horse',
      newPassword: 'correct horse',
      keepSessionId,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'UNCHANGED' } })

    await expect(auth.changePassword(first.principal.userId, {
      currentPassword: 'correct horse',
      newPassword: 'short',
      keepSessionId,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'TOO_SHORT' } })

    const changed = await auth.changePassword(first.principal.userId, {
      currentPassword: 'correct horse',
      newPassword: 'another horse 2',
      keepSessionId,
    })
    expect(changed.revokedSessions).toBe(1)

    // The session that made the change survives; the other one is gone.
    // 发起改密的会话保留；另一个会话失效。
    expect(await auth.authenticate({ sessionId: first.sessionToken })).toBeDefined()
    expect(await auth.authenticate({ sessionId: second.sessionToken })).toBeUndefined()

    await expect(auth.login({ email: 'owner@example.com', password: 'correct horse' }))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    await expect(auth.login({ email: 'owner@example.com', password: 'another horse 2' }))
      .resolves.toMatchObject({ principal: { email: 'owner@example.com' } })
  })

  it('registers an audited self-service password route without a permission gate', () => {
    const routes = authRoutes(auth, resolveAuthConfig({ sessionDays: 7, idleHours: 12, passwordMinLength: 8 }))
    const route = routes.find((entry) => entry.method === 'POST' && entry.path === '/me/password')
    expect(route).toBeDefined()
    expect(route?.audience).toBe('admin')
    expect(route?.permission).toBeUndefined()
    expect(route?.audit).toBe(true)
    expect(route?.action).toBe('auth.changePassword')
  })

  it('refuses to delete the last owner', async () => {
    const result = await auth.setup({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' })
    await expect(auth.deleteUser(result.principal.userId)).rejects.toMatchObject({ code: 'LAST_OWNER' })
  })

  it('rate limits repeated sign-in attempts', async () => {
    await auth.setup({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' })
    const limited = new LocalAuth(ctx, resolveAuthConfig({ loginRateLimit: { window: 60, max: 2 } }))
    await expect(limited.login({ email: 'owner@example.com', password: 'a' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    await expect(limited.login({ email: 'owner@example.com', password: 'b' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    await expect(limited.login({ email: 'owner@example.com', password: 'c' })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('expires sessions past their absolute lifetime', async () => {
    const result = await auth.setup({ email: 'owner@example.com', password: 'correct horse', name: 'Owner' })
    const sessions = tables.get('admin_sessions') as Map<string, { id: string; expiresAt: string }>
    for (const session of sessions.values()) session.expiresAt = new Date(Date.now() - 1000).toISOString()
    expect(await auth.authenticate({ sessionId: result.sessionToken })).toBeUndefined()
    expect(sessions.size).toBe(0)
  })
})

describe('binding record shape', () => {
  it('keeps the access binding identity stable', () => {
    const binding: BindingRecord = { id: 'u1:owner', userId: 'u1', roleId: 'owner', createdAt: '2026-01-01T00:00:00.000Z' }
    expect(binding.id).toBe(`${binding.userId}:${binding.roleId}`)
    expect(AdminError).toBeTypeOf('function')
  })
})
