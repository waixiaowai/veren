/**
 * 目录内省策略：问数据库「有哪些表/列」。这是 I/O，不放在纯方言里；
 * 每个 Driver 持有一个 Catalog，SchemaBuilder 只通过接口读取。
 *
 * Catalog strategy: ask the database which tables/columns exist. This is I/O,
 * so it lives on the Driver rather than the pure dialect; SchemaBuilder reads
 * only through the interface.
 *
 * @module @veren/orm/driver/catalog
 */

import { UnsupportedFeatureError } from '../errors/index.ts'
import type { Row } from '../types.ts'
import type { QueryRunner } from './query-runner.ts'

/** 已有列的快照。 / Snapshot of an existing column. */
export interface ExistingColumn {
  name: string
  isNullable: boolean
  isPrimary: boolean
}

/** 结构内省接口。 / Schema introspection interface. */
export interface Catalog {
  listTables(runner: QueryRunner): Promise<string[]>
  listColumns(runner: QueryRunner, tableName: string): Promise<ExistingColumn[]>
}

/** 不提供内省的驱动；schemaLog/synchronize 会明确失败。 / A driver without introspection; schemaLog/synchronize fail loudly. */
export class UnsupportedCatalog implements Catalog {
  async listTables(): Promise<string[]> {
    throw new UnsupportedFeatureError('Schema introspection (provide a Catalog on the driver)')
  }

  async listColumns(): Promise<ExistingColumn[]> {
    throw new UnsupportedFeatureError('Schema introspection (provide a Catalog on the driver)')
  }
}

/** SQLite：sqlite_master + PRAGMA table_info。 / SQLite: sqlite_master + PRAGMA table_info. */
export class SqliteCatalog implements Catalog {
  async listTables(runner: QueryRunner): Promise<string[]> {
    const result = await runner.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    return result.rows.map((row) => String(row.name)).filter((name) => name !== 'undefined')
  }

  async listColumns(runner: QueryRunner, tableName: string): Promise<ExistingColumn[]> {
    const result = await runner.query(`PRAGMA table_info(${quote(tableName)})`)
    return result.rows.map((row) => ({
      name: String(row.name),
      isNullable: Number(row.notnull) === 0,
      isPrimary: Number(row.pk) > 0,
    }))
  }
}

/** PostgreSQL：information_schema（public schema）。 / PostgreSQL: information_schema (public schema). */
export class PostgresCatalog implements Catalog {
  async listTables(runner: QueryRunner): Promise<string[]> {
    const result = await runner.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'")
    return tableNames(result.rows)
  }

  async listColumns(runner: QueryRunner, tableName: string): Promise<ExistingColumn[]> {
    const result = await runner.query(
      'SELECT column_name AS name, is_nullable FROM information_schema.columns WHERE table_name = $1',
      [tableName],
    )
    return columnNames(result.rows)
  }
}

/** MySQL：information_schema + 当前 DATABASE()。 / MySQL: information_schema + current DATABASE(). */
export class MysqlCatalog implements Catalog {
  async listTables(runner: QueryRunner): Promise<string[]> {
    const result = await runner.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()')
    return tableNames(result.rows)
  }

  async listColumns(runner: QueryRunner, tableName: string): Promise<ExistingColumn[]> {
    const result = await runner.query(
      'SELECT column_name AS name, is_nullable FROM information_schema.columns WHERE table_name = ? AND table_schema = DATABASE()',
      [tableName],
    )
    return columnNames(result.rows)
  }
}

/** 表名行归一。 / Normalize table-name rows. */
function tableNames(rows: readonly Row[]): string[] {
  return rows.map((row) => String(row.name)).filter((name) => name !== 'undefined')
}

/** 列行归一。 / Normalize column rows. */
function columnNames(rows: readonly Row[]): ExistingColumn[] {
  return rows.map((row) => ({
    name: String(row.name),
    isNullable: String(row.is_nullable).toUpperCase() === 'YES',
    isPrimary: false,
  }))
}

/** SQLite PRAGMA 的表名不能用参数，按标识符转义。 / SQLite PRAGMA table names cannot be parameters. */
function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
