/**
 * SQL store behavior over a recording pool: loading and decoding, schema
 * bootstrap, transaction boundaries, health, and schema-name validation.
 *
 * 鍦ㄨ褰曞瀷杩炴帴姹犱笂鐨?SQL 瀛樺偍琛屼负锛氬姞杞戒笌瑙ｇ爜銆乻chema 寮曞銆佷簨鍔¤竟鐣屻€佸仴搴蜂笌 schema 鍚? * 鏍￠獙銆? */

import { describe, expect, it } from 'vitest'
import type { AdminEntity } from '@veren/admin-contract'
import { assertSchemaName, createSqlRecordStore, ensureSchema } from '../src/store.ts'
import { FakeSqlPool } from './fake-sql.ts'

describe('loading', () => {
  it('decodes platform rows and groups fallback rows by collection', async () => {
    const pool = new FakeSqlPool()
    pool.handler = (sql) => {
      if (sql.includes('"veren_users"')) {
        return { rows: [{ data: { id: 'u1', email: 'a@b.c' } }, { data: '{"id":"u2","email":"d@e.f"}' }], rowCount: 2 }
      }
      if (sql.includes('"veren_records"')) {
        return { rows: [{ collection: 'notes', data: { id: 'n1', text: 'x' } }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }

    const loaded = await createSqlRecordStore(pool).loadAll()
    expect(loaded.get('admin_users')?.map((record) => record.id)).toEqual(['u1', 'u2'])
    expect(loaded.get('notes')).toEqual([{ id: 'n1', text: 'x' }])
    expect(loaded.get('admin_sessions')).toEqual([])
  })

  it('fails loud on a document without a string id', async () => {
    const pool = new FakeSqlPool()
    pool.handler = (sql) => (sql.includes('"veren_users"') ? { rows: [{ data: { email: 'a@b.c' } }], rowCount: 1 } : { rows: [], rowCount: 0 })

    await expect(createSqlRecordStore(pool).loadAll()).rejects.toThrow(/veren_users.*string 'id'/)
  })

  it('fails loud on a fallback row without a collection', async () => {
    const pool = new FakeSqlPool()
    pool.handler = (sql) => (sql.includes('"veren_records"') ? { rows: [{ data: { id: 'n1' } }], rowCount: 1 } : { rows: [], rowCount: 0 })

    await expect(createSqlRecordStore(pool).loadAll()).rejects.toThrow(/string 'collection'/)
  })
})

describe('schema bootstrap', () => {
  it('creates the schema and every table on one connection inside a transaction', async () => {
    const pool = new FakeSqlPool()
    await ensureSchema(pool, 'veren_it')

    expect(pool.queries[0]?.sql).toBe('BEGIN')
    expect(pool.queries[1]?.sql).toContain('pg_advisory_xact_lock')
    expect(pool.queries[2]?.sql).toContain('FROM pg_namespace')
    expect(pool.queries[3]?.sql).toBe('CREATE SCHEMA "veren_it"')
    expect(pool.queries.some((query) => query.sql.includes('CREATE TABLE IF NOT EXISTS "veren_users"'))).toBe(true)
    expect(pool.queries.some((query) => query.sql.includes('CREATE TABLE IF NOT EXISTS "veren_records"'))).toBe(true)
    expect(pool.queries.at(-1)?.sql).toBe('COMMIT')
    expect(pool.releases).toBe(1)
  })

  it('rolls back and reports the bootstrap failure', async () => {
    const pool = new FakeSqlPool()
    pool.handler = (sql) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS "veren_users"')) throw new Error('permission denied')
      return { rows: [], rowCount: 0 }
    }

    await expect(ensureSchema(pool)).rejects.toThrow(/schema bootstrap failed: permission denied/)
    expect(pool.queries.at(-1)?.sql).toBe('ROLLBACK')
    expect(pool.releases).toBe(1)
  })

  it('rejects a schema name that could escape its identifier position', async () => {
    expect(() => { assertSchemaName('public') }).not.toThrow()
    expect(() => { assertSchemaName('veren_it_01') }).not.toThrow()
    expect(() => { assertSchemaName('public; DROP SCHEMA public') }).toThrow(/config\.schema/)
    expect(() => { assertSchemaName('Veren') }).toThrow(/config\.schema/)
  })
})

describe('transactions and health', () => {
  it('commits a transaction on one connection', async () => {
    const pool = new FakeSqlPool()
    const store = createSqlRecordStore(pool)

    await expect(store.transaction(async (writer) => {
      await writer.upsert('notes', { id: 'n1', text: 'x' } as AdminEntity)
      return 'done'
    })).resolves.toBe('done')

    expect(pool.queries.map((query) => query.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO "veren_records"'),
      'COMMIT',
    ])
    expect(pool.releases).toBe(1)
  })

  it('rolls back when the work throws and still releases the connection', async () => {
    const pool = new FakeSqlPool()
    const store = createSqlRecordStore(pool)

    await expect(store.transaction(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(pool.queries.map((query) => query.sql)).toEqual(['BEGIN', 'ROLLBACK'])
    expect(pool.releases).toBe(1)
  })

  it('reports the affected rows of a delete', async () => {
    const pool = new FakeSqlPool()
    pool.handler = (sql) => ({ rows: [], rowCount: sql.startsWith('DELETE') ? 1 : 0 })
    const store = createSqlRecordStore(pool)

    await expect(store.remove('admin_users', 'u1')).resolves.toBe(true)
    pool.handler = () => ({ rows: [], rowCount: 0 })
    await expect(store.remove('admin_users', 'u1')).resolves.toBe(false)
  })

  it('reports ok while the pool answers and down when it throws', async () => {
    const pool = new FakeSqlPool()
    const store = createSqlRecordStore(pool)
    await expect(store.health()).resolves.toEqual({ status: 'ok' })

    pool.handler = () => { throw new Error('connection refused') }
    await expect(store.health()).resolves.toEqual({ status: 'down', detail: 'connection refused' })
  })

  it('closes the pool once through the store', async () => {
    const pool = new FakeSqlPool()
    await createSqlRecordStore(pool).close()
    expect(pool.closed).toBe(true)
  })
})
