import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Column,
  DataSource,
  Entity,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type SqlClient,
} from '../src/index.ts'
import { createNodeSqliteClient } from '../src/driver/node-sqlite-client.ts'
import '../src/driver/sqlite.ts'

@Entity('schema_authors')
class SchemaAuthor {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32, unique: true })
  name!: string

  @OneToMany(() => SchemaBook, (book) => book.author)
  books?: SchemaBook[]
}

@Entity('schema_books')
class SchemaBook {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 64 })
  title!: string

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status!: string

  @ManyToOne(() => SchemaAuthor, (author) => author.books)
  author!: SchemaAuthor
}

@Entity('schema_people')
class PersonV1 {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  name!: string
}

@Entity('schema_people')
class PersonV2 {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  name!: string

  @Column({ type: 'integer', nullable: true })
  age?: number
}

@Entity('schema_members')
class SchemaMember {
  @PrimaryGeneratedColumn()
  id!: number

  @ManyToMany(() => SchemaTag, (tag) => tag.members)
  @JoinTable()
  tags?: SchemaTag[]
}

@Entity('schema_tags')
class SchemaTag {
  @PrimaryGeneratedColumn()
  id!: number

  @ManyToMany(() => SchemaMember, (member) => member.tags)
  members?: SchemaMember[]
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

/** 可重复关闭的内存客户端。 / An in-memory client whose close is idempotent. */
function memoryClient(): SqlClient {
  const inner = createNodeSqliteClient(new DatabaseSync(':memory:'))
  let closed = false
  return {
    query: (sql, parameters) => inner.query(sql, parameters),
    close: async () => {
      if (closed) return
      closed = true
      await inner.close?.()
    },
  }
}

/** 查询表清单。 / Read the table list. */
async function tableNames(client: SqlClient): Promise<string[]> {
  const result = await client.query("SELECT name FROM sqlite_master WHERE type = 'table'")
  return result.rows.map((row) => String(row.name))
}

describe('schema builder', () => {
  it('computes DDL without executing it, then becomes a no-op after sync', async () => {
    const client = memoryClient()
    const source = new DataSource({ type: 'sqlite', client, entities: [SchemaAuthor, SchemaBook] })
    await source.initialize()
    sources.push(source)

    const log = await source.schemaLog()
    expect(log.upQueries.some((query) => query.query.includes('CREATE TABLE "schema_authors"'))).toBe(true)
    expect(log.upQueries.some((query) => query.query.includes('CREATE TABLE "schema_books"'))).toBe(true)
    expect(log.upQueries.some((query) => query.query.includes('FOREIGN KEY'))).toBe(true)
    expect(log.upQueries.some((query) => query.query.includes("DEFAULT 'draft'"))).toBe(true)
    expect(log.upQueries.some((query) => query.query.includes('UNIQUE INDEX'))).toBe(true)
    expect(await tableNames(client)).not.toContain('schema_books')

    await source.synchronize()
    expect((await source.schemaLog()).upQueries).toEqual([])
    expect(await tableNames(client)).toContain('schema_books')
  })

  it('drops every declared table', async () => {
    const client = memoryClient()
    const source = new DataSource({ type: 'sqlite', client, entities: [SchemaAuthor], synchronize: true })
    await source.initialize()
    sources.push(source)
    expect(await tableNames(client)).toContain('schema_authors')
    await source.dropDatabase()
    expect(await tableNames(client)).not.toContain('schema_authors')
  })

  it('adds missing columns to an existing table', async () => {
    const client = memoryClient()
    const first = new DataSource({ type: 'sqlite', client, entities: [PersonV1], synchronize: true })
    await first.initialize()
    sources.push(first)

    const second = new DataSource({ type: 'sqlite', client, entities: [PersonV2] })
    await second.initialize()
    sources.push(second)

    const log = await second.schemaLog()
    expect(log.upQueries).toHaveLength(1)
    expect(log.upQueries[0]?.query).toContain('ALTER TABLE "schema_people" ADD COLUMN "age" integer')
    await second.synchronize()
    expect((await second.schemaLog()).upQueries).toEqual([])
  })

  it('creates a junction table for a many-to-many relation', async () => {
    const client = memoryClient()
    const source = new DataSource({ type: 'sqlite', client, entities: [SchemaMember, SchemaTag] })
    await source.initialize()
    sources.push(source)
    const log = await source.schemaLog()
    expect(log.upQueries.some((query) => query.query.includes('schema_members_schema_tags_tags'))).toBe(true)
  })
})
