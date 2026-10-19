/**
 * Adapter behavior over a `Map`-backed fake domain: per-collection CRUD,
 * prefix isolation, record validation, the degraded transaction guarantee, and
 * health.
 *
 * 在 `Map` 支撑的假 domain 上的适配器行为：逐集合 CRUD、前缀隔离、记录校验、
 * 降级事务保证与健康探测。
 */

import { describe, expect, it } from 'vitest'
import { AdminError, type AdminDatabase, type AdminTable } from '@veren/admin-contract'
import { createKvDatabase } from '../src/adapter.ts'
import { FakeDomain } from './fake-domain.ts'

/** One typed record shape used by the specs. 用例使用的单个记录形状。 */
type Note = { readonly id: string, readonly text: string }

/** One database plus its fake domain and a notes repository. 单个数据库及其假 domain 与 notes 仓库。 */
interface Fixture {
  readonly domain: FakeDomain
  readonly database: AdminDatabase
  readonly notes: AdminTable<Note>
}

/** Build a database over a fresh fake domain. 在全新假 domain 上构建数据库。 */
function setup(): Fixture {
  const domain = new FakeDomain()
  const database = createKvDatabase({ domain })
  return { domain, database, notes: database.table<Note>('notes') }
}

/** Wait a few milliseconds without blocking the queue. 等待若干毫秒且不阻塞队列。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * A record arriving from unparsed JSON: the static type promises an id the
 * value may not carry.
 *
 * 来自未解析 JSON 的记录：静态类型承诺有 id，实际值未必携带。
 */
function unparsed(value: Record<string, unknown>): Note {
  return value as Note
}

describe('record storage', () => {
  it('saves, finds, lists, counts and removes inside one collection', async () => {
    const { domain, notes } = setup()
    await notes.save({ id: 'n1', text: 'first' })
    await notes.save({ id: 'n2', text: 'second' })

    expect(notes.find('n1')).toEqual({ id: 'n1', text: 'first' })
    expect(notes.find('missing')).toBeUndefined()
    expect(notes.list().map((note) => note.id).sort()).toEqual(['n1', 'n2'])
    expect(notes.size).toBe(2)
    expect([...domain.records.keys()]).toEqual(['notes:n1', 'notes:n2'])

    await expect(notes.remove('n1')).resolves.toBe(true)
    await expect(notes.remove('n1')).resolves.toBe(false)
    expect(notes.size).toBe(1)
    expect(notes.find('n1')).toBeUndefined()
  })

  it('replaces a record saved twice under the same id', async () => {
    const { notes } = setup()
    await notes.save({ id: 'n1', text: 'first' })
    await notes.save({ id: 'n1', text: 'second' })
    expect(notes.size).toBe(1)
    expect(notes.find('n1')).toEqual({ id: 'n1', text: 'second' })
  })

  it('isolates collections whose names share a prefix', async () => {
    const domain = new FakeDomain()
    const database = createKvDatabase({ domain })
    const users = database.table<Note>('admin_user')
    const roles = database.table<Note>('admin_users')

    await users.save({ id: 'x', text: 'user' })
    await roles.save({ id: 'x', text: 'role' })

    expect(users.find('x')).toMatchObject({ text: 'user' })
    expect(roles.find('x')).toMatchObject({ text: 'role' })
    expect(users.list()).toHaveLength(1)
    expect(roles.list()).toHaveLength(1)
    expect(users.size).toBe(1)
    expect(roles.size).toBe(1)
  })

  it('rejects a record whose id is missing or not a string', async () => {
    const { notes } = setup()
    await expect(notes.save(unparsed({ text: 'no id' }))).rejects.toBeInstanceOf(AdminError)
    await expect(notes.save(unparsed({ id: 42 }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(notes.size).toBe(0)
  })
})

describe('degraded transactions', () => {
  it('returns the work value and never interleaves concurrent work', async () => {
    const { database, notes } = setup()
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
    expect(notes.size).toBe(3)
  })

  it('propagates a failure, keeps prior writes, and reuses the chain', async () => {
    const { database, notes } = setup()
    const boom = new Error('boom')

    await expect(database.transaction(async () => { throw boom })).rejects.toBe(boom)
    await expect(database.transaction(async (uow) => {
      await uow.table<Note>('notes').save({ id: 'kept', text: 'written before the failure' })
      throw new Error('after write')
    })).rejects.toThrow('after write')

    // No rollback is the documented degraded guarantee: the record stays.
    // 不回滚是文档化的降级保证：记录保持写入状态。
    expect(notes.find('kept')).toMatchObject({ text: 'written before the failure' })

    await expect(database.transaction(async (uow) => {
      await uow.table<Note>('notes').save({ id: 'next', text: 'after the failure' })
      return 7
    })).resolves.toBe(7)
    expect(notes.size).toBe(2)
  })
})

describe('engine facts', () => {
  it('advertises the capabilities it cannot provide', () => {
    const { database } = setup()
    expect(database.features).toEqual({ transactions: false, secondaryIndexes: false, fullText: false })
  })

  it('reports ok while the handle answers and down when it throws', async () => {
    const { database, domain } = setup()
    await expect(database.health()).resolves.toEqual({ status: 'ok' })

    domain.break('medium is gone')
    await expect(database.health()).resolves.toEqual({ status: 'down', detail: 'medium is gone' })
  })
})
