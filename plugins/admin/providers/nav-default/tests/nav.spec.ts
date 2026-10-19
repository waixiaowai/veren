/**
 * Navigation provider behavior: default contributions, permission filtering,
 * grouped ordering, duplicate-id conflicts, idempotent disposal and unload.
 *
 * 导航 provider 行为：默认贡献项、权限过滤、分组排序、重复 id 冲突、幂等释放与卸载。
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { AdminKernel } from '@veren/admin-kernel'
import {
  ADMIN_PERMISSIONS,
  AdminError,
  type AdminAccess,
  type AdminNavContribution,
  type AdminNavNode,
  type AuthenticatedPrincipal,
} from '@veren/admin-contract'
import { apply, DEFAULT_NAVIGATION } from '../src/index.ts'

/**
 * Register an access provider that grants exactly the principal's permissions.
 * 注册一个只授予主体自身权限的 access provider。
 */
function installAccess(ctx: Context): void {
  const access: AdminAccess = {
    permissions: () => Object.values(ADMIN_PERMISSIONS),
    roles: async () => [],
    permissionsOf: async () => [],
    rolesOf: async () => [],
    assignRole: async () => {},
    revokeRole: async () => {},
    can: (principal, permission) => principal.permissions.includes(permission),
  }
  ctx.admin.register(
    { id: 'test-access', capability: 'access', contract: '^1.0', priority: 0, label: 'Test access' },
    access,
  )
}

/** One wired test deployment. 一套已接线的测试部署。 */
interface Harness {
  /** Kernel context carrying every service. 携带全部服务的内核上下文。 */
  readonly ctx: Context
  /** Disposer returned by the plugin entry. 插件入口返回的 disposer。 */
  readonly dispose: () => void
}

/** Build a kernel, an access provider and the navigation plugin. 构造内核、access provider 与导航插件。 */
function setup(): Harness {
  const ctx = new Context()
  new AdminKernel(ctx, { essential: [] })
  installAccess(ctx)
  const dispose = apply(ctx)
  return { ctx, dispose }
}

/** Build a principal holding exactly the given permissions. 构造只持有指定权限的主体。 */
function principal(...permissions: string[]): AuthenticatedPrincipal {
  return { userId: 'u1', email: 'ada@example.test', name: 'Ada', roles: ['viewer'], scope: 'all', permissions }
}

/** Read the visible node ids for one principal. 读取某主体可见的节点 id。 */
async function idsFor(ctx: Context, ...permissions: string[]): Promise<readonly string[]> {
  return (await ctx.adminNavigation.tree(principal(...permissions))).map((node) => node.id)
}

/** A contribution owned by a module under test. 被测模块拥有的一条贡献项。 */
function contribution(id: string, overrides: Partial<AdminNavContribution> = {}): AdminNavContribution {
  return { id, labelKey: `nav.${id}`, path: `/${id}`, ...overrides }
}

describe('navigation defaults', () => {
  it('registers the capability and removes it on dispose', async () => {
    const { ctx, dispose } = setup()
    const all = Object.values(ADMIN_PERMISSIONS)

    expect(ctx.admin.has('navigation')).toBe(true)
    expect(await idsFor(ctx, ...all)).toEqual(['dashboard', 'users', 'roles', 'audit', 'capabilities'])

    dispose()

    expect(ctx.admin.has('navigation')).toBe(false)
    expect(() => ctx.adminNavigation.tree(principal(...all))).toThrow(AdminError)
  })

  it('projects nodes without a badge and keeps the declared label keys', async () => {
    const { ctx } = setup()
    const nodes = await ctx.adminNavigation.tree(principal(...Object.values(ADMIN_PERMISSIONS)))

    expect(nodes.map((node) => node.labelKey)).toEqual(DEFAULT_NAVIGATION.map((item) => item.labelKey))
    expect(nodes.map((node) => node.icon)).toEqual(['dashboard', 'users', 'shield', 'audit', 'capabilities'])
    for (const node of nodes as AdminNavNode[]) {
      expect('badge' in node).toBe(false)
    }
  })
})

describe('navigation permission filtering', () => {
  it('keeps only entries the principal may see, in order', async () => {
    const { ctx } = setup()

    expect(await idsFor(ctx, ADMIN_PERMISSIONS.dashboardRead)).toEqual(['dashboard'])
    expect(
      await idsFor(ctx, ADMIN_PERMISSIONS.dashboardRead, ADMIN_PERMISSIONS.auditRead, ADMIN_PERMISSIONS.capabilitiesRead),
    ).toEqual(['dashboard', 'audit', 'capabilities'])
    expect(await idsFor(ctx)).toEqual([])
  })
})

describe('navigation contributions', () => {
  it('rejects a duplicate id with CONFLICT', () => {
    const { ctx } = setup()
    expect(() => ctx.adminNavigation.register(contribution('dashboard'))).toThrow(AdminError)
    try {
      ctx.adminNavigation.register(contribution('dashboard'))
    } catch (error) {
      expect((error as AdminError).code).toBe('CONFLICT')
    }
  })

  it('returns an idempotent disposer that cannot remove a newer contribution', async () => {
    const { ctx } = setup()

    const first = ctx.adminNavigation.register(contribution('reports', { order: 25 }))
    expect(await idsFor(ctx)).toEqual(['reports'])
    first()
    first()
    expect(await idsFor(ctx)).toEqual([])

    const second = ctx.adminNavigation.register(contribution('reports'))
    first()
    expect(await idsFor(ctx)).toEqual(['reports'])
    second()
    expect(await idsFor(ctx)).toEqual([])
  })

  it('orders groups by first appearance and members by order then id', async () => {
    const { ctx } = setup()
    ctx.adminNavigation.register(contribution('beta-second', { group: 'beta', order: 20 }))
    ctx.adminNavigation.register(contribution('alpha-first', { group: 'alpha', order: 5 }))
    ctx.adminNavigation.register(contribution('beta-first', { group: 'beta', order: 10 }))
    ctx.adminNavigation.register(contribution('beta-tie-z', { group: 'beta', order: 30 }))
    ctx.adminNavigation.register(contribution('beta-tie-a', { group: 'beta', order: 30 }))

    expect(await idsFor(ctx)).toEqual([
      'beta-first',
      'beta-second',
      'beta-tie-a',
      'beta-tie-z',
      'alpha-first',
    ])
  })

  it('reports healthy', async () => {
    const { ctx } = setup()
    await expect(ctx.adminNavigation.health?.()).resolves.toEqual({ status: 'ok' })
  })
})
