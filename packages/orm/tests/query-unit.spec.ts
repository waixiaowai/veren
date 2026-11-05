import { afterEach, describe, expect, it } from 'vitest'
import {
  Brackets,
  Column,
  DataSource,
  Entity,
  EntityPropertyNotFoundError,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  QueryExpressionMap,
  UnsupportedFeatureError,
} from '../src/index.ts'
import '../src/driver/sqlite.ts'

@Entity('q_users')
class QUser {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  name!: string

  @OneToMany(() => QPost, (post) => post.author)
  posts?: QPost[]

  @ManyToMany(() => QTag, (tag) => tag.users)
  tags?: QTag[]
}

@Entity('q_posts')
class QPost {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  title!: string

  @ManyToOne(() => QUser, (user) => user.posts)
  author!: QUser
}

@Entity('q_tags')
class QTag {
  @PrimaryGeneratedColumn()
  id!: number

  @ManyToMany(() => QUser, (user) => user.tags)
  users?: QUser[]
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

/** 建一个内存数据源并种两行。 / Build an in-memory source seeded with two rows. */
async function seeded(): Promise<DataSource> {
  const source = new DataSource({ type: 'sqlite', entities: [QUser, QPost], synchronize: true })
  await source.initialize()
  sources.push(source)
  const users = source.getRepository(QUser)
  const ada = await users.save({ name: 'Ada' } as QUser)
  await users.save({ name: 'Bob' } as QUser)
  await source.getRepository(QPost).save([
    { title: 'A1', author: ada },
    { title: 'A2', author: ada },
    { title: 'B1', author: { id: 2 } },
  ] as QPost[])
  return source
}

describe('expression map', () => {
  it('names parameters without collisions and clones independently', () => {
    const map = new QueryExpressionMap()
    map.setParameter('p0', 'reserved')
    const name = map.addParameter(1)
    expect(name).toBe('p1')
    map.setParameter('custom', 2)
    expect(map.getParameters()).toEqual({ p0: 'reserved', p1: 1, custom: 2 })

    map.queryType = 'update'
    map.limit = 5
    map.values.push({ name: 'x' })
    const clone = map.clone()
    clone.setParameter('custom', 3)
    clone.values.push({ name: 'y' })
    expect(map.getParameters().custom).toBe(2)
    expect(map.values).toHaveLength(1)
    expect(clone.values).toHaveLength(2)
    expect(clone.queryType).toBe('update')
    expect(clone.limit).toBe(5)
  })
})

describe('brackets', () => {
  it('renders nested groups and keeps parameters', () => {
    const brackets = new Brackets((root) => {
      root.andWhere('a = :a', { a: 1 })
      root.orWhere(new Brackets((leaf) => {
        leaf.andWhere('b = :b', { b: 2 })
        leaf.orWhere('c = :c', { c: 3 })
      }))
    })
    expect(brackets.render()).toBe('(a = :a OR (b = :b OR c = :c))')
    expect([...brackets.getParameters()]).toEqual([['a', 1], ['b', 2], ['c', 3]])
    expect(new Brackets(() => undefined).render()).toBe('()')
  })
})

describe('select builder', () => {
  it('builds projections, joins, grouping and paging', async () => {
    const source = await seeded()
    const builder = source.getRepository(QPost).createQueryBuilder('p')
    builder
      .select('p.title')
      .addSelect('p.author')
      .innerJoin('p.author', 'u')
      .leftJoin('u.posts', 'sibling')
      .where('u.name = :name', { name: 'Ada' })
      .addOrderBy('p.id', 'DESC')
      .groupBy('p.id')
      .having('COUNT(*) > 0')
      .distinct()
      .limit(10)
      .offset(1)

    const sql = builder.getSql()
    expect(sql).toContain('SELECT DISTINCT "p"."title" AS "p_title"')
    expect(sql).toContain('INNER JOIN "q_users" "u"')
    expect(sql).toContain('LEFT JOIN "q_posts" "sibling"')
    expect(sql).toContain('GROUP BY p.id')
    expect(sql).toContain('HAVING COUNT(*) > 0')
    expect(sql).toContain('LIMIT 10 OFFSET 1')
    expect(sql).toContain('ORDER BY "p"."id" DESC')

    const rows = await builder.getRawMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.p_title).toBe('A1')
  })

  it('resets projection and conditions', async () => {
    const source = new DataSource({ type: 'sqlite', entities: [QUser] })
    await source.initialize()
    sources.push(source)
    const builder = source.getRepository(QUser).createQueryBuilder('u')
    builder.select('u.name').select()
    expect(builder.getSql()).toContain('"u"."id" AS "u_id"')

    builder.where('u.name = :first', { first: 'A' }).where('u.name = :second', { second: 'B' })
    expect(builder.getSql()).toContain(':second')
    expect(builder.getSql()).not.toContain(':first')
  })

  it('supports raw projections, aliases and aggregate reads', async () => {
    const source = await seeded()
    const builder = source.getRepository(QUser).createQueryBuilder('u')
    builder.select('COUNT(*)', 'total').addSelect('u.id', 'custom_id')
    const row = await builder.getRawOne()
    expect(Object.keys(row ?? {})).toEqual(['total', 'custom_id'])
    expect(Number(row?.total)).toBe(2)
    expect(await source.getRepository(QUser).createQueryBuilder('u').getCount()).toBe(2)
  })

  it('handles offset-only paging per dialect', async () => {
    const source = new DataSource({ type: 'sqlite', entities: [QUser] })
    await source.initialize()
    sources.push(source)
    const builder = source.getRepository(QUser).createQueryBuilder('u')
    builder.offset(3)
    expect(builder.getSql()).toContain('LIMIT -1 OFFSET 3')
    builder.limit(2)
    expect(builder.getSql()).toContain('LIMIT 2 OFFSET 3')
  })

  it('returns undefined for empty single reads', async () => {
    const source = await seeded()
    const builder = source.getRepository(QUser).createQueryBuilder('u')
    builder.where('u.name = :name', { name: 'nobody' })
    expect(await builder.getOne()).toBeUndefined()
    expect(await builder.getRawOne()).toBeUndefined()
  })

  it('rejects unknown join properties and many-to-many manual joins', async () => {
    const source = new DataSource({ type: 'sqlite', entities: [QUser, QPost, QTag] })
    await source.initialize()
    sources.push(source)
    expect(() => source.getRepository(QPost).createQueryBuilder('p').innerJoin('p.missing', 'x')).toThrow(EntityPropertyNotFoundError)
    expect(() => source.getRepository(QTag).createQueryBuilder('t').innerJoin('t.users', 'u')).toThrow(UnsupportedFeatureError)
  })

  it('clones a query without sharing parameters', async () => {
    const source = new DataSource({ type: 'sqlite', entities: [QUser] })
    await source.initialize()
    sources.push(source)
    const builder = source.getRepository(QUser).createQueryBuilder('u')
    builder.where('u.id = :id', { id: 1 })
    const clone = builder.clone()
    clone.andWhere('u.name = :name', { name: 'Ada' })
    expect(builder.getSql()).not.toContain(':name')
    expect(clone.getSql()).toContain(':name')
    expect(builder.getQueryAndParameters()).toEqual(builder.getQueryAndParameters())
  })

  it('executes with a self-opened transaction when requested', async () => {
    const source = await seeded()
    const builder = source.getRepository(QUser).createQueryBuilder('u').useTransaction(true)
    expect(await builder.getMany()).toHaveLength(2)
  })
})
