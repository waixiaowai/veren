/**
 * MySQL / MariaDB 入口：注册 `mysql` 方言，连接默认走 `mysql2`（惰性加载）。
 * MySQL 没有 RETURNING，生成主键靠 insertId 回填。
 *
 * The MySQL/MariaDB entry: registers the `mysql` dialect and defaults to
 * `mysql2` (lazily loaded). MySQL has no RETURNING, so generated keys come back
 * through insertId.
 *
 * @module @veren/orm/driver/mysql
 */

import { DriverPackageNotInstalledError } from '../errors/index.ts'
import type { DataSourceOptions, Row, SqlClient } from '../types.ts'
import { BaseDriver, poolFromOptions, type ClientPool, type PoolOpener } from './driver.ts'
import { MysqlCatalog } from './catalog.ts'
import { MysqlDialect } from './mysql-dialect.ts'
import { registerDriver } from './registry.ts'

/** 方言名。 / Dialect name. */
export const type = 'mysql'

/** `mysql2` 结果头（写语句）。 / The mysql2 result header for write statements. */
interface MysqlResultHeader {
  affectedRows?: number
  insertId?: number
}

/** `mysql2` 连接的最小结构面。 / Minimal mysql2 connection shape. */
interface MysqlConnectionLike {
  query(sql: string, values?: readonly unknown[]): Promise<[readonly Row[] | MysqlResultHeader]>
  release(): void
}

interface MysqlPoolLike {
  getConnection(): Promise<MysqlConnectionLike>
  end(): Promise<void>
}

interface MysqlModule {
  createPool(config: object): MysqlPoolLike
}

/** MySQL 驱动：方言固定，连接可注入。 / MySQL driver: fixed dialect, injectable connection. */
export class MysqlDriver extends BaseDriver {
  constructor(options: DataSourceOptions) {
    super(new MysqlDialect(), options, (candidate) => poolFromOptions(candidate, openMysqlPool), new MysqlCatalog())
  }
}

/** 打开 mysql2 连接池。 / Open the mysql2 pool. */
const openMysqlPool: PoolOpener = async (options): Promise<ClientPool> => {
  const module = await loadMysql2()
  const pool = module.createPool(buildPoolConfig(options))
  return {
    acquire: async () => createMysqlClient(await pool.getConnection()),
    release: async (client) => {
      await client.close?.()
    },
    close: async () => {
      await pool.end()
    },
  }
}

/** 惰性加载 mysql2；缺失即结构化失败。 / Load mysql2 lazily; a missing package fails structurally. */
async function loadMysql2(): Promise<MysqlModule> {
  const specifier: string = 'mysql2/promise'
  try {
    return (await import(specifier)) as MysqlModule
  } catch {
    throw new DriverPackageNotInstalledError('mysql2')
  }
}

/** 只放入调用方真正给出的连接字段；日期统一以字符串返回，由 ORM 归一。 / Include only supplied connection fields; dates return as strings and the ORM normalizes them. */
function buildPoolConfig(options: DataSourceOptions): object {
  const config: { [key: string]: string | number | boolean } = { dateStrings: true }
  if (options.url !== undefined) config.uri = options.url
  if (options.host !== undefined) config.host = options.host
  if (options.port !== undefined) config.port = options.port
  if (options.username !== undefined) config.user = options.username
  if (options.password !== undefined) config.password = options.password
  if (options.database !== undefined) config.database = options.database
  return config
}

/** 把 mysql2 连接包装成环境桥，区分子集与写入结果头。 / Wrap a mysql2 connection, distinguishing row sets from write headers. */
function createMysqlClient(connection: MysqlConnectionLike): SqlClient {
  return {
    async query(sql, parameters = []) {
      const [result] = await connection.query(sql, [...parameters])
      if (Array.isArray(result)) return { rows: result as readonly Row[] }
      const header = result as MysqlResultHeader
      return { rows: [], affected: header.affectedRows, insertId: header.insertId }
    },
    async close() {
      connection.release()
    },
  }
}

registerDriver({ type, create: (options) => new MysqlDriver(options) })

export { MysqlDialect }
