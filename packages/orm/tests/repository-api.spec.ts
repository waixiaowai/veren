import { afterEach, describe, expect, it } from 'vitest'
import {
  Column,
  DataSource,
  DeleteDateColumn,
  EmptyCriteriaError,
  Entity,
  EntityNotFoundError,
  EntityPropertyNotFoundError,
  PrimaryGeneratedColumn,
  type Repository,
} from '../src/index.ts'
import '../src/driver/sqlite.ts'

@Entity('accounts')
class Account {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  name!: string

  @Column({ type: 'integer' })
  balance!: number

  @DeleteDateColumn()
  deletedAt?: Date | null
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

/** 建一个空数据源。 / Build an empty source. */
async function createSource(): Promise<DataSource> {
  const source = new DataSource({ type: 'sqlite', entities: [Account], synchronize: true })
  await source.initialize()
  sources.push(source)
  return source
}

describe('repository API', () => {
  it('creates, identifies and preloads entities', async () => {
    const source = await createSource()
    const repository = source.getRepository(Account)
    const created = repository.create({ name: 'Ada', balance: 10 })
    expect(created.name).toBe('Ada')
    expect(repository.hasId(created)).toBe(false)
    expect(repository.getId(created)).toEqual({})

    const saved = await repository.save(created as unknown as Account)
    expect(repository.hasId(saved)).toBe(true)
    expect(repository.getId(saved)).toEqual({ id: saved.id })

    const preloaded = await repository.preload({ id: saved.id, name: 'Ada II' })
    expect(preloaded?.name).toBe('Ada II')
    expect(preloaded?.balance).toBe(10)
    expect(await repository.preload({ id: 999, name: 'nobody' })).toBeUndefined()
    expect((await repository.preload({ name: 'no-id' }))?.name).toBe('no-id')

    const merged = repository.merge(repository.create({ name: 'A', balance: 1 }), { balance: 2 }, { name: 'B' })
    expect(merged).toMatchObject({ name: 'B', balance: 2 })
  })

  it('reads through every find variant', async () => {
    const source = await createSource()
    const repository = source.getRepository(Account)
    await repository.save([{ name: 'A', balance: 1 }, { name: 'B', balance: 2 }] as Account[])

    expect(await repository.find()).toHaveLength(2)
    expect((await repository.findBy({ name: 'A' }))[0]?.balance).toBe(1)
    expect((await repository.findOne({ where: { name: 'B' } }))?.balance).toBe(2)
    expect((await repository.findOneBy({ name: 'A' }))?.name).toBe('A')
    expect((await repository.findOneOrFail({ where: { name: 'A' } })).name).toBe('A')
    expect((await repository.findOneByOrFail({ name: 'B' })).name).toBe('B')
    expect((await repository.findOneBy({ name: 'missing' }))).toBeUndefined()
    await expect(repository.findOneByOrFail({ name: 'missing' })).rejects.toBeInstanceOf(EntityNotFoundError)

    const [rows, total] = await repository.findAndCount()
    expect(rows).toHaveLength(2)
    expect(total).toBe(2)
    expect(await repository.count()).toBe(2)
    expect(await repository.exists({ where: { name: 'A' } })).toBe(true)
    expect(await repository.exists({ where: { name: 'missing' } })).toBe(false)
  })

  it('writes through insert, update, delete and clear', async () => {
    const source = await createSource()
    const repository = source.getRepository(Account)

    const inserted = await repository.insert([{ name: 'A', balance: 1 }, { name: 'B', balance: 2 }])
    expect(inserted.identifiers).toHaveLength(2)
    await repository.update({ name: 'A' }, { balance: 10 })
    expect((await repository.findOneBy({ name: 'A' }))?.balance).toBe(10)

    await repository.delete({ name: 'B' })
    expect(await repository.count()).toBe(1)
    await repository.clear()
    expect(await repository.count()).toBe(0)
  })

  it('soft deletes and restores rows', async () => {
    const source = await createSource()
    const repository = source.getRepository(Account)
    const account = await repository.save({ name: 'A', balance: 1 } as Account)

    await repository.softDelete({ id: account.id })
    expect(await repository.count()).toBe(0)
    expect(await repository.count({ withDeleted: true })).toBe(1)
    await repository.restore({ id: account.id })
    expect(await repository.count()).toBe(1)

    await repository.softRemove(account)
    expect(await repository.count()).toBe(0)
    await repository.recover(account)
    expect(await repository.count()).toBe(1)
  })

  it('increments and decrements numeric columns', async () => {
    const source = await createSource()
    const repository = source.getRepository(Account)
    const account = await repository.save({ name: 'A', balance: 10 } as Account)
    await repository.increment('balance', 5, { id: account.id })
    expect((await repository.findOneBy({ id: account.id }))?.balance).toBe(15)
    await repository.decrement('balance', 3, { id: account.id })
    expect((await repository.findOneBy({ id: account.id }))?.balance).toBe(12)
  })

  it('runs raw queries and derives custom repositories', async () => {
    const source = await createSource()
    const repository = source.getRepository(Account)
    await repository.save({ name: 'A', balance: 1 } as Account)

    const result = await repository.query('SELECT COUNT(*) AS count FROM accounts')
    expect(Number(result.rows[0]?.count)).toBe(1)

    const custom = repository.extend({
      countAll: async (): Promise<number> => repository.count(),
    })
    expect(await custom.countAll()).toBe(1)
    expect(custom.metadata.tableName).toBe('accounts')
  })

  it('offers the same operations on the entity manager', async () => {
    const source = await createSource()
    const manager = source.manager
    const repository = source.getRepository(Account)

    await manager.insert(Account, { name: 'A', balance: 1 })
    await manager.update(Account, { name: 'A' }, { balance: 2 })
    expect(await manager.exists(Account, { where: { name: 'A' } })).toBe(true)
    expect((await manager.findAndCount(Account))[1]).toBe(1)
    expect((await manager.findOneOrFail(Account, { where: { name: 'A' } })).balance).toBe(2)
    expect((await manager.createQueryBuilder(Account).getRawMany())[0]?.a_name).toBe('A')
    expect((await manager.query('SELECT 1 AS ok')).rows[0]?.ok).toBe(1)

    const created = manager.create(Account, { name: 'B', balance: 3 })
    expect(manager.merge(Account, created, { balance: 4 }).balance).toBe(4)
    expect(await manager.preload(Account, { id: 999, name: 'x' })).toBeUndefined()
    await manager.delete(Account, { name: 'A' })
    expect(await repository.count()).toBe(0)
  })

  it('rebinds a custom repository inside a transaction', async () => {
    const source = await createSource()
    const repository = source.getRepository(Account)
    const custom = repository.extend({
      inTransaction(this: Repository<Account>): boolean {
        return this.manager.queryRunner !== undefined
      },
    })
    expect(custom.inTransaction()).toBe(false)
    await source.transaction(async (manager) => {
      const bound = manager.withRepository(custom)
      expect(bound.inTransaction()).toBe(true)
      await bound.save({ name: 'tx', balance: 1 } as Account)
    })
    expect(await repository.count()).toBe(1)
  })

  it('rejects empty criteria and unknown properties', async () => {
    const source = await createSource()
    const repository = source.getRepository(Account)
    expect(() => repository.update({}, { balance: 1 })).toThrow(EmptyCriteriaError)
    expect(() => repository.delete({})).toThrow(EmptyCriteriaError)
    expect(() => repository.increment('missing', 1, { id: 1 })).toThrow(EntityPropertyNotFoundError)
  })
})
