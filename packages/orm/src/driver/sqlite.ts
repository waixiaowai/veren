/**
 * SQLite 入口：注册 `sqlite` 方言，连接默认走 Node 内建 `node:sqlite`。
 * 其他平台（Cloudflare D1、libSQL、Bun）只需传 `client`，同一方言即可复用。
 *
 * The SQLite entry: registers the `sqlite` dialect and defaults to Node's
 * built-in `node:sqlite`. Other platforms (Cloudflare D1, libSQL, Bun) reuse
 * the same dialect by passing a `client`.
 *
 * @module @veren/orm/driver/sqlite
 */

import type { DataSourceOptions } from '../types.ts'
import { BaseDriver, poolFromOptions, type ClientPool, type PoolOpener } from './driver.ts'
import { SqliteCatalog } from './catalog.ts'
import { openNodeSqlitePool } from './node-sqlite-client.ts'
import { registerDriver } from './registry.ts'
import { SqliteDialect } from './sqlite-dialect.ts'

/** 方言名。 / Dialect name. */
export const type = 'sqlite'

/** SQLite 驱动：方言固定，连接可注入。 / SQLite driver: fixed dialect, injectable connection. */
export class SqliteDriver extends BaseDriver {
  constructor(options: DataSourceOptions) {
    super(new SqliteDialect(), options, nodePool, new SqliteCatalog())
  }
}

/** 默认打开函数；`client` 注入时优先于它。 / Default opener; an injected `client` wins. */
const nodePool: PoolOpener = (options): Promise<ClientPool> => poolFromOptions(options, openNodeSqlitePool)

registerDriver({ type, create: (options) => new SqliteDriver(options) })

export { SqliteDialect }
