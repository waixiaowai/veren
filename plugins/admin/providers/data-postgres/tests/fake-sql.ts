/**
 * Recording SQL pool for store and plugin lifecycle tests.
 *
 * It answers through a per-test handler, records every statement with its
 * parameters, and reports connection release and close calls. One object plays
 * both roles because the store only needs a pool's `query`, `connect`, and
 * `close`.
 *
 * 用于存储与插件生命周期测试的记录型 SQL 连接池。它通过逐测试处理函数作答，记录每条
 * 语句及其参数，并报告连接归还与关闭调用。同一个对象同时扮演连接池与连接，因为 store
 * 只需要连接池的 `query`、`connect` 与 `close`。
 *
 * @module @veren/admin-data-postgres/tests/fake-sql
 */

import type { SqlConnection, SqlPool, SqlResult } from '../src/store.ts'

/** One recorded query. 一条已记录的查询。 */
export interface RecordedQuery {
  /** Statement text. 语句文本。 */
  readonly sql: string
  /** Positional parameters. 位置参数。 */
  readonly params: readonly unknown[]
}

/** A pool that records statements and answers from a handler. 记录语句并由处理函数作答的连接池。 */
export class FakeSqlPool implements SqlPool, SqlConnection {
  /** Every statement in order. 按顺序排列的全部语句。 */
  readonly queries: RecordedQuery[] = []

  /** Answers for one statement. 单条语句的应答。 */
  handler: (sql: string) => SqlResult = () => ({ rows: [], rowCount: 0 })

  /** How many connections were released. 连接归还次数。 */
  releases = 0

  /** Whether the pool was closed. 连接池是否已关闭。 */
  closed = false

  /**
   * @param sql - statement text 语句文本
   * @param params - positional parameters 位置参数
   * @returns the handler's result 处理函数的结果
   */
  async query(sql: string, params?: readonly unknown[]): Promise<SqlResult> {
    this.queries.push({ sql, params: params ?? [] })
    return this.handler(sql)
  }

  /** @returns this pool posing as its only connection 作为唯一连接的本连接池 */
  async connect(): Promise<SqlConnection> {
    return this
  }

  /** Return this pool posing as its only connection. 作为唯一连接归还本连接池。 */
  release(): void {
    this.releases += 1
  }

  /** Mark the pool closed. 标记连接池已关闭。 */
  async close(): Promise<void> {
    this.closed = true
  }
}
