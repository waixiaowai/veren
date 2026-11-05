/**
 * PostgreSQL 入口：注册 `postgres` 方言，连接默认走 `pg`（惰性加载）。
 * 客户端库缺失时抛出带安装提示的结构化错误，而不是在 import 期崩溃。
 *
 * The PostgreSQL entry: registers the `postgres` dialect and defaults to `pg`
 * (lazily loaded). A missing client package becomes a structured error with an
 * installation hint instead of an import-time crash.
 *
 * @module @veren/orm/driver/postgres
 */

import { DriverPackageNotInstalledError } from '../errors/index.ts'
import type { DataSourceOptions, Row, SqlClient } from '../types.ts'
import { BaseDriver, poolFromOptions, type ClientPool, type PoolOpener } from './driver.ts'
import { PostgresCatalog } from './catalog.ts'
import { PostgresDialect } from './postgres-dialect.ts'
import { registerDriver } from './registry.ts'

/** 方言名。 / Dialect name. */
export const type = 'postgres'

/** `pg` 的最小结构面（避免把 pg 变成类型依赖）。 / Minimal `pg` shape so pg is not a type dependency. */
interface PgQueryable {
  query(sql: string, values?: readonly unknown[]): Promise<{ rows: readonly Row[]; rowCount?: number | null }>
  release(): void
}

interface PgPoolLike {
  connect(): Promise<PgQueryable>
  end(): Promise<void>
}

interface PgModule {
  Pool: new (config: object) => PgPoolLike
  types: {
    getTypeParser(oid: number, format?: 'text' | 'binary'): (value: string) => unknown
  }
}

/** PostgreSQL 驱动：方言固定，连接可注入。 / PostgreSQL driver: fixed dialect, injectable connection. */
export class PostgresDriver extends BaseDriver {
  constructor(options: DataSourceOptions) {
    super(new PostgresDialect(), options, (candidate) => poolFromOptions(candidate, openPostgresPool), new PostgresCatalog())
  }
}

/** 打开 pg 连接池。 / Open the pg pool. */
const openPostgresPool: PoolOpener = async (options): Promise<ClientPool> => {
  const module = await loadPg()
  const pool = new module.Pool(Object.assign(buildPoolConfig(options), { types: dateStringTypes(module.types) }))
  return {
    acquire: async () => createPgClient(await pool.connect()),
    release: async (client) => {
      await client.close?.()
    },
    close: async () => {
      await pool.end()
    },
  }
}

/** 惰性加载 pg；缺失即结构化失败。 / Load pg lazily; a missing package fails structurally. */
async function loadPg(): Promise<PgModule> {
  const specifier: string = 'pg'
  try {
    return (await import(specifier)) as PgModule
  } catch {
    throw new DriverPackageNotInstalledError('pg')
  }
}

/** DATE（OID 1082）保持字符串，由 ORM 按 UTC 解析；其余类型沿用 pg 默认。 / Keep DATE (OID 1082) as text for UTC parsing; other types keep pg defaults. */
function dateStringTypes(types: PgModule['types']): object {
  return {
    getTypeParser(oid: number, format?: 'text' | 'binary') {
      return oid === 1082 ? (value: string) => value : types.getTypeParser(oid, format)
    },
  }
}

/** 只放入调用方真正给出的连接字段。 / Include only the connection fields the caller actually supplied. */
function buildPoolConfig(options: DataSourceOptions): object {
  const config: { [key: string]: string | number } = {}
  if (options.url !== undefined) config.connectionString = options.url
  if (options.host !== undefined) config.host = options.host
  if (options.port !== undefined) config.port = options.port
  if (options.username !== undefined) config.user = options.username
  if (options.password !== undefined) config.password = options.password
  if (options.database !== undefined) config.database = options.database
  return config
}

/** 把 pg 的 PoolClient 包装成环境桥。 / Wrap a pg PoolClient into the environment bridge. */
function createPgClient(client: PgQueryable): SqlClient {
  return {
    async query(sql, parameters = []) {
      const result = await client.query(sql, [...parameters])
      return { rows: result.rows, affected: result.rowCount ?? undefined }
    },
    async close() {
      client.release()
    },
  }
}

registerDriver({ type, create: (options) => new PostgresDriver(options) })

export { PostgresDialect }
