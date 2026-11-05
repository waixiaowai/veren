import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BaseDriver,
  Column,
  DataSource,
  Entity,
  getRegisteredDriverTypes,
  PrimaryGeneratedColumn,
  registerDriver,
  singleClientPool,
  SqliteDialect,
  type DataSourceOptions,
  type SqlClient,
  type SqlDialect,
} from '../src/index.ts'
import { createNodeSqliteClient } from '../src/driver/node-sqlite-client.ts'
import { SqliteCatalog } from '../src/driver/catalog.ts'
import '../src/driver/sqlite.ts'
import '../src/driver/d1.ts'
import '../src/driver/postgres.ts'
import '../src/driver/mysql.ts'

@Entity('widgets')
class Widget {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  name!: string
}

/** 自定义方言：委托 SQLite 但换成自己的名字，证明扩展点只需一个注册动作。 / Custom dialect delegating to SQLite under a new name; proves the extension point is one registration. */
class CustomDialect implements SqlDialect {
  private readonly base = new SqliteDialect()
  readonly name = 'custom'
  readonly capabilities = this.base.capabilities
  readonly values = this.base.values
  readonly query = this.base.query
  readonly schema = this.base.schema
  readonly commitStatement = this.base.commitStatement
  readonly rollbackStatement = this.base.rollbackStatement
  readonly nowExpression = this.base.nowExpression

  escape(identifier: string): string { return this.base.escape(identifier) }
  createParameter(): string { return this.base.createParameter() }
  mapColumnType(column: Parameters<SqlDialect['mapColumnType']>[0]): string { return this.base.mapColumnType(column) }
  beginStatements(isolation?: Parameters<SqlDialect['beginStatements']>[0]): string[] { return this.base.beginStatements(isolation) }
  supportsType(): boolean { return this.base.supportsType() }
}

const sources: DataSource[] = []

/** 录制型客户端：只证明驱动把 SQL 发到了注入的环境桥。 / Recording client proving the driver talks to the injected bridge. */
class RecordingClient implements SqlClient {
  readonly statements: string[] = []

  async query(sql: string): Promise<{ rows: readonly never[] }> {
    this.statements.push(sql)
    return { rows: [] }
  }
}

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

describe('driver extension point', () => {
  it('registers the built-in driver entries', () => {
    expect(getRegisteredDriverTypes()).toEqual(expect.arrayContaining(['sqlite', 'd1', 'postgres', 'mysql']))
  })

  it('opens lazy PostgreSQL and MySQL pools from configuration', async () => {
    const postgres = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: 1,
      username: 'user',
      password: 'secret',
      database: 'demo',
      entities: [Widget],
    })
    await postgres.initialize()
    expect(postgres.isInitialized).toBe(true)
    await postgres.destroy()

    const mysql = new DataSource({
      type: 'mysql',
      host: '127.0.0.1',
      port: 1,
      username: 'user',
      password: 'secret',
      database: 'demo',
      entities: [Widget],
    })
    await mysql.initialize()
    expect(mysql.isInitialized).toBe(true)
    await mysql.destroy()
  })

  it('runs PostgreSQL and MySQL drivers with an injected client', async () => {
    const postgres = new DataSource({ type: 'postgres', client: new RecordingClient(), entities: [Widget] })
    await postgres.initialize()
    sources.push(postgres)
    const pgBuilder = postgres.getRepository(Widget).createQueryBuilder('w')
    pgBuilder.where('w.id = :id', { id: 1 })
    expect(pgBuilder.getQueryAndParameters()).toEqual([
      'SELECT "w"."id" AS "w_id", "w"."name" AS "w_name" FROM "widgets" "w" WHERE w.id = $1',
      [1],
    ])

    const mysql = new DataSource({ type: 'mysql', client: new RecordingClient(), entities: [Widget] })
    await mysql.initialize()
    sources.push(mysql)
    const mysqlBuilder = mysql.getRepository(Widget).createQueryBuilder('w')
    mysqlBuilder.where('w.id = :id', { id: 1 })
    expect(mysqlBuilder.getQueryAndParameters()).toEqual([
      'SELECT `w`.`id` AS `w_id`, `w`.`name` AS `w_name` FROM `widgets` `w` WHERE w.id = ?',
      [1],
    ])
  })

  it('runs a custom dialect registered through registerDriver()', async () => {
    registerDriver({
      type: 'custom',
      create: (options: DataSourceOptions) => new BaseDriver(new CustomDialect(), options, async () => singleClientPool(createNodeSqliteClient(new DatabaseSync(':memory:'))), new SqliteCatalog()),
    })
    const source = new DataSource({ type: 'custom', entities: [Widget], synchronize: true })
    await source.initialize()
    sources.push(source)
    const widgets = source.getRepository(Widget)
    const saved = await widgets.save({ name: 'custom' } as Widget)
    expect(saved.id).toBe(1)
    expect((await widgets.find())[0]?.name).toBe('custom')
  })
})
