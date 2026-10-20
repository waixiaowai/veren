/**
 * Adapter behavior over a fake record store: mirror seeding, CRUD, write-through
 * ordering, transaction isolation and rollback, serialization, health.
 *
 * 在假记录存储上的适配器行为：镜像装载、CRUD、写穿顺序、事务隔离与回滚、串行化与健康。
 */

import { describe, expect, it } from 'vitest'
import { AdminError, type AdminDatabase, type AdminTable } from '@veren/admin-contract'
import { POSTGRES_FEATURES, createPostgresDatabase } from '../src/adapter.ts'
import { FakeRecordStore } from './fake-store.ts'

/** One typed record shape used by the specs. 用例使用的单个记录形状。 */
type Note = { readonly id: string, readonly text: string }

/** One database plus its fake store and a notes repository. 单个数据库及其假存储与 notes 仓库。 */
interface Fixture {
  readonly store: FakeRecordStore
  readonly database: AdminDatabase
  readonly notes: AdminTable<Note>
}

/** Build a database over a fresh store seeded with one committed record. 在全新且预置一条已提交记录的存储上构建数据库。 */
async function setup(): Promise<Fixture> {
  const store = new FakeRecordStore()
  store.seed('notes', [{ id: 'seed', text: 'loaded from the database' }])
  const database = await createPostgresDatabase({ store })
  return { store, database, notes: database.table<Note>('notes') }
}

/** Wait a few milliseconds without blocking the transaction queue. 等待若干毫秒且不阻塞事务队列。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** A record arriving from unparsed JSON. 来自未解析 JSON 的记录。 */
function unparsed(value: Record<string, unknown>): Note {
  return value as Note
}

describe('mirror and record storage', () => {
  it('serves records loaded before the database was built', async () => {
    const { notes } = await setup()
    expect(notes.find('seed')).toEqual({ id: 'seed', text: 'loaded from the database' })
    expect(notes.list()).toHaveLength(1)
    expect(notes.size).toBe(1)
  })

  it('saves, finds, lists, counts and removes inside one collection', async () => {
    const { store, notes } = await setup()
    await notes.save({ id: 'n1', text: 'first' })
    await notes.save({ id: 'n2', text: 'second' })

    expect(notes.find('n1')).toEqual({ id: 'n1', text: 'first' })
    expect(notes.find('missing')).toBeUndefined()
    expect(notes.list().map((note) => note.id).sort()).toEqual(['n1', 'n2', 'seed'])
    expect(notes.size).toBe(3)
    expect([...store.collections.get('notes')!.keys()].sort()).toEqual(['n1', 'n2', 'seed'])

    await expect(notes.remove('n1')).resolves.toBe(true)
    await expect(notes.remove('n1')).resolves.toBe(false)
    expect(notes.size).toBe(2)
    expect(store.collections.get('notes')!.has('n1')).toBe(false)
  })

  it('replaces a record saved twice under the same id', async () => {
    const { notes } = await setup()
    await notes.save({ id: 'seed', text: 'replaced' })
    expect(notes.size).toBe(1)
    expect(notes.find('seed')).toEqual({ id: 'seed', text: 'replaced' })
  })

  it('isolates collections whose names share a prefix', async () => {
    const { database } = await setup()
    const users = database.table<Note>('admin_user')
    const roles = database.table<Note>('admin_users')

    await users.save({ id: 'x', text: 'user' })
    await roles.save({ id: 'x', text: 'role' })

    expect(users.find('x')).toMatchObject({ text: 'user' })
    expect(roles.find('x')).toMatchObject({ text: 'role' })
    expect(users.size).toBe(1)
    expect(roles.size).toBe(1)
  })

  it('keeps uncommitted writes out of the mirror until the write succeeds', async () => {
    const { store, notes } = await setup()
    store.failWrites = 'database is down'

    await expect(notes.save({ id: 'lost', text: 'never stored' })).rejects.toThrow('database is down')
    expect(notes.find('lost')).toBeUndefined()
    expect(notes.size).toBe(1)
  })

  it('rejects a record whose id is missing or not a string', async () => {
    const { notes } = await setup()
    await expect(notes.save(unparsed({ text: 'no id' }))).rejects.toBeInstanceOf(AdminError)
    await expect(notes.save(unparsed({ id: 42 }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(notes.size).toBe(1)
  })
})

describe('transactions', () => {
  it('shows uncommitted writes only to the transaction and folds them in on commit', async () => {
    const { database, notes } = await setup()

    const result = await database.transaction(async (uow) => {
      const pending = uow.table<Note>('notes')
      await pending.save({ id: 'pending', text: 'in flight' })
      expect(notes.find('pending')).toBeUndefined()
      expect(pending.find('pending')).toMatchObject({ text: 'in flight' })
      expect(pending.list().map((note) => note.id).sort()).toEqual(['pending', 'seed'])
      await expect(pending.remove('seed')).resolves.toBe(true)
      expect(pending.find('seed')).toBeUndefined()
      return 'committed'
    })

    expect(result).toBe('committed')
    expect(notes.find('pending')).toMatchObject({ text: 'in flight' })
    expect(notes.find('seed')).toBeUndefined()
    expect(notes.size).toBe(1)
  })

  it('propagates a failure, rolls back the writes, and reuses the queue', async () => {
    const { store, database, notes } = await setup()
    const boom = new Error('boom')

    await expect(database.transaction(async () => { throw boom })).rejects.toBe(boom)
    await expect(database.transaction(async (uow) => {
      await uow.table<Note>('notes').save({ id: 'doomed', text: 'written before the failure' })
      throw new Error('after write')
    })).rejects.toThrow('after write')

    expect(notes.find('doomed')).toBeUndefined()
    expect(notes.size).toBe(1)
    expect(store.collections.get('notes')!.has('doomed')).toBe(false)

    await expect(database.transaction(async (uow) => {
      await uow.table<Note>('notes').save({ id: 'next', text: 'after the failure' })
      return 7
    })).resolves.toBe(7)
    expect(notes.find('next')).toMatchObject({ text: 'after the failure' })
  })

  it('serializes overlapping transactions', async () => {
    const { database, notes } = await setup()
    const order: string[] = []

    const first = database.transaction(async (uow) => {
      const table = uow.table<Note>('notes')
      await table.save({ id: 'a', text: 'a' })
      order.push('a')
      await delay(5)
      await table.save({ id: 'b', text: 'b' })
      order.push('b')
      return 'first'
    })
    const second = database.transaction(async (uow) => {
      await uow.table<Note>('notes').save({ id: 'c', text: 'c' })
      order.push('c')
      return 'second'
    })

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(order).toEqual(['a', 'b', 'c'])
    expect(notes.size).toBe(4)
    expect(notes.find('c')).toMatchObject({ text: 'c' })
  })

  it('reports whether a remove hit a committed or pending record', async () => {
    const { database, notes } = await setup()

    await database.transaction(async (uow) => {
      const table = uow.table<Note>('notes')
      await table.save({ id: 'fresh', text: 'new' })
      await expect(table.remove('fresh')).resolves.toBe(true)
      await expect(table.remove('fresh')).resolves.toBe(false)
      await expect(table.remove('seed')).resolves.toBe(true)
      return undefined
    })

    expect(notes.find('fresh')).toBeUndefined()
    expect(notes.find('seed')).toBeUndefined()
    expect(notes.size).toBe(0)
  })
})

describe('engine facts', () => {
  it('advertises real transactions and no query surface', () => {
    expect(POSTGRES_FEATURES).toEqual({ transactions: true, secondaryIndexes: false, fullText: false })
  })

  it('delegates health to the store', async () => {
    const { store, database } = await setup()
    await expect(database.health()).resolves.toEqual({ status: 'ok' })

    store.healthDetail = 'server is gone'
    await expect(database.health()).resolves.toEqual({ status: 'down', detail: 'server is gone' })
  })
})
