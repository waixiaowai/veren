/**
 * SQL transport contracts and the record store behind the PostgreSQL adapter.
 *
 * The store is the only layer that talks SQL. It loads every record once into
 * the adapter's mirror, applies single-record upserts and deletes through a
 * pooled connection, and runs multi-record work on one checked-out connection
 * inside `BEGIN`/`COMMIT` so a failed transaction rolls back as a whole.
 *
 * The pool is injected as {@link SqlPool} rather than imported here, which keeps
 * the SQL layer testable with a recording double and lets the plugin own `pg`.
 *
 * 适配器背后的 SQL 传输契约与记录存储。store 是唯一直接接触 SQL 的层：它把全部记录
 * 一次性载入适配器的内存镜像，通过连接池执行单条 upsert/delete，并在一条独占连接上用
 * `BEGIN`/`COMMIT` 执行多记录工作，因此失败的事务整体回滚。
 *
 * 连接池以 {@link SqlPool} 注入而非在此 import，使 SQL 层可用记录型替身测试，并让插件
 * 独占 `pg` 依赖。
 *
 * @module @veren/admin-data-postgres/store
 */

import type { AdminEntity, HealthReport } from '@veren/admin-contract'
import {
  FALLBACK_TABLE,
  PLATFORM_TABLES,
  planLoad,
  planLoadFallback,
  planRemove,
  planUpsert,
  schemaStatements,
} from './schema.ts'

/** Result subset every SQL call must provide. 每次 SQL 调用必须提供的结果子集。 */
export interface SqlResult {
  /** Returned rows. 返回的行。 */
  readonly rows: readonly Record<string, unknown>[]
  /** Affected row count, when the statement reports one. 语句报告时的受影响行数。 */
  readonly rowCount: number | null
}

/** One query session: a pool or a checked-out connection. 一个查询会话：连接池或独占连接。 */
export interface SqlSession {
  /**
   * Run one parameterized statement.
   * @param sql - statement text 语句文本
   * @param params - positional parameters 位置参数
   * @returns the result 结果
   */
  query(sql: string, params?: readonly unknown[]): Promise<SqlResult>
}

/** One checked-out connection. 一条已独占的连接。 */
export interface SqlConnection extends SqlSession {
  /** Return the connection to its pool. 把连接归还连接池。 */
  release(): void
}

/** The pool contract the plugin provides and the store consumes. 插件提供、store 消费的连接池契约。 */
export interface SqlPool extends SqlSession {
  /**
   * Check out one connection.
   * @returns the connection 连接
   */
  connect(): Promise<SqlConnection>

  /** Close the pool and release every connection. 关闭连接池并释放全部连接。 */
  close(): Promise<void>
}

/** Writes bound to one transaction or to the pool's auto-commit mode. 绑定到事务或连接池自动提交模式的写入。 */
export interface RecordWriter {
  /**
   * Insert or replace one record.
   * @param collection - logical collection name 逻辑集合名
   * @param record - the complete record 完整记录
   * @returns resolution after durability 持久化后的 resolve
   */
  upsert(collection: string, record: AdminEntity): Promise<void>

  /**
   * Delete one record.
   * @param collection - logical collection name 逻辑集合名
   * @param id - record id 记录 id
   * @returns whether the row existed 行此前是否存在
   */
  remove(collection: string, id: string): Promise<boolean>
}

/** The full record store: loading, writing, transactions and lifecycle. 完整记录存储：加载、写入、事务与生命周期。 */
export interface RecordStore extends RecordWriter {
  /**
   * Read every stored record, grouped by logical collection.
   * @returns collection name to records 集合名到记录
   */
  loadAll(): Promise<ReadonlyMap<string, readonly AdminEntity[]>>

  /**
   * Run work inside one database transaction.
   * @param work - writes bound to that transaction 绑定到该事务的写入
   * @returns the work's value 工作单元的返回值
   */
  transaction<T>(work: (writer: RecordWriter) => Promise<T>): Promise<T>

  /** Probe the database. 探测数据库。 @returns the health verdict 健康结论 */
  health(): Promise<HealthReport>

  /** Close the pool. 关闭连接池。 */
  close(): Promise<void>
}

/** Advisory-lock key serializing schema bootstrap across processes. 跨进程串行化 schema 引导的 advisory lock 键。 */
export const SCHEMA_LOCK_KEY = '7321190201'

/** Schema names are interpolated into `search_path` and DDL, so they stay a strict identifier. schema 名会插入 `search_path` 与 DDL，因此必须是严格标识符。 */
const SCHEMA_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/

/**
 * Build the record store over one SQL pool.
 *
 * @param pool - the connected pool 已连接的连接池
 * @returns the record store 记录存储
 */
export function createSqlRecordStore(pool: SqlPool): RecordStore {
  return {
    ...createWriter(pool),
    loadAll: () => loadAll(pool),
    transaction: <T>(work: (writer: RecordWriter) => Promise<T>) => runTransaction(pool, work),
    health: () => probe(pool),
    close: () => pool.close(),
  }
}

/**
 * Create every table and index idempotently, serialized by an advisory lock.
 *
 * @param pool - the connected pool 已连接的连接池
 * @param schema - target schema; created when absent 目标 schema；缺失时创建
 * @throws Error naming the bootstrap failure 命名引导失败的错误
 */
export async function ensureSchema(pool: SqlPool, schema = 'public'): Promise<void> {
  assertSchemaName(schema)
  const connection = await pool.connect()
  try {
    await connection.query('BEGIN')
    await connection.query('SELECT pg_advisory_xact_lock($1::bigint)', [SCHEMA_LOCK_KEY])
    if (schema !== 'public') {
      const existing = await connection.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema])
      if (existing.rows.length === 0) await connection.query(`CREATE SCHEMA "${schema}"`)
    }
    for (const statement of schemaStatements()) await connection.query(statement)
    await connection.query('COMMIT')
  } catch (error) {
    await rollback(connection)
    throw new Error(`admin-data-postgres: schema bootstrap failed: ${messageOf(error)}`, { cause: error })
  } finally {
    connection.release()
  }
}

/**
 * Reject a schema name that could escape its identifier position.
 *
 * @param schema - candidate schema name 候选 schema 名
 * @throws Error naming the accepted pattern 命名可接受模式与错误
 */
export function assertSchemaName(schema: string): void {
  if (SCHEMA_NAME_RE.test(schema)) return
  throw new Error(`admin-data-postgres: config.schema '${schema}' must match ${SCHEMA_NAME_RE}`)
}

/**
 * Build a writer over one session.
 *
 * @param session - pool or connection 连接池或连接
 * @returns the writer 写入器
 */
function createWriter(session: SqlSession): RecordWriter {
  return {
    async upsert(collection: string, record: AdminEntity): Promise<void> {
      const plan = planUpsert(collection, record)
      await session.query(plan.sql, plan.params)
    },
    async remove(collection: string, id: string): Promise<boolean> {
      const plan = planRemove(collection, id)
      const result = await session.query(plan.sql, plan.params)
      return (result.rowCount ?? 0) > 0
    },
  }
}

/**
 * Load every platform table plus every fallback collection.
 *
 * @param pool - the connected pool 已连接的连接池
 * @returns collection name to records 集合名到记录
 * @throws Error naming a row whose document lacks a string `id` 命名缺少字符串 `id` 的文档行
 */
async function loadAll(pool: SqlPool): Promise<ReadonlyMap<string, readonly AdminEntity[]>> {
  const loaded = new Map<string, AdminEntity[]>()
  for (const table of PLATFORM_TABLES) {
    const plan = planLoad(table)
    const result = await pool.query(plan.sql)
    loaded.set(table.collection, result.rows.map((row) => decodeRecord(row['data'], table.table)))
  }
  const fallback = await pool.query(planLoadFallback().sql)
  for (const row of fallback.rows) {
    const collection = row['collection']
    if (typeof collection !== 'string') {
      throw new Error(`admin-data-postgres: table '${FALLBACK_TABLE}' holds a row without a string 'collection'`)
    }
    const records = loaded.get(collection) ?? []
    records.push(decodeRecord(row['data'], FALLBACK_TABLE))
    loaded.set(collection, records)
  }
  return loaded
}

/**
 * Decode one stored document into a record, failing loud on a broken row.
 *
 * @param value - the JSONB value as the driver returned it 驱动返回的 JSONB 值
 * @param source - table name used in the message 消息中使用的表名
 * @returns the record 记录
 * @throws Error when the value is not an object with a string `id` 值不是带字符串 `id` 的对象时抛出
 */
function decodeRecord(value: unknown, source: string): AdminEntity {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`admin-data-postgres: table '${source}' holds a document that is not an object`)
  }
  const record = parsed as Record<string, unknown>
  const id = record['id']
  if (typeof id !== 'string') {
    throw new Error(`admin-data-postgres: table '${source}' holds a document without a string 'id'`)
  }
  return { ...record, id }
}

/**
 * Run work on one checked-out connection inside a transaction.
 *
 * @param pool - the connected pool 已连接的连接池
 * @param work - writes bound to the transaction 绑定到事务的写入
 * @returns the work's value 工作单元的返回值
 */
async function runTransaction<T>(pool: SqlPool, work: (writer: RecordWriter) => Promise<T>): Promise<T> {
  const connection = await pool.connect()
  try {
    await connection.query('BEGIN')
    const value = await work(createWriter(connection))
    await connection.query('COMMIT')
    return value
  } catch (error) {
    await rollback(connection)
    throw error
  } finally {
    connection.release()
  }
}

/**
 * Roll back without masking the failure that caused it; a rollback failure
 * means the connection is already unusable and the pool drops it on release.
 * 回滚但不掩盖原始失败；回滚失败说明连接已不可用，连接池会在归还时丢弃它。
 * @param connection - the failed transaction's connection 失败事务的连接
 */
async function rollback(connection: SqlConnection): Promise<void> {
  try {
    await connection.query('ROLLBACK')
  } catch {
    // Intentionally empty: see the contract above. 刻意留空：见上方的契约说明。
  }
}

/**
 * Probe the database with the cheapest round trip.
 *
 * @param pool - the connected pool 已连接的连接池
 * @returns the health verdict 健康结论
 */
async function probe(pool: SqlPool): Promise<HealthReport> {
  try {
    await pool.query('SELECT 1')
    return { status: 'ok' }
  } catch (error) {
    return { status: 'down', detail: messageOf(error) }
  }
}

/**
 * Render an unknown failure as human-readable text.
 *
 * @param error - any thrown value 任意抛出值
 * @returns the message 消息文本
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
