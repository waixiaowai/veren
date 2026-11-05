import { afterEach, describe, expect, it } from 'vitest'
import {
  Column,
  DataSource,
  Entity,
  Like,
  PrimaryGeneratedColumn,
  type EntityValues,
  type SqlClient,
} from '../src/index.ts'
import '../src/driver/sqlite.ts'
import '../src/driver/postgres.ts'
import '../src/driver/mysql.ts'

/** 测试覆盖的三种方言。 / The three dialects covered by this suite. */
type DataSourceType = 'sqlite' | 'postgres' | 'mysql'

@Entity('portable_units')
class PortableUnit {
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
  payload!: object

  @Column({ type: 'simple-array' })
  tags!: string[]

  @Column({ type: 'varchar', length: 32, nullable: true })
  note?: string | null
}

/** 记录 SQL 的空结果客户端。 / An empty-result client that records SQL. */
class RecordingClient implements SqlClient {
  readonly statements: Array<{ sql: string; parameters: readonly unknown[] }> = []

  async query(sql: string, parameters: readonly unknown[] = []) {
    this.statements.push({ sql, parameters })
    return { rows: [] }
  }
}

/** MySQL 无 RETURNING：每次 INSERT 返回递增 insertId。 / MySQL without RETURNING: each INSERT returns an incrementing insertId. */
class MysqlInsertClient implements SqlClient {
  inserts = 0

  async query(sql: string) {
    if (sql.startsWith('INSERT')) {
      this.inserts += 1
      return { rows: [], insertId: this.inserts }
    }
    return { rows: [] }
  }
}

const sources: DataSource[] = []

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()))
})

/** 建一个方言数据源。 / Build a dialect data source. */
async function sourceOf(type: DataSourceType, client: SqlClient): Promise<DataSource> {
  const source = new DataSource({ type, client, entities: [PortableUnit] })
  await source.initialize()
  sources.push(source)
  return source
}

/** 取某方言的建表 DDL。 / Read the CREATE TABLE DDL for one dialect. */
async function ddlOf(type: DataSourceType): Promise<string> {
  const source = await sourceOf(type, new RecordingClient())
  const log = await source.schemaLog()
  return log.upQueries.map((query) => query.query).join('\n')
}

/** 一条完整插入值。 / A complete insert value. */
function unitValue(): EntityValues {
  return {
    flag: false,
    birthday: new Date('2024-01-02T03:04:05.678Z'),
    happenedAt: new Date('2024-01-02T03:04:05.678Z'),
    amount: '12.50',
    big: '1234567890123',
    payload: { nested: [1, 2] },
    tags: ['a', 'b'],
    note: null,
  }
}

describe('cross-dialect portability', () => {
  it('renders defaults and temporal types with the same contract', async () => {
    const sqlite = await ddlOf('sqlite')
    const postgres = await ddlOf('postgres')
    const mysql = await ddlOf('mysql')

    expect(sqlite).toContain('"flag" integer DEFAULT 1')
    expect(postgres).toContain('"flag" boolean DEFAULT TRUE')
    expect(mysql).toContain('`flag` tinyint(1) DEFAULT 1')
    expect(sqlite).toContain('"happened_at" text')
    expect(postgres).toContain('"happened_at" timestamptz')
    expect(mysql).toContain('`happened_at` datetime(3)')
    expect(sqlite).toContain('"birthday" text')
    expect(postgres).toContain('"birthday" date')
    expect(mysql).toContain('`birthday` date')
    expect(sqlite).toContain('"started_on" text DEFAULT \'2024-01-01\'')
    expect(postgres).toContain('"started_on" date DEFAULT \'2024-01-01\'')
    expect(mysql).toContain('`started_on` date DEFAULT \'2024-01-01\'')
    expect(mysql).toContain('`note` varchar(32) COLLATE utf8mb4_bin')
  })

  it('normalizes criteria, LIKE and null ordering identically', async () => {
    const sqliteClient = new RecordingClient()
    const postgresClient = new RecordingClient()
    const mysqlClient = new RecordingClient()
    const sqlite = await sourceOf('sqlite', sqliteClient)
    const postgres = await sourceOf('postgres', postgresClient)
    const mysql = await sourceOf('mysql', mysqlClient)

    const where = {
      flag: false,
      birthday: new Date('2024-01-02T03:04:05.678Z'),
      note: Like('a%'),
    }
    await sqlite.getRepository(PortableUnit).find({ where, order: { note: 'ASC' } })
    await postgres.getRepository(PortableUnit).find({ where, order: { note: 'ASC' } })
    await mysql.getRepository(PortableUnit).find({ where, order: { note: 'ASC' } })

    const sqliteSql = sqliteClient.statements[0]!
    const postgresSql = postgresClient.statements[0]!
    const mysqlSql = mysqlClient.statements[0]!

    expect(sqliteSql.sql).toContain('LOWER("p"."note") LIKE LOWER(?)')
    expect(postgresSql.sql).toContain('LOWER("p"."note") LIKE LOWER($3)')
    expect(mysqlSql.sql).toContain('LOWER(`p`.`note`) LIKE LOWER(?)')
    expect(sqliteSql.sql).toContain('ORDER BY "p"."note" ASC NULLS LAST')
    expect(postgresSql.sql).toContain('ORDER BY "p"."note" ASC NULLS LAST')
    expect(mysqlSql.sql).toContain('ORDER BY (`p`.`note` IS NULL) ASC, `p`.`note` ASC')

    expect(sqliteSql.parameters).toEqual([0, '2024-01-02', 'a%'])
    expect(postgresSql.parameters).toEqual([false, '2024-01-02', 'a%'])
    expect(mysqlSql.parameters).toEqual([0, '2024-01-02', 'a%'])
  })

  it('returns one insert per row and distinct ids when RETURNING is unavailable', async () => {
    const client = new MysqlInsertClient()
    const source = await sourceOf('mysql', client)
    const result = await source.getRepository(PortableUnit).insert([unitValue(), unitValue()])

    expect(client.inserts).toBe(2)
    expect(result.identifiers.map((identifier) => identifier.id)).toEqual([1, 2])
  })
})
