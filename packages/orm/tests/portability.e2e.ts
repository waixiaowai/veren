import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Column,
  DataSource,
  Entity,
  Like,
  PrimaryGeneratedColumn,
  type EntityValues,
} from '../src/index.ts'
import '../src/driver/sqlite.ts'
import '../src/driver/postgres.ts'
import '../src/driver/mysql.ts'

const pgUrl = process.env.ORM_POSTGRES_URL
const mysqlUrl = process.env.ORM_MYSQL_URL

@Entity('portable_records')
class PortableRecord {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'boolean', default: true })
  flag!: boolean

  @Column({ type: 'date' })
  birthday!: Date

  @Column({ type: 'date', default: new Date('2024-01-01T00:00:00.000Z') })
  startedOn!: Date

  @Column({ type: 'datetime' })
  happenedAt!: Date

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: string

  @Column({ type: 'bigint' })
  big!: string

  @Column({ type: 'json' })
  payload!: { nested: number[] }

  @Column({ type: 'simple-array' })
  tags!: string[]

  @Column({ type: 'blob', nullable: true })
  binary?: Uint8Array | null

  @Column({ type: 'varchar', length: 32, nullable: true })
  note?: string | null

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status!: string
}

interface DialectCase {
  name: string
  create: () => DataSource
}

/** 只改连接配置，实体与上层代码完全一致。 / Only connection config changes; entity and app code stay identical. */
function dialectCases(): DialectCase[] {
  const cases: DialectCase[] = [{
    name: 'sqlite',
    create: () => new DataSource({ type: 'sqlite', entities: [PortableRecord], synchronize: true }),
  }]
  if (pgUrl !== undefined) {
    cases.push({
      name: 'postgres',
      create: () => new DataSource({ type: 'postgres', url: pgUrl, entities: [PortableRecord], dropSchema: true, synchronize: true }),
    })
  }
  if (mysqlUrl !== undefined) {
    cases.push({
      name: 'mysql',
      create: () => new DataSource({ type: 'mysql', url: mysqlUrl, entities: [PortableRecord], dropSchema: true, synchronize: true }),
    })
  }
  return cases
}

/** 一条覆盖全部归一化路径的记录。 / A row exercising every normalization path. */
function sample(overrides: Partial<PortableRecord> = {}): PortableRecord {
  return {
    flag: false,
    birthday: new Date('2024-01-02T03:04:05.678Z'),
    happenedAt: new Date('2024-01-02T03:04:05.678Z'),
    amount: '12.50',
    big: '1234567890123',
    payload: { nested: [1, 2] },
    tags: ['a', 'b'],
    binary: new Uint8Array([1, 2, 3]),
    note: null,
    status: 'draft',
    ...overrides,
  } as unknown as PortableRecord
}

describe.each(dialectCases())('$name portability contract', ({ create }) => {
  let source: DataSource

  beforeEach(async () => {
    source = create()
    await source.initialize()
  })

  afterEach(async () => {
    await source.destroy()
  })

  it('round-trips values with identical JS types and defaults', async () => {
    const repository = source.getRepository(PortableRecord)
    const saved = await repository.save(sample())
    const loaded = await repository.findOneByOrFail({ id: saved.id })

    expect(loaded.flag).toBe(false)
    expect(loaded.birthday).toBeInstanceOf(Date)
    expect(loaded.birthday.toISOString()).toBe('2024-01-02T00:00:00.000Z')
    expect(loaded.startedOn.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(await repository.count({ where: { birthday: new Date('2024-01-02T23:59:00.000Z') } })).toBe(1)
    expect(loaded.happenedAt.toISOString()).toBe('2024-01-02T03:04:05.678Z')
    expect(loaded.amount).toBe('12.5')
    expect(loaded.big).toBe('1234567890123')
    expect(loaded.payload).toEqual({ nested: [1, 2] })
    expect(loaded.tags).toEqual(['a', 'b'])
    expect(Array.from(loaded.binary ?? [])).toEqual([1, 2, 3])
    expect(loaded.note).toBeNull()
    expect(loaded.status).toBe('draft')
    expect(typeof await repository.count()).toBe('number')

    const defaulted = await repository.save({
      birthday: new Date('2024-01-02T00:00:00.000Z'),
      happenedAt: new Date('2024-01-02T00:00:00.000Z'),
      amount: '1.00',
      big: '1',
      payload: {},
      tags: [],
    } as unknown as PortableRecord)
    // 数据库默认值不应只在部分方言回写；save 后统一保持未赋值，需要时再查询。
    // DB defaults must not be echoed on only some dialects; after save they stay unset uniformly, refetch when needed.
    expect((defaulted as { flag?: boolean }).flag).toBeUndefined()
    expect((defaulted as { status?: string }).status).toBeUndefined()
    const loadedDefault = await repository.findOneByOrFail({ id: defaulted.id })
    expect(loadedDefault.flag).toBe(true)
    expect(loadedDefault.status).toBe('draft')
    expect(loadedDefault.amount).toBe('1')
    expect(loadedDefault.big).toBe('1')

    // 同一语义的另一种写法：布尔用 1、日期用 ISO 字符串，结果必须一致。
    // Alternative spellings of the same value: boolean 1 and ISO date strings must behave identically.
    const alternate = await repository.save({
      flag: 1 as unknown as boolean,
      birthday: '2024-03-04T12:00:00.000Z' as unknown as Date,
      happenedAt: '2024-03-04T05:06:07.890Z' as unknown as Date,
      amount: '2.50',
      big: '2',
      payload: {},
      tags: [],
    } as unknown as PortableRecord)
    const loadedAlternate = await repository.findOneByOrFail({ id: alternate.id })
    expect(loadedAlternate.flag).toBe(true)
    expect(loadedAlternate.birthday.toISOString()).toBe('2024-03-04T00:00:00.000Z')
    expect(loadedAlternate.happenedAt.toISOString()).toBe('2024-03-04T05:06:07.890Z')
  })

  it('returns one distinct generated id per row in a multi-row insert', async () => {
    const repository = source.getRepository(PortableRecord)
    const result = await repository.insert([sample(), sample({ note: 'second' })] as unknown as EntityValues[])
    expect(result.identifiers).toHaveLength(2)
    const ids = result.identifiers.map((identifier) => Number(identifier.id))
    expect(new Set(ids).size).toBe(2)
    expect(result.identifiers.every((identifier) => Object.keys(identifier).join(',') === 'id')).toBe(true)
    expect(await repository.count()).toBe(2)
  })

  it('orders nulls last and matches Like case-insensitively', async () => {
    const repository = source.getRepository(PortableRecord)
    await repository.save([
      sample({ note: 'Alpha' }),
      sample({ note: 'beta' }),
      sample({ note: null }),
    ])

    const ascending = await repository.find({ order: { note: 'ASC' } })
    expect(ascending.map((row) => row.note)).toEqual(['Alpha', 'beta', null])
    const descending = await repository.find({ order: { note: 'DESC' } })
    expect(descending.map((row) => row.note)).toEqual(['beta', 'Alpha', null])

    const matched = await repository.find({ where: { note: Like('a%') } })
    expect(matched.map((row) => row.note)).toEqual(['Alpha'])
  })

  it('applies boolean criteria consistently', async () => {
    const repository = source.getRepository(PortableRecord)
    await repository.save([sample({ flag: true }), sample({ flag: false })])
    expect(await repository.count({ where: { flag: true } })).toBe(1)
    expect(await repository.count({ where: { flag: false } })).toBe(1)
  })

  it('treats equality as case-sensitive and Like as case-insensitive', async () => {
    const repository = source.getRepository(PortableRecord)
    await repository.save(sample({ status: 'Draft' }))
    expect(await repository.count({ where: { status: 'draft' } })).toBe(0)
    expect(await repository.count({ where: { status: 'Draft' } })).toBe(1)
    expect(await repository.count({ where: { status: Like('draft') } })).toBe(1)
  })

  it('pages identically with take/skip and offset-only', async () => {
    const repository = source.getRepository(PortableRecord)
    await repository.save([
      sample({ note: 'A' }),
      sample({ note: 'B' }),
      sample({ note: 'C' }),
    ])
    const page = await repository.find({ order: { id: 'ASC' }, take: 2, skip: 1 })
    expect(page.map((row) => row.note)).toEqual(['B', 'C'])
    const offsetOnly = await repository.find({ order: { id: 'ASC' }, skip: 2 })
    expect(offsetOnly.map((row) => row.note)).toEqual(['C'])
    const [rows, total] = await repository.findAndCount({ take: 1 })
    expect(rows).toHaveLength(1)
    expect(total).toBe(3)
  })

  it('updates and deletes by criteria without dialect-specific SQL', async () => {
    const repository = source.getRepository(PortableRecord)
    await repository.save([sample({ note: 'A', flag: false }), sample({ note: 'B' })])
    await repository.update({ note: 'A' }, { flag: true })
    expect(await repository.count({ where: { note: 'A', flag: true } })).toBe(1)
    await repository.delete({ note: 'B' })
    expect(await repository.count()).toBe(1)
  })
})
