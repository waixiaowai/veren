import { describe, expect, it } from 'vitest'
import { Column, DataSource, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from '../src/index.ts'
import '../src/driver/postgres.ts'

const url = process.env.ORM_POSTGRES_URL

@Entity('e2e_pg_users')
class PgUser {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @OneToMany(() => PgPost, (post) => post.author)
  posts?: PgPost[]
}

@Entity('e2e_pg_posts')
class PgPost {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 120 })
  title!: string

  @ManyToOne(() => PgUser, (user) => user.posts)
  author!: PgUser
}

describe.skipIf(url === undefined)('postgres live integration', () => {
  it('runs CRUD, relations, schema sync and transaction rollback', async () => {
    const source = new DataSource({
      type: 'postgres',
      url: url!,
      entities: [PgUser, PgPost],
      dropSchema: true,
      synchronize: true,
    })
    await source.initialize()
    try {
      const users = source.getRepository(PgUser)
      const posts = source.getRepository(PgPost)
      const user = await users.save({ name: 'Ada' } as PgUser)
      expect(user.id).toBeGreaterThan(0)
      await posts.save({ title: 'Hello', author: user } as PgPost)
      const loaded = await posts.findOne({ where: { id: 1 }, relations: { author: true } })
      expect(loaded?.author?.name).toBe('Ada')
      expect((await source.schemaLog()).upQueries).toEqual([])

      await expect(source.transaction('SERIALIZABLE', async (manager) => {
        await manager.getRepository(PgUser).save({ name: 'rolled' } as PgUser)
        throw new Error('abort')
      })).rejects.toThrow('abort')
      expect(await users.count()).toBe(1)
    } finally {
      await source.destroy()
    }
  })
})
