import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Column,
  DataSource,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type MigrationInterface,
  type QueryRunner,
} from '../../src/index.ts'
import '../../src/driver/sqlite.ts'

@Entity('file_users')
class FileUser {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @OneToMany(() => FilePost, (post) => post.author)
  posts?: FilePost[]
}

@Entity('file_posts')
class FilePost {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 120 })
  title!: string

  @ManyToOne(() => FileUser, (user) => user.posts)
  author!: FileUser
}

@Entity('file_people')
class FilePersonV1 {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  name!: string
}

@Entity('file_people')
class FilePersonV2 {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  name!: string

  @Column({ type: 'integer', nullable: true })
  age?: number
}

const sources: DataSource[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/** 在系统临时目录建一个隔离目录。 / Create an isolated directory under the system temp dir. */
async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'veren-orm-'))
  directories.push(directory)
  return directory
}

describe('file-backed sqlite integration', () => {
  it('persists across two independent connections and reloads relations', async () => {
    const directory = await tempDirectory()
    const filename = join(directory, 'app.db')

    const writer = new DataSource({ type: 'sqlite', filename, entities: [FileUser, FilePost], synchronize: true })
    await writer.initialize()
    const user = await writer.getRepository(FileUser).save({ name: 'Ada' } as FileUser)
    await writer.getRepository(FilePost).save({ title: 'Hello', author: user } as FilePost)
    await writer.destroy()

    const reader = new DataSource({ type: 'sqlite', filename, entities: [FileUser, FilePost] })
    await reader.initialize()
    sources.push(reader)
    expect((await reader.schemaLog()).upQueries).toEqual([])
    const loaded = await reader.getRepository(FilePost).findOne({ where: { id: 1 }, relations: { author: true } })
    expect(loaded?.title).toBe('Hello')
    expect(loaded?.author?.name).toBe('Ada')
    expect(await reader.getRepository(FilePost).count()).toBe(1)
  })

  it('rolls back a transaction on a file database and keeps it usable', async () => {
    const directory = await tempDirectory()
    const filename = join(directory, 'tx.db')
    const source = new DataSource({ type: 'sqlite', filename, entities: [FileUser], synchronize: true })
    await source.initialize()
    sources.push(source)

    await expect(source.transaction(async (manager) => {
      await manager.getRepository(FileUser).save({ name: 'rolled' } as FileUser)
      throw new Error('abort')
    })).rejects.toThrow('abort')
    expect(await source.getRepository(FileUser).count()).toBe(0)
    await source.getRepository(FileUser).save({ name: 'kept' } as FileUser)
    expect(await source.getRepository(FileUser).count()).toBe(1)
  })

  it('adds a column across independent connections', async () => {
    const directory = await tempDirectory()
    const filename = join(directory, 'evolve.db')

    const first = new DataSource({ type: 'sqlite', filename, entities: [FilePersonV1], synchronize: true })
    await first.initialize()
    await first.getRepository(FilePersonV1).save({ name: 'before' } as FilePersonV1)
    await first.destroy()

    const second = new DataSource({ type: 'sqlite', filename, entities: [FilePersonV2] })
    await second.initialize()
    sources.push(second)
    const delta = await second.schemaLog()
    expect(delta.upQueries).toHaveLength(1)
    expect(delta.upQueries[0]?.query).toContain('ADD COLUMN "age"')
    await second.synchronize()
    expect((await second.schemaLog()).upQueries).toEqual([])

    const saved = await second.getRepository(FilePersonV2).save({ name: 'after', age: 42 } as FilePersonV2)
    expect((await second.getRepository(FilePersonV2).findBy({ id: saved.id }))[0]?.age).toBe(42)
  })

  it('runs and reverts migrations on a file database', async () => {
    class CreateFileWidgets1710000000100 implements MigrationInterface {
      async up(runner: QueryRunner): Promise<void> {
        await runner.query('CREATE TABLE file_widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
      }

      async down(runner: QueryRunner): Promise<void> {
        await runner.query('DROP TABLE file_widgets')
      }
    }

    const directory = await tempDirectory()
    const filename = join(directory, 'migrations.db')
    const source = new DataSource({ type: 'sqlite', filename, migrations: [CreateFileWidgets1710000000100] })
    await source.initialize()
    sources.push(source)

    expect(await source.runMigrations()).toHaveLength(1)
    expect((await source.showMigrations())[0]?.id).toBe(1)
    await source.query('INSERT INTO file_widgets (id, name) VALUES (1, \'x\')')
    expect((await source.query('SELECT COUNT(*) AS count FROM file_widgets')).rows[0]?.count).toBe(1)
    await source.undoLastMigration()
    await expect(source.query('SELECT * FROM file_widgets')).rejects.toThrow(/no such table/)
  })
})
