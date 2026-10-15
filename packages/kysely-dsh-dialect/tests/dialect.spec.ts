/**
 * Round-trip tests: Kysely query building -> our compiler -> executor -> an
 * in-memory KvTable fake. Also covers fail-loud behavior for unsupported
 * shapes. Tests must be concurrency-safe: every case builds its own tables.
 * 往返测试：Kysely 构建查询 -> 我们的编译器 -> 执行器 -> 内存 KvTable 替身。同时
 * 覆盖不受支持形态的显式失败。测试必须并发安全：每个用例自建表。
 * @module tests/dialect
 */
import { describe, expect, it } from 'vitest'
import { Kysely, type Dialect, type DialectAdapter } from 'kysely'
import { executeInstruction } from '../src/executor.js'
import { createDomainDialect } from '../src/dialect.js'
import { DialectError, type DshDomainLike, type Instruction } from '../src/types.js'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'

/** Minimal in-memory KvTable over a Map, matching the domain's semantics. 基于 Map 的最小内存 KvTable，语义对齐 domain。 */
function fakeTable(): KvTable<string, unknown> {
  const rows = new Map<string, unknown>()
  return {
    get: key => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    put: async (key, value) => {
      rows.set(key, structuredClone(value))
    },
    delete: async key => rows.delete(key),
    update: async (key, fn) => {
      const next = fn(rows.get(key)!)
      rows.set(key, next)
      return next
    },
  }
}

/** Domain fake: tables created on demand, unknown names fail loud. Domain 替身：按需建表，未知名称显式失败。 */
function fakeDomain(known: readonly string[]): DshDomainLike {
  const tables = new Map<string, KvTable<string, unknown>>()
  return {
    table(name: string) {
      if (!known.includes(name)) throw new Error(`unknown table: ${name}`)
      let table = tables.get(name)
      if (table === undefined) {
        table = fakeTable()
        tables.set(name, table)
      }
      return table
    },
  }
}

/** User shape for typed Kysely handles in the tests. 测试中类型化 Kysely 句柄的用户形状。 */
interface UserRow {
  id: string
  email: string
  name: string
  age: number
  createdAt: string
}

type AuthDb = { user: UserRow }

function makeDb(known: readonly string[] = ['user']): Kysely<AuthDb> & { domain: DshDomainLike } {
  const domain = fakeDomain(known)
  const dialect: Dialect = createDomainDialect(domain, known)
  const db = new Kysely<AuthDb>({ dialect })
  return Object.assign(db, { domain })
}

async function seedUser(db: Kysely<AuthDb>, user: Partial<UserRow> & { id: string }): Promise<void> {
  await db.insertInto('user').values({
    email: 'seed@example.com',
    name: 'Seed',
    age: 30,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...user,
  } as UserRow).execute()
}

describe('DomainStorageDialect', () => {
  it('inserts and selects rows back through the domain table', async () => {
    const db = makeDb()
    await seedUser(db, { id: 'u1', email: 'a@example.com', name: 'Alice', age: 31 })
    const rows = await db.selectFrom('user').selectAll().execute()
    expect(rows).toEqual([{
      id: 'u1', email: 'a@example.com', name: 'Alice', age: 31, createdAt: '2026-01-01T00:00:00.000Z',
    }])
  })

  it('filters with AND, OR and operators', async () => {
    const db = makeDb()
    await seedUser(db, { id: 'u1', email: 'a@example.com', name: 'Alice', age: 31 })
    await seedUser(db, { id: 'u2', email: 'b@example.com', name: 'Bob', age: 25 })
    await seedUser(db, { id: 'u3', email: 'c@example.com', name: 'Cara', age: 40 })
    const byAge = await db.selectFrom('user').selectAll().where('age', '>=', 30).execute()
    expect(byAge.map(r => r.id)).toEqual(['u1', 'u3'])
    const orSet = await db.selectFrom('user').selectAll()
      .where(eb => eb.or([eb('age', '=', 25), eb('name', '=', 'Cara')])).execute()
    expect(orSet.map(r => r.id).sort()).toEqual(['u2', 'u3'])
    const inSet = await db.selectFrom('user').selectAll().where('id', 'in', ['u1', 'u3']).execute()
    expect(inSet.map(r => r.id).sort()).toEqual(['u1', 'u3'])
  })

  it('supports insensitive contains via lower()/like', async () => {
    const db = makeDb()
    await seedUser(db, { id: 'u1', email: 'Alice@Example.com' })
    const rows = await db.selectFrom('user').selectAll()
      .where(eb => eb(eb.fn('lower', ['email']), 'like', '%alice@%')).execute()
    expect(rows.map(r => r.id)).toEqual(['u1'])
  })

  it('sorts, paginates and projects', async () => {
    const db = makeDb()
    await seedUser(db, { id: 'u1', age: 10 })
    await seedUser(db, { id: 'u2', age: 20 })
    await seedUser(db, { id: 'u3', age: 30 })
    const page = await db.selectFrom('user')
      .select(['id', 'age'])
      .orderBy('age', 'desc')
      .limit(2)
      .offset(1)
      .execute()
    expect(page).toEqual([{ id: 'u2', age: 20 }, { id: 'u1', age: 10 }])
  })

  it('updates with affected counts and deletes rows', async () => {
    const db = makeDb()
    await seedUser(db, { id: 'u1' })
    await seedUser(db, { id: 'u2' })
    const result = await db.updateTable('user').set({ name: 'Renamed' }).where('id', '=', 'u1').execute()
    // Kysely maps the driver's numAffectedRows onto numUpdatedRows for update.
    // Kysely 在 update 上把驱动的 numAffectedRows 映射为 numUpdatedRows。
    expect(Number(result[0]!.numUpdatedRows)).toBe(1)
    await db.deleteFrom('user').where('id', '=', 'u2').execute()
    const left = await db.selectFrom('user').selectAll().execute()
    expect(left.map(r => r.id)).toEqual(['u1'])
    expect(left[0]!['name']).toBe('Renamed')
  })

  it('insert with returning returns the stored row', async () => {
    const db = makeDb()
    const rows = await db.insertInto('user')
      .values({ id: 'u9', email: 'x@x.com', name: 'X', age: 1, createdAt: 'now' })
      .returningAll()
      .execute()
    expect(rows).toEqual([{ id: 'u9', email: 'x@x.com', name: 'X', age: 1, createdAt: 'now' }])
  })

  it('introspector reports declared tables with derived columns', async () => {
    const db = makeDb(['user'])
    await seedUser(db, { id: 'u1' })
    const tables = await db.introspection.getTables()
    expect(tables.map(t => t.name)).toEqual(['user'])
    expect(tables[0]!.columns.map(c => c.name)).toContain('id')
  })

  it('fails loud on unknown tables', async () => {
    const db = makeDb(['user'])
    await expect(executeInstruction(db.domain, { v: 1, op: 'select', from: 'ghost' } satisfies Instruction))
      .rejects.toThrow('unknown table')
  })

  it('rejects inserts without a string id', async () => {
    const db = makeDb()
    await expect(executeInstruction(db.domain, {
      v: 1, op: 'insert', from: 'user', values: { email: 'no-id@example.com' },
    } satisfies Instruction)).rejects.toBeInstanceOf(DialectError)
  })

  it('adapter profile reports single connection and returning support', () => {
    const dialect: Dialect = createDomainDialect(fakeDomain([]), [])
    const adapter: DialectAdapter = dialect.createAdapter()
    expect(adapter.supportsMultipleConnections).toBe(false)
    expect(adapter.supportsReturning).toBe(true)
    expect(adapter.supportsTransactionalDdl).toBe(false)
  })
})
