import { afterEach, describe, expect, it } from 'vitest'
import {
  Between,
  Column,
  DataSource,
  Entity,
  EntityPropertyNotFoundError,
  Equal,
  ILike,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Like,
  ManyToOne,
  MoreThan,
  MoreThanOrEqual,
  Not,
  OneToMany,
  PrimaryGeneratedColumn,
  Raw,
} from '../src/index.ts'
import '../src/driver/sqlite.ts'

@Entity('op_owners')
class OpOwner {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  name!: string

  @OneToMany(() => OpRecord, (record) => record.owner)
  records?: OpRecord[]
}

@Entity('op_records')
class OpRecord {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  name!: string

  @Column({ type: 'integer' })
  age!: number

  @Column({ type: 'integer', nullable: true })
  score?: number | null

  @Column({ type: 'boolean' })
  active!: boolean

  @ManyToOne(() => OpOwner, (owner) => owner.records)
  owner!: OpOwner
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

/** 建数据源并种数据。 / Build a seeded source. */
async function seeded(): Promise<DataSource> {
  const source = new DataSource({ type: 'sqlite', entities: [OpOwner, OpRecord], synchronize: true })
  await source.initialize()
  sources.push(source)
  const owners = source.getRepository(OpOwner)
  const alice = await owners.save({ name: 'Alice' } as OpOwner)
  const bob = await owners.save({ name: 'Bob' } as OpOwner)
  await source.getRepository(OpRecord).save([
    { name: 'Alpha', age: 20, score: null, active: true, owner: alice },
    { name: 'Beta', age: 30, score: 10, active: false, owner: alice },
    { name: 'Gamma', age: 40, score: 20, active: true, owner: bob },
  ] as OpRecord[])
  return source
}

/** 查询名字列表。 / Query the names. */
async function names(source: DataSource, where: object): Promise<string[]> {
  const rows = await source.getRepository(OpRecord).find({ where: where as never, order: { name: 'ASC' } })
  return rows.map((row) => String(row.name))
}

describe('find operators', () => {
  it('supports equality, negation and membership', async () => {
    const source = await seeded()
    expect(await names(source, { name: Equal('Alpha') })).toEqual(['Alpha'])
    expect(await names(source, { name: Not('Alpha') })).toEqual(['Beta', 'Gamma'])
    expect(await names(source, { name: In(['Alpha', 'Gamma']) })).toEqual(['Alpha', 'Gamma'])
    expect(await names(source, { name: Not(In(['Alpha'])) })).toEqual(['Beta', 'Gamma'])
  })

  it('supports null, like and comparison operators', async () => {
    const source = await seeded()
    expect(await names(source, { score: IsNull() })).toEqual(['Alpha'])
    expect(await names(source, { name: Like('A%') })).toEqual(['Alpha'])
    expect(await names(source, { name: ILike('a%') })).toEqual(['Alpha'])
    expect(await names(source, { age: Between(25, 35) })).toEqual(['Beta'])
    expect(await names(source, { age: LessThan(30) })).toEqual(['Alpha'])
    expect(await names(source, { age: LessThanOrEqual(30) })).toEqual(['Alpha', 'Beta'])
    expect(await names(source, { age: MoreThan(30) })).toEqual(['Gamma'])
    expect(await names(source, { age: MoreThanOrEqual(30) })).toEqual(['Beta', 'Gamma'])
    expect(await names(source, { active: Equal(true) })).toEqual(['Alpha', 'Gamma'])
  })

  it('supports raw fragments with parameter channels', async () => {
    const source = await seeded()
    const rows = await source.getRepository(OpRecord).find({
      where: { age: Raw(() => 'age > :min', { min: 25 }) },
      order: { age: 'ASC' },
    })
    expect(rows.map((row) => row.name)).toEqual(['Beta', 'Gamma'])
  })

  it('supports OR groups and pagination', async () => {
    const source = await seeded()
    const rows = await source.getRepository(OpRecord).find({
      where: [{ name: 'Alpha' }, { name: 'Gamma' }],
      order: { age: 'DESC' },
      take: 1,
      skip: 1,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('Alpha')
  })

  it('supports nested relation conditions and existence', async () => {
    const source = await seeded()
    const owners = source.getRepository(OpOwner)
    expect((await owners.find({ where: { records: { name: 'Beta' } } })).map((owner) => owner.name)).toEqual(['Alice'])
    expect((await owners.find({ where: { records: true } })).map((owner) => owner.name).sort()).toEqual(['Alice', 'Bob'])
    expect((await owners.find({ where: { records: [{ name: 'Alpha' }, { name: 'Gamma' }] } })).map((owner) => owner.name).sort()).toEqual(['Alice', 'Bob'])
  })

  it('rejects unknown properties before touching the database', async () => {
    const source = await seeded()
    await expect(source.getRepository(OpRecord).find({ where: { nope: 1 } as never })).rejects.toBeInstanceOf(EntityPropertyNotFoundError)
  })

  it('filters soft-deleted rows through withDeleted', async () => {
    const source = await seeded()
    await source.getRepository(OpRecord).delete({ name: 'Beta' })
    expect(await names(source, {})).toEqual(['Alpha', 'Gamma'])
  })
})
