/**
 * Audit provider behavior: registration and disposal, append/trim, retention,
 * filtering, cursor paging and the HTTP route envelope.
 *
 * 审计 provider 行为：注册与释放、追加/裁剪、保留期、过滤、游标分页与 HTTP 路由信封。
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { AdminApi } from '@veren/admin-api-kernel'
import { AdminKernel } from '@veren/admin-kernel'
import {
  ADMIN_PERMISSIONS,
  AdminError,
  type AdminAuditEntry,
  type AdminDatabase,
  type AdminEntity,
  type AdminRoute,
  type AdminRouteContext,
  type AdminTable,
} from '@veren/admin-contract'
import { AUDIT_TABLE, apply, type Config } from '../src/index.ts'

/** Minimal in-memory collection implementing the data port's table contract. 实现数据端口表契约的最小内存集合。 */
class MemoryTable<T extends AdminEntity> implements AdminTable<T> {
  private readonly rows = new Map<string, T>()

  get size(): number {
    return this.rows.size
  }

  find(id: string): T | undefined {
    return this.rows.get(id)
  }

  list(): readonly T[] {
    return [...this.rows.values()]
  }

  async save(record: T): Promise<void> {
    this.rows.set(record.id, record)
  }

  async remove(id: string): Promise<boolean> {
    return this.rows.delete(id)
  }
}

/**
 * Register an in-memory `data` provider and hand back the audit collection.
 * 注册内存 `data` provider 并返回审计集合句柄。
 */
function installMemoryData(ctx: Context): AdminTable<AdminAuditEntry> {
  const tables = new Map<string, MemoryTable<AdminEntity>>()
  const work = {
    table<T extends AdminEntity>(name: string): AdminTable<T> {
      const table = tables.get(name) ?? new MemoryTable<AdminEntity>()
      tables.set(name, table)
      return table as unknown as AdminTable<T>
    },
  }
  const database: AdminDatabase = {
    features: { transactions: false, secondaryIndexes: false, fullText: false },
    table: work.table,
    transaction: async (unit) => unit(work),
    health: async () => ({ status: 'ok' }),
  }
  ctx.admin.register(
    { id: 'memory-data', capability: 'data', contract: '^1.0', priority: 0, label: 'In-memory data' },
    database,
  )
  return work.table<AdminAuditEntry>(AUDIT_TABLE)
}

/** One wired test deployment. 一套已接线的测试部署。 */
interface Harness {
  /** Kernel context carrying every service. 携带全部服务的内核上下文。 */
  readonly ctx: Context
  /** Handle on the audit collection. 审计集合句柄。 */
  readonly table: AdminTable<AdminAuditEntry>
  /** Disposer returned by the plugin entry. 插件入口返回的 disposer。 */
  readonly dispose: () => void
}

/**
 * Build a kernel, gateway, memory data provider and the audit plugin.
 * 构造内核、网关、内存数据 provider 与审计插件。
 */
function setup(config: Config = {}): Harness {
  const ctx = new Context()
  new AdminKernel(ctx, { essential: [] })
  new AdminApi(ctx, {})
  const table = installMemoryData(ctx)
  const dispose = apply(ctx, config)
  return { ctx, table, dispose }
}

/** One stored row at a fixed instant. 固定时刻的一条已存记录。 */
function row(id: string, at: string, overrides: Partial<AdminAuditEntry> = {}): AdminAuditEntry {
  return {
    id,
    at,
    actorId: 'u1',
    actorLabel: 'ada@example.test',
    action: 'users.update',
    result: 'success',
    ...overrides,
  }
}

/** An append payload for `record`. `record` 的追加载荷。 */
function input(overrides: Partial<Omit<AdminAuditEntry, 'id' | 'at'>> = {}): Omit<AdminAuditEntry, 'id' | 'at'> {
  return { actorId: 'u1', actorLabel: 'ada@example.test', action: 'users.update', result: 'success', ...overrides }
}

/** A route context carrying the given query string. 携带指定查询串的路由上下文。 */
function routeContext(query: Record<string, string> = {}): AdminRouteContext {
  return {
    request: {
      requestId: 'req-1',
      method: 'GET',
      path: '/audit',
      params: {},
      query: new URLSearchParams(query),
      headers: {},
      body: undefined,
      principal: undefined,
      audience: 'admin',
      ip: '127.0.0.1',
      cookie: () => undefined,
      header: () => undefined,
    },
    response: { setCookie: () => {}, clearCookie: () => {}, setHeader: () => {} },
  }
}

/** Require a next cursor from a page that must have one. 要求本页必须带下一页游标。 */
function requireCursor(page: { readonly nextCursor?: string }): string {
  if (page.nextCursor === undefined) throw new Error('expected a next cursor')
  return page.nextCursor
}

describe('audit registration', () => {
  it('registers the capability and route, then removes both on dispose', () => {
    const { ctx, dispose } = setup()

    expect(ctx.admin.has('audit')).toBe(true)
    expect(ctx.adminApi.routes().map((route) => route.path)).toEqual(['/audit'])

    dispose()

    expect(ctx.admin.has('audit')).toBe(false)
    expect(ctx.adminApi.routes()).toHaveLength(0)
    expect(() => ctx.adminAudit.list({})).toThrow(AdminError)
  })

  it('declares the audit route contract', () => {
    const { ctx } = setup()
    const route = ctx.adminApi.routes()[0] as AdminRoute

    expect(route).toMatchObject({
      audience: 'admin',
      method: 'GET',
      path: '/audit',
      permission: ADMIN_PERMISSIONS.auditRead,
      tags: ['audit'],
    })
    expect(route.query).toBeDefined()
  })
})

describe('audit retention', () => {
  it('appends generated ids and trims the oldest entries down to the cap', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, table } = setup({ maxEntries: 3, retentionDays: 3650 })
      const actions = ['a.one', 'b.two', 'c.three', 'd.four', 'e.five']
      for (const [index, action] of actions.entries()) {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, index)))
        await ctx.adminAudit.record(input({ action }))
      }

      expect(table.size).toBe(3)
      expect(table.list().map((entry) => entry.action).sort()).toEqual(['c.three', 'd.four', 'e.five'])
      for (const entry of table.list()) {
        expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
        expect(entry.at).toBe(new Date(entry.at).toISOString())
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops entries older than the retention window and keeps newer ones', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
      const { ctx, table } = setup({ maxEntries: 100, retentionDays: 30 })
      await table.save(row('old', '2026-01-01T00:00:00.000Z', { action: 'old.entry' }))
      await table.save(row('fresh', '2026-05-31T00:00:00.000Z', { action: 'fresh.entry' }))

      await ctx.adminAudit.record(input({ action: 'new.entry' }))

      expect(table.find('old')).toBeUndefined()
      expect(table.find('fresh')).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never drops a newer entry while keeping an older one', async () => {
    const { ctx, table } = setup({ maxEntries: 2, retentionDays: 3650 })
    await table.save(row('old-1', '2025-01-01T00:00:00.000Z', { action: 'old.one' }))
    await table.save(row('old-2', '2025-01-02T00:00:00.000Z', { action: 'old.two' }))
    await table.save(row('new-1', '2026-01-01T00:00:00.000Z', { action: 'new.one' }))
    await table.save(row('new-2', '2026-01-02T00:00:00.000Z', { action: 'new.two' }))

    await ctx.adminAudit.record(input({ action: 'trigger.trim' }))

    // The trigger row is the newest, so it survives together with `new.two`.
    // 触发记录是最新的，因此它与 `new.two` 一起保留。
    expect(table.size).toBe(2)
    expect(table.list().map((entry) => entry.action).sort()).toEqual(['new.two', 'trigger.trim'])
  })
})

describe('audit queries', () => {
  it('filters by actor, action prefix, result and inclusive time bounds', async () => {
    const { ctx, table } = setup({ maxEntries: 100 })
    await table.save(row('r1', '2026-01-01T00:00:00.000Z', { actorId: 'u1', action: 'auth.login', result: 'success' }))
    await table.save(row('r2', '2026-01-02T00:00:00.000Z', { actorId: 'u2', action: 'auth.login', result: 'failure' }))
    await table.save(row('r3', '2026-01-03T00:00:00.000Z', { actorId: 'u1', action: 'users.delete', result: 'denied' }))

    expect((await ctx.adminAudit.list({ actorId: 'u1' })).items.map((entry) => entry.id)).toEqual(['r3', 'r1'])
    expect((await ctx.adminAudit.list({ action: 'auth.' })).items.map((entry) => entry.id)).toEqual(['r2', 'r1'])
    expect((await ctx.adminAudit.list({ result: 'denied' })).items.map((entry) => entry.id)).toEqual(['r3'])
    const window = { since: '2026-01-02T00:00:00.000Z', until: '2026-01-02T23:59:59.000Z' }
    expect((await ctx.adminAudit.list(window)).items.map((entry) => entry.id)).toEqual(['r2'])
  })

  it('pages newest first with an opaque cursor', async () => {
    const { ctx, table } = setup({ maxEntries: 100 })
    for (let index = 0; index < 5; index += 1) {
      await table.save(row(`e${index}`, `2026-01-0${index + 1}T00:00:00.000Z`))
    }

    const first = await ctx.adminAudit.list({ limit: 2 })
    expect(first.items.map((entry) => entry.id)).toEqual(['e4', 'e3'])
    expect(first.nextCursor).toBeTypeOf('string')

    const second = await ctx.adminAudit.list({ limit: 2, cursor: requireCursor(first) })
    expect(second.items.map((entry) => entry.id)).toEqual(['e2', 'e1'])

    const third = await ctx.adminAudit.list({ limit: 2, cursor: requireCursor(second) })
    expect(third.items.map((entry) => entry.id)).toEqual(['e0'])
    expect(third.nextCursor).toBeUndefined()
  })

  it('rejects malformed cursors and invalid limits', async () => {
    const { ctx } = setup()
    await expect(ctx.adminAudit.list({ cursor: '***' })).rejects.toBeInstanceOf(AdminError)
    await expect(ctx.adminAudit.list({ limit: 0 })).rejects.toBeInstanceOf(AdminError)
    await expect(ctx.adminAudit.list({ since: 'yesterday' })).rejects.toBeInstanceOf(AdminError)
  })
})

describe('audit route', () => {
  it('returns the list envelope for GET /audit', async () => {
    const { ctx } = setup()
    await ctx.adminAudit.record(input({ action: 'roles.assign' }))
    const route = ctx.adminApi.routes()[0] as AdminRoute

    const payload = (await route.handler(routeContext({ action: 'roles.' }))) as {
      items: readonly AdminAuditEntry[]
      nextCursor?: string
    }

    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({ action: 'roles.assign', result: 'success' })
    expect(payload.nextCursor).toBeUndefined()
  })

  it('rejects invalid query strings through the declared schema', async () => {
    const { ctx } = setup()
    const route = ctx.adminApi.routes()[0] as AdminRoute
    await expect(route.handler(routeContext({ limit: 'zero' }))).rejects.toBeInstanceOf(AdminError)
  })
})
