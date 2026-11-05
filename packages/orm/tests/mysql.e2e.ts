import { describe, expect, it } from 'vitest'
import { Column, DataSource, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from '../src/index.ts'
import '../src/driver/mysql.ts'

const url = process.env.ORM_MYSQL_URL

@Entity('e2e_mysql_users')
class MysqlUser {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @OneToMany(() => MysqlPost, (post) => post.author)
  posts?: MysqlPost[]
}

@Entity('e2e_mysql_posts')
class MysqlPost {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 120 })
  title!: string

  @ManyToOne(() => MysqlUser, (user) => user.posts)
  author!: MysqlUser
}

describe.skipIf(url === undefined)('mysql live integration', () => {
  it('runs CRUD, relations, schema sync and transaction rollback', async () => {
    const source = new DataSource({
      type: 'mysql',
      url: url!,
      entities: [MysqlUser, MysqlPost],
      dropSchema: true,
      synchronize: true,
    })
    await source.initialize()
    try {
      const users = source.getRepository(MysqlUser)
      const posts = source.getRepository(MysqlPost)
      const user = await users.save({ name: 'Ada' } as MysqlUser)
      expect(user.id).toBeGreaterThan(0)
      await posts.save({ title: 'Hello', author: user } as MysqlPost)
      const loaded = await posts.findOne({ where: { id: 1 }, relations: { author: true } })
      expect(loaded?.author?.name).toBe('Ada')
      expect((await source.schemaLog()).upQueries).toEqual([])

      await expect(source.transaction(async (manager) => {
        await manager.getRepository(MysqlUser).save({ name: 'rolled' } as MysqlUser)
        throw new Error('abort')
      })).rejects.toThrow('abort')
      expect(await users.count()).toBe(1)
    } finally {
      await source.destroy()
    }
  })
})
