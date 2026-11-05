import { afterEach, describe, expect, it } from 'vitest'
import {
  Column,
  DataSource,
  Entity,
  In,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from '../src/index.ts'
import '../src/driver/sqlite.ts'

@Entity('users')
class User {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @Column({ type: 'integer', nullable: true })
  age?: number

  @OneToMany(() => Post, (post) => post.author)
  posts?: Post[]
}

@Entity('posts')
class Post {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 200 })
  title!: string

  @ManyToOne(() => User, (user) => user.posts)
  author!: User
}

const sources: DataSource[] = []

/** 建一个内存 SQLite 数据源并在用例结束后销毁。 / Build an in-memory SQLite source and destroy it after the case. */
async function createSource(): Promise<DataSource> {
  const source = new DataSource({
    type: 'sqlite',
    entities: [User, Post],
    synchronize: true,
  })
  await source.initialize()
  sources.push(source)
  return source
}

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

describe('sqlite end to end', () => {
  it('synchronizes, inserts, finds and loads relations', async () => {
    const source = await createSource()
    const users = source.getRepository(User)
    const posts = source.getRepository(Post)

    const user = await users.save({ name: 'Ada', age: 36 } as User)
    expect(user.id).toBe(1)

    const post = await posts.save({ title: 'Hello', author: user } as Post)
    expect(post.id).toBe(1)

    const found = await posts.findOne({ where: { title: 'Hello' }, relations: { author: true } })
    expect(found?.author?.name).toBe('Ada')

    const withPosts = await users.findOne({ where: { id: 1 }, relations: { posts: true } })
    expect(withPosts?.posts?.map((item) => item.title)).toEqual(['Hello'])
  })

  it('translates operators and nested relation conditions', async () => {
    const source = await createSource()
    const users = source.getRepository(User)
    await users.save([{ name: 'Ada' }, { name: 'Bob' }, { name: 'Cid' }] as User[])

    const found = await users.find({ where: { name: In(['Ada', 'Cid']) }, order: { name: 'ASC' } })
    expect(found.map((item) => item.name)).toEqual(['Ada', 'Cid'])

    const posts = source.getRepository(Post)
    await posts.save({ title: 'By Ada', author: { id: 1 } } as Post)
    const byAuthor = await users.find({ where: { posts: { title: 'By Ada' } } })
    expect(byAuthor).toHaveLength(1)
    expect(byAuthor[0]?.name).toBe('Ada')
  })

  it('rolls back a transaction and keeps the connection usable', async () => {
    const source = await createSource()
    const users = source.getRepository(User)
    await expect(source.transaction(async (manager) => {
      await manager.getRepository(User).save({ name: 'RolledBack' } as User)
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(await users.count()).toBe(0)
    await users.save({ name: 'After' } as User)
    expect(await users.count()).toBe(1)
  })

  it('reports an empty schema diff once synchronized', async () => {
    const source = await createSource()
    const delta = await source.schemaLog()
    expect(delta.upQueries).toEqual([])
  })
})
