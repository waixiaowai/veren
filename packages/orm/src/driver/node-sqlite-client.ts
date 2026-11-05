/**
 * Node 内建 SQLite 环境桥（`node:sqlite`，Node 22.5+）。
 * 惰性动态导入：核心与 `@veren/orm/driver/sqlite` 在非 Node 环境被 import
 * 时不会触发对 `node:sqlite` 的解析，只有真正连接时才要求该模块存在。
 *
 * The Node built-in SQLite bridge (`node:sqlite`, Node 22.5+). It is imported
 * lazily: importing the core or `@veren/orm/driver/sqlite` on a non-Node
 * runtime never resolves `node:sqlite`; only an actual connection requires it.
 *
 * @module @veren/orm/driver/node-sqlite-client
 */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { DriverPackageNotInstalledError } from '../errors/index.ts'
import type { DataSourceOptions, SqlClient } from '../types.ts'
import { singleClientPool, type ClientPool } from './driver.ts'

/** `node:sqlite` 模块形状。 / The `node:sqlite` module shape. */
type NodeSqliteModule = typeof import('node:sqlite')

/** 打开一个内存或文件 SQLite 连接池。 / Open an in-memory or file SQLite pool. */
export async function openNodeSqlitePool(options: DataSourceOptions): Promise<ClientPool> {
  const sqlite = await loadNodeSqlite()
  const database = new sqlite.DatabaseSync(options.filename ?? ':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  return singleClientPool(createNodeSqliteClient(database))
}

/** 惰性加载 `node:sqlite`；缺失时给安装提示。 / Load `node:sqlite` lazily; give an installation hint when missing. */
async function loadNodeSqlite(): Promise<NodeSqliteModule> {
  try {
    return await import('node:sqlite')
  } catch {
    throw new DriverPackageNotInstalledError('node:sqlite (built into Node 22.5+, run with --experimental-sqlite on older lines)')
  }
}

/** 把 `node:sqlite` 的 DatabaseSync 包装成环境桥。 / Wrap DatabaseSync into the environment bridge. */
export function createNodeSqliteClient(database: DatabaseSync): SqlClient {
  return {
    async query(sql, parameters = []) {
      const statement = database.prepare(sql)
      const values = parameters as SQLInputValue[]
      if (returnsRows(sql)) {
        return { rows: statement.all(...values) }
      }
      const result = statement.run(...values)
      return {
        rows: [],
        affected: Number(result.changes),
        insertId: result.lastInsertRowid,
      }
    },
    async close() {
      database.close()
    },
  }
}

/** 语句是否返回行（含 RETURNING）；决定走 all 还是 run。 / Whether a statement returns rows (RETURNING included); picks all vs run. */
function returnsRows(sql: string): boolean {
  return /^\s*(?:select|pragma|with|explain|values)\b/i.test(sql) || /\breturning\b/i.test(sql)
}
