import { describe, expect, it } from 'vitest'
import { DataSource } from '@veren/orm'
import '@veren/orm/driver/sqlite'
import { createOrmAdapter, createAuthEntities, getAuthTables } from '../src/index.ts'
import type { DBAdapter } from '../src/index.ts'

/** 独立内存库 + 适配器。 / An isolated in-memory database plus adapter. */
async function setup(): Promise<{ adapter: DBAdapter, dataSource: DataSource }> {
  const tables = getAuthTables({ rateLimitStorage: 'database' })
  const dataSource = new DataSource({ type: 'sqlite', entities: createAuthEntities(tables), synchronize: true })
  await dataSource.initialize()
  return { adapter: createOrmAdapter(dataSource, tables), dataSource }
}

describe('storage domain: update semantics (design 8.5 C1-C3)', () => {
  it('C1: update returns the updated row, then null once the condition stops matching', async () => {
    const { adapter } = await setup()
    await adapter.create({ model: 'verification', data: { id: 'v1', identifier: 'abc', value: 'init', expiresAt: new Date(Date.now() + 60_000) }, forceAllowId: true })
    const updated = await adapter.update({ model: 'verification', where: [{ field: 'identifier', value: 'abc' }], update: { value: 'x' } })
    expect(updated).not.toBeNull()
    expect((updated as Record<string, unknown>).value).toBe('x')
    const again = await adapter.update({ model: 'verification', where: [{ field: 'identifier', value: 'missing' }], update: { value: 'x' } })
    expect(again).toBeNull()
  })

  it('C2: a zero-match update inserts nothing', async () => {
    const { adapter } = await setup()
    const before = await adapter.count({ model: 'verification' })
    const result = await adapter.update({ model: 'verification', where: [{ field: 'identifier', value: 'ghost' }], update: { value: 'x' } })
    expect(result).toBeNull()
    expect(await adapter.count({ model: 'verification' })).toBe(before)
  })

  it('C3: an empty where clause refuses execution', async () => {
    const { adapter } = await setup()
    const result = await adapter.update({ model: 'verification', where: [], update: { value: 'x' } })
    expect(result).toBeNull()
    expect(await adapter.count({ model: 'verification' })).toBe(0)
  })
})

describe('storage domain: atomic primitives (design 8.5 C4/C5)', () => {
  it('C4: concurrent consumeOne has exactly one winner', async () => {
    const { adapter } = await setup()
    await adapter.create({ model: 'verification', data: { id: 'otp-1', identifier: 'otp-1', value: 'one-time', expiresAt: new Date(Date.now() + 60_000) }, forceAllowId: true })
    const [first, second] = await Promise.all([
      adapter.consumeOne({ model: 'verification', where: [{ field: 'identifier', value: 'otp-1' }] }),
      adapter.consumeOne({ model: 'verification', where: [{ field: 'identifier', value: 'otp-1' }] }),
    ])
    expect(first === null).not.toBe(second === null)
    expect(await adapter.count({ model: 'verification', where: [{ field: 'identifier', value: 'otp-1' }] })).toBe(0)
  })

  it('C5: incrementOne guards with its where; second call misses the guard', async () => {
    const { adapter } = await setup()
    await adapter.create({ model: 'rateLimit', data: { id: 'r1', key: 'ip|/path', count: 1, lastRequest: Date.now() }, forceAllowId: true })
    const first = await adapter.incrementOne({
      model: 'rateLimit',
      where: [{ field: 'key', value: 'ip|/path' }, { field: 'count', operator: 'gte', value: 1 }],
      increment: { count: 1 },
    })
    expect(first).not.toBeNull()
    expect((first as Record<string, unknown>).count).toBe(2)
    const second = await adapter.incrementOne({
      model: 'rateLimit',
      where: [{ field: 'key', value: 'ip|/path' }, { field: 'count', operator: 'gte', value: 99 }],
      increment: { count: 1 },
    })
    expect(second).toBeNull()
  })

  it('C5b: empty increment and set both empty throws', async () => {
    const { adapter } = await setup()
    await expect(adapter.incrementOne({ model: 'rateLimit', where: [{ field: 'key', value: 'k' }], increment: {} }))
      .rejects.toThrow(/non-empty `increment` or `set`/)
  })

  it('C4b: consumeOne on a missing row answers null', async () => {
    const { adapter } = await setup()
    const row = await adapter.consumeOne({ model: 'verification', where: [{ field: 'identifier', value: 'absent' }] })
    expect(row).toBeNull()
  })
})

describe('storage domain: table model merge (design 8.5 C8-C11)', () => {
  it('C8: later plugin fields win; disableMigration promotes', () => {
    const merged = getAuthTables({ rateLimitStorage: 'memory' }, [
      { shared: { modelName: 'shared', fields: { note: { type: 'string' } } } },
      { shared: { modelName: 'shared', fields: { note: { type: 'number' } }, disableMigrations: true } },
    ])
    expect(merged.shared?.fields.note.type).toBe('number')
    expect(merged.shared?.disableMigrations).toBe(true)
  })

  it('C9: identical index definitions dedupe', () => {
    const merged = getAuthTables({ rateLimitStorage: 'memory' }, [
      { shared: { modelName: 'shared', fields: { a: { type: 'string' } }, indexes: [{ fields: ['a'], unique: true }] } },
      { shared: { modelName: 'shared', fields: { a: { type: 'string' } }, indexes: [{ fields: ['a'], unique: true }] } },
    ])
    expect(merged.shared?.indexes).toHaveLength(1)
  })

  it('C10: secondary storage removes session; verification only with the store flag', () => {
    const tables = getAuthTables({ secondaryStorage: {}, rateLimitStorage: 'memory' })
    expect(tables.session).toBeUndefined()
    expect(tables.verification).toBeUndefined()
    const stored = getAuthTables({ secondaryStorage: {}, storeVerificationInDatabase: true, rateLimitStorage: 'memory' })
    expect(stored.verification).toBeDefined()
  })

  it('C11: rateLimit table appears only for database storage with the right fields', () => {
    const memory = getAuthTables({ rateLimitStorage: 'memory' })
    expect(memory.rateLimit).toBeUndefined()
    const database = getAuthTables({ rateLimitStorage: 'database' })
    expect(database.rateLimit?.fields.key.unique).toBe(true)
    expect(database.rateLimit?.fields.count.type).toBe('number')
    expect(database.rateLimit?.fields.lastRequest.type).toBe('number')
  })
})

describe('storage domain: transactions', () => {
  it('register-with-account rolls back wholly when the account write fails', async () => {
    const { adapter } = await setup()
    await expect(adapter.transaction(async (trx) => {
      await trx.create({ model: 'user', data: { id: 'u1', name: 'A', email: 'a@x.com', emailVerified: false, image: null }, forceAllowId: true })
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(await adapter.count({ model: 'user' })).toBe(0)
  })
})
