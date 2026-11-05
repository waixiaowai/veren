/**
 * 驱动：方言 + 环境桥的组合体。方言决定 SQL，环境桥决定连接从哪来。
 * 新增数据库只需提供一个方言与一个连接池打开函数，上游零改动。
 *
 * A driver: dialect + environment bridge. The dialect owns SQL, the bridge
 * owns where connections come from. Adding a database means providing one
 * dialect and one pool opener; nothing upstream changes.
 *
 * @module @veren/orm/driver/driver
 */

import { CannotExecuteNotConnectedError } from '../errors/index.ts'
import type { ColumnMetadata } from '../metadata/entity-metadata.ts'
import type { ColumnType, DataSourceOptions, SqlClient } from '../types.ts'
import { escapeQueryWithParameters, type SqlDialect } from './dialect.ts'
import { QueryRunner } from './query-runner.ts'

/** 连接池：按需取连接、用完归还、销毁时整体关闭。 / A pool: acquire on demand, release back, close as a whole. */
export interface ClientPool {
  acquire(): Promise<SqlClient>
  release(client: SqlClient): Promise<void>
  close(): Promise<void>
}

/** 打开连接池的环境桥；每个平台各自实现。 / Opens a pool; every platform implements its own. */
export type PoolOpener = (options: DataSourceOptions) => Promise<ClientPool>

/** 驱动公开面。 / Public driver face. */
export interface Driver {
  readonly type: string
  readonly dialect: SqlDialect
  readonly options: DataSourceOptions
  initialize(): Promise<void>
  destroy(): Promise<void>
  acquireClient(): Promise<SqlClient>
  releaseClient(client: SqlClient): Promise<void>
  createQueryRunner(): QueryRunner
  /** 转义标识符 / escape an identifier */
  escape(name: string): string
  /** 命名参数 → 方言占位与有序数组 / named parameters → dialect placeholders and an ordered array */
  escapeQueryWithParameters(sql: string, parameters: Readonly<Record<string, unknown>>): [string, unknown[]]
  /** 写入前的方言归一（布尔、日期、JSON） / dialect normalization on write (boolean, date, JSON) */
  preparePersistentValue(column: ColumnMetadata, value: unknown): unknown
  /** 读出后的方言归一 / dialect normalization after read */
  prepareHydratedValue(column: ColumnMetadata, value: unknown): unknown
}

/** 驱动基类：持有连接池并发放执行器。 / Base driver: owns the pool and hands out query runners. */
export class BaseDriver implements Driver {
  private pool: ClientPool | undefined

  constructor(
    readonly dialect: SqlDialect,
    readonly options: DataSourceOptions,
    private readonly openPool: PoolOpener,
  ) {}

  /** 方言名 / dialect name */
  get type(): string {
    return this.dialect.name
  }

  /** 打开连接池（幂等）；失败即启动失败。 / Open the pool (idempotent); failure fails startup. */
  async initialize(): Promise<void> {
    this.pool ??= await this.openPool(this.options)
  }

  /** 关闭连接池并清空引用；重复调用幂等。 / Close the pool and clear it; idempotent. */
  async destroy(): Promise<void> {
    const pool = this.pool
    this.pool = undefined
    await pool?.close()
  }

  /** 取一个连接；未初始化即拒绝。 / Acquire a client; refuses before initialize. */
  async acquireClient(): Promise<SqlClient> {
    if (this.pool === undefined) throw new CannotExecuteNotConnectedError()
    return this.pool.acquire()
  }

  /** 归还一个连接；池已关闭时静默丢弃。 / Release a client; silently drops it when the pool is closed. */
  async releaseClient(client: SqlClient): Promise<void> {
    await this.pool?.release(client)
  }

  /** 发放一个执行器（惰性连接）。 / Hand out a query runner (lazy connection). */
  createQueryRunner(): QueryRunner {
    return new QueryRunner(this)
  }

  /** 转义标识符。 / Escape an identifier. */
  escape(name: string): string {
    return this.dialect.escape(name)
  }

  /** 命名参数 → 方言占位与有序参数数组。 / Named parameters → placeholders and an ordered array. */
  escapeQueryWithParameters(sql: string, parameters: Readonly<Record<string, unknown>>): [string, unknown[]] {
    return escapeQueryWithParameters(this.dialect, sql, parameters)
  }

  /** 写入前的方言归一，再叠加列转换器。 / Dialect normalization on write, then the column transformer. */
  preparePersistentValue(column: ColumnMetadata, value: unknown): unknown {
    return normalizeForWrite(this.dialect.name, column.type, column.preparePersistentValue(value))
  }

  /** 读出后的方言归一，再叠加列转换器。 / Dialect normalization after read, then the column transformer. */
  prepareHydratedValue(column: ColumnMetadata, value: unknown): unknown {
    return column.prepareHydratedValue(normalizeAfterRead(this.dialect.name, column.type, value))
  }
}

/** 单连接池：SQLite、D1 这类「一个连接就是一个库」的环境。 / A single-client pool for SQLite/D1-style environments. */
export function singleClientPool(client: SqlClient): ClientPool {
  return {
    acquire: async () => client,
    release: async () => undefined,
    close: async () => {
      await client.close?.()
    },
  }
}

/**
 * 优先使用调用方注入的环境桥；没有时才走驱动默认的打开函数。
 * Use an injected environment bridge first; only fall back to the driver's own
 * opener when the caller supplied none.
 */
export async function poolFromOptions(
  options: DataSourceOptions,
  fallback: PoolOpener,
): Promise<ClientPool> {
  const injected = options.client
  if (injected === undefined) return fallback(options)
  const client = typeof injected === 'function' ? await injected(options) : injected
  return singleClientPool(client)
}

/** 日期类列：读取时把字符串还原为 Date。 / Date-like columns: strings become Date on read. */
const DATE_TYPES = new Set<ColumnType>(['date', 'datetime', 'timestamp'])

/** 写入归一：布尔与日期按方言转换，JSON/数组转文本。 / Write normalization: boolean and date per dialect, JSON/array to text. */
function normalizeForWrite(dialect: string, type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Date) {
    if (dialect === 'postgres') return value
    return dialect === 'mysql' ? formatMysqlDate(value) : value.toISOString()
  }
  if (typeof value === 'boolean') return dialect === 'postgres' ? value : (value ? 1 : 0)
  if (type === 'json' || type === 'jsonb' || type === 'simple-json') {
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  if (type === 'simple-array') return Array.isArray(value) ? value.join(',') : value
  return value
}

/** MySQL DATETIME 文本：`YYYY-MM-DD HH:mm:ss.SSS`。 / MySQL DATETIME text. */
function formatMysqlDate(value: Date): string {
  return value.toISOString().slice(0, 23).replace('T', ' ')
}

/** 读取归一：SQLite 的 0/1 转布尔、文本日期转 Date、JSON 文本解析。 / Read normalization: 0/1 to boolean, text dates to Date, JSON text parsed. */
function normalizeAfterRead(dialect: string, type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (type === 'boolean') return typeof value === 'boolean' ? value : value === 1 || value === '1' || value === true
  if (type === 'json' || type === 'jsonb' || type === 'simple-json') {
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  if (type === 'simple-array') return typeof value === 'string' ? value.split(',') : value
  if (DATE_TYPES.has(type) && dialect !== 'postgres' && typeof value === 'string') return new Date(value)
  return value
}
