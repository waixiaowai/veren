/**
 * 模式内省：读出数据库里已有的表名与列名。
 * 只读、只用到 SELECT / PRAGMA，不触达任何 DDL——`schemaLog` 因此可以安全地
 * 在生产环境执行。
 *
 * Schema introspection: read the table and column names a database already has.
 * Read-only, using only SELECT / PRAGMA and never DDL — which is why
 * `schemaLog` is safe to run in production.
 *
 * @module @veren/orm/schema/introspect
 */

import type { Driver } from '../driver/driver.ts'
import type { QueryRunner } from '../driver/query-runner.ts'

/** 已有表的列快照。 / Existing column snapshots of one table. */
export interface ExistingColumn {
  name: string
  isNullable: boolean
  isPrimary: boolean
}

/** 读出全部表名。 / Read every table name. */
export async function loadTableNames(driver: Driver, runner: QueryRunner): Promise<string[]> {
  const sql = {
    sqlite: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    postgres: "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'",
    mysql: 'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()',
  }[driver.dialect.name]
  if (sql === undefined) return []
  const result = await runner.query(sql)
  return result.rows.map((row) => String(row.name)).filter((name) => name !== 'undefined')
}

/** 读出单表的列。 / Read one table's columns. */
export async function loadColumns(driver: Driver, runner: QueryRunner, tableName: string): Promise<ExistingColumn[]> {
  if (driver.dialect.name === 'sqlite') return loadSqliteColumns(driver, runner, tableName)
  const placeholder = driver.dialect.createParameter(1)
  const sql = driver.dialect.name === 'postgres'
    ? `SELECT column_name AS name, is_nullable FROM information_schema.columns WHERE table_name = ${placeholder}`
    : `SELECT column_name AS name, is_nullable FROM information_schema.columns WHERE table_name = ${placeholder} AND table_schema = DATABASE()`
  const result = await runner.query(sql, [tableName])
  return result.rows.map((row) => ({
    name: String(row.name),
    isNullable: String(row.is_nullable).toUpperCase() === 'YES',
    isPrimary: false,
  }))
}

/** SQLite 的 PRAGMA 内省（表名不能参数化，必须按标识符转义）。 / SQLite PRAGMA introspection (table names cannot be parameters). */
async function loadSqliteColumns(driver: Driver, runner: QueryRunner, tableName: string): Promise<ExistingColumn[]> {
  const result = await runner.query(`PRAGMA table_info(${driver.dialect.escape(tableName)})`)
  return result.rows.map((row) => ({
    name: String(row.name),
    isNullable: Number(row.notnull) === 0,
    isPrimary: Number(row.pk) > 0,
  }))
}
