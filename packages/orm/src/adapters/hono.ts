/**
 * Hono 薄入口：每个请求一个查询执行器与实体管理器，可选自动事务。
 * 只依赖结构化接口，不 import hono——Hono 的版本与运行时都由宿主决定。
 *
 * The Hono thin entry: one query runner and entity manager per request, with an
 * optional transaction. Only structural interfaces are used and hono is never
 * imported — its version and runtime stay the host's choice.
 *
 * @module @veren/orm/hono
 */

import type { QueryRunner } from '../driver/query-runner.ts'
import { EntityManager } from '../runtime/entity-manager.ts'
import type { DataSource } from '../runtime/data-source.ts'
import type { IsolationLevel } from '../types.ts'

/** Hono 上下文的最小结构面。 / The minimal Hono context shape. */
export interface HonoContextLike {
  get(key: string): unknown
  set(key: string, value: unknown): void
  res?: { status: number }
}

/** Hono 的 next。 / Hono's next. */
export type HonoNext = () => Promise<void>

/** Hono 中间件。 / A Hono middleware. */
export type HonoMiddleware = (context: HonoContextLike, next: HonoNext) => Promise<void>

/** HTTP 适配选项。 / HTTP adapter options. */
export interface HttpOrmOptions {
  /** 上下文键，默认 orm / context key, default `orm` */
  key?: string
  /** 是否自动包事务，默认 true / wrap a transaction automatically, default true */
  transaction?: boolean
  /** 事务隔离级别 / transaction isolation level */
  isolation?: IsolationLevel
}

/** ctx 上的默认键。 / The default context key. */
export const DEFAULT_ORM_KEY = 'orm'

/**
 * 创建 Hono 中间件：请求进入时取连接并可选开启事务，响应状态码 >= 400
 * 时回滚，否则提交；连接必定归还。
 *
 * Create the Hono middleware: acquire a connection and optionally start a
 * transaction on entry; roll back when the response status is >= 400, commit
 * otherwise; always return the connection.
 */
export function createHonoOrmMiddleware(dataSource: DataSource, options: HttpOrmOptions = {}): HonoMiddleware {
  const key = options.key ?? DEFAULT_ORM_KEY
  return async (context, next) => {
    const runner = dataSource.createQueryRunner()
    await runner.connect()
    const transactional = options.transaction !== false && dataSource.driver.dialect.capabilities.transactions
    context.set(key, new EntityManager(dataSource, runner))
    try {
      if (transactional) await runner.startTransaction(options.isolation)
      await next()
      await settle(runner, transactional, (context.res?.status ?? 200) < 400)
    } catch (error) {
      await settle(runner, transactional, false)
      throw error
    } finally {
      await runner.release()
    }
  }
}

/** 从上下文取管理器。 / Read the manager from the context. */
export function getHonoOrm(context: HonoContextLike, key = DEFAULT_ORM_KEY): EntityManager {
  const manager = context.get(key)
  if (!(manager instanceof EntityManager)) {
    throw new Error(`No ORM entity manager is attached under "${key}". Mount createHonoOrmMiddleware() before this handler.`)
  }
  return manager
}

/** 提交或回滚，两者都幂等。 / Commit or roll back; both are idempotent. */
async function settle(runner: QueryRunner, transactional: boolean, commit: boolean): Promise<void> {
  if (!transactional || !runner.isTransactionActive) return
  if (commit) await runner.commitTransaction()
  else await runner.rollbackTransaction()
}
