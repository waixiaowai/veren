/**
 * Cloudflare D1 入口：复用 SQLite 方言，连接由 D1 绑定提供。
 * D1 不支持显式事务，因此事务能力在方言层关闭，调用事务会明确失败。
 *
 * The Cloudflare D1 entry: reuses the SQLite dialect with a connection supplied
 * by the D1 binding. D1 has no explicit transactions, so the capability is
 * disabled at the dialect level and transaction calls fail loudly.
 *
 * @module @veren/orm/driver/d1
 */

import { DriverOptionNotSetError } from '../errors/index.ts'
import type { DataSourceOptions, Row, SqlClient } from '../types.ts'
import { BaseDriver, poolFromOptions, type ClientPool, type PoolOpener } from './driver.ts'
import { SqliteCatalog } from './catalog.ts'
import { registerDriver } from './registry.ts'
import { SqliteDialect } from './sqlite-dialect.ts'

/** 方言名。 / Dialect name. */
export const type = 'd1'

/** D1 预处理语句的最小结构。 / Minimal D1 prepared-statement shape. */
export interface D1PreparedStatementLike {
  bind(...values: readonly unknown[]): D1PreparedStatementLike
  all?(): Promise<{ results?: readonly Row[] }>
  run?(): Promise<{ meta?: { changes?: number; last_row_id?: number } }>
}

/** D1 数据库绑定的最小结构（`env.DB`）。 / Minimal D1 database binding shape (`env.DB`). */
export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike
}

/** D1 驱动：连接必须由调用方注入。 / D1 driver: the connection must be injected. */
export class D1Driver extends BaseDriver {
  constructor(options: DataSourceOptions) {
    super(new SqliteDialect({ transactions: false, savepoints: false }), options, (candidate) => poolFromOptions(candidate, missingClient), new SqliteCatalog())
  }
}

/** 未注入 client 时的明确失败。 / Explicit failure when no client was injected. */
const missingClient: PoolOpener = async (): Promise<ClientPool> => {
  throw new DriverOptionNotSetError('client (pass createD1Client(env.DB) to the data source options)')
}

/**
 * 把 D1 绑定包装成环境桥。Cloudflare Workers 里没有任何 Node 内建参与。
 * Wraps a D1 binding into the environment bridge; no Node built-in is involved
 * on Cloudflare Workers.
 */
export function createD1Client(database: D1DatabaseLike): SqlClient {
  return {
    async query(sql, parameters = []) {
      const statement = database.prepare(sql).bind(...parameters)
      if (returnsRows(sql)) {
        const result = await statement.all?.()
        return { rows: result?.results ?? [] }
      }
      const result = await statement.run?.()
      return {
        rows: [],
        affected: result?.meta?.changes,
        insertId: result?.meta?.last_row_id,
      }
    },
  }
}

registerDriver({ type, create: (options) => new D1Driver(options) })

export { SqliteDialect }

/** 语句是否返回行。 / Whether the statement returns rows. */
function returnsRows(sql: string): boolean {
  return /^\s*(?:select|pragma|with|explain|values)\b/i.test(sql) || /\breturning\b/i.test(sql)
}
