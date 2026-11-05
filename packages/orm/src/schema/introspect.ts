/**
 * 模式内省：薄委托到 Driver 的 Catalog。具体 SQL 由各驱动的 Catalog 实现，
 * 这里不再出现数据库名分支。
 *
 * Schema introspection: a thin delegate to the driver's Catalog. Each driver's
 * Catalog owns the concrete SQL; this module has no database-name branches.
 *
 * @module @veren/orm/schema/introspect
 */

import type { Catalog, ExistingColumn } from '../driver/catalog.ts'
import type { Driver } from '../driver/driver.ts'
import type { QueryRunner } from '../driver/query-runner.ts'

export type { ExistingColumn }

/** 读出全部表名。 / Read every table name. */
export function loadTableNames(driver: Driver, runner: QueryRunner): Promise<string[]> {
  return driver.catalog.listTables(runner)
}

/** 读出单表的列。 / Read one table's columns. */
export function loadColumns(driver: Driver, runner: QueryRunner, tableName: string): Promise<ExistingColumn[]> {
  return driver.catalog.listColumns(runner, tableName)
}

/** Catalog 类型再导出，方便自定义驱动。 / Re-export the Catalog type for custom drivers. */
export type { Catalog }
