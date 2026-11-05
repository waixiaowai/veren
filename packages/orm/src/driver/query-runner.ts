/**
 * 查询执行器：连接的持有者、事务状态的唯一裁判。
 * 每次查询惰性建连；释放后再查询即失败；事务未开时的提交/回滚即失败。
 *
 * The query runner: the holder of a connection and the only judge of
 * transaction state. Connections are lazy; use after release fails; committing
 * or rolling back without a transaction fails.
 *
 * @module @veren/orm/driver/query-runner
 */

import {
  OrmError,
  QueryFailedError,
  QueryRunnerAlreadyReleasedError,
  TransactionAlreadyStartedError,
  TransactionNotStartedError,
  UnsupportedFeatureError,
} from '../errors/index.ts'
import type { EntityManager } from '../runtime/entity-manager.ts'
import type { IsolationLevel, QueryResult, SqlClient } from '../types.ts'
import type { Driver } from './driver.ts'

/** 一次查询的执行者；一个实例对应一条连接与一个事务范围。 / One query executor; one instance owns one connection and one transaction scope. */
export class QueryRunner {
  /** 事务内的管理器由 EntityManager.transaction 注入 / the transactional manager, injected by EntityManager.transaction */
  manager: EntityManager | undefined
  private client: SqlClient | undefined
  private released = false
  private active = false

  constructor(readonly driver: Driver) {}

  /** 是否已释放 / whether the runner is released */
  get isReleased(): boolean {
    return this.released
  }

  /** 事务是否活跃 / whether a transaction is active */
  get isTransactionActive(): boolean {
    return this.active
  }

  /** 惰性建连并返回连接。 / Connect lazily and return the client. */
  async connect(): Promise<SqlClient> {
    if (this.released) throw new QueryRunnerAlreadyReleasedError()
    this.client ??= await this.driver.acquireClient()
    return this.client
  }

  /** 执行一条参数化 SQL，错误统一包成 QueryFailedError。 / Run one parameterized SQL; errors become QueryFailedError. */
  async query(sql: string, parameters: readonly unknown[] = []): Promise<QueryResult> {
    const client = await this.connect()
    try {
      const result = await client.query(sql, parameters)
      return { raw: result, rows: result.rows, affected: result.affected, insertId: result.insertId }
    } catch (error) {
      throw error instanceof OrmError ? error : new QueryFailedError(sql, parameters, error)
    }
  }

  /** 开启事务；重复开启即失败。 / Start a transaction; starting twice fails. */
  async startTransaction(isolation?: IsolationLevel): Promise<void> {
    if (!this.driver.dialect.capabilities.transactions) throw new UnsupportedFeatureError('Transactions')
    if (this.active) throw new TransactionAlreadyStartedError()
    for (const statement of this.driver.dialect.beginStatements(isolation)) {
      await this.query(statement)
    }
    this.active = true
  }

  /** 提交事务；无事务即失败。 / Commit; committing without a transaction fails. */
  async commitTransaction(): Promise<void> {
    this.assertActive()
    await this.query(this.driver.dialect.commitStatement)
    this.active = false
  }

  /** 回滚事务；无事务即失败。 / Roll back; rolling back without a transaction fails. */
  async rollbackTransaction(): Promise<void> {
    this.assertActive()
    await this.query(this.driver.dialect.rollbackStatement)
    this.active = false
  }

  /** 释放连接；活跃事务先回滚，且不掩盖调用方原始错误。 / Release the client; an active transaction rolls back first without masking the original error. */
  async release(): Promise<void> {
    if (this.released) return
    try {
      if (this.active) {
        this.active = false
        await this.query(this.driver.dialect.rollbackStatement)
      }
    } catch {
      // 回滚失败不改变「连接必须归还」的事实 / a failed rollback must not block returning the client
    }
    this.released = true
    const client = this.client
    this.client = undefined
    if (client !== undefined) await this.driver.releaseClient(client)
  }

  /** 事务状态断言。 / Transaction state assertion. */
  private assertActive(): void {
    if (!this.active) throw new TransactionNotStartedError()
  }
}
