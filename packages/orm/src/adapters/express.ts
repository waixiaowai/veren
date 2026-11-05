/**
 * Express 薄入口：每个请求一个查询执行器与实体管理器，响应结束时提交或回滚。
 * 只依赖结构化接口，不 import express——框架版本由宿主决定。
 *
 * The Express thin entry: one query runner and entity manager per request,
 * committing or rolling back when the response settles. Only structural
 * interfaces are used and express is never imported.
 *
 * @module @veren/orm/express
 */

import type { QueryRunner } from '../driver/query-runner.ts'
import { EntityManager } from '../runtime/entity-manager.ts'
import type { DataSource } from '../runtime/data-source.ts'
import type { IsolationLevel } from '../types.ts'
import type { HttpOrmOptions } from './hono.ts'

/** Express 请求的最小结构面；适配器只按 key 挂一个值。 / Minimal Express request; the adapter attaches one value under `key`. */
export interface ExpressRequestLike {
  [key: string]: unknown
}

/** Express 响应的最小结构面。 / Minimal Express response. */
export interface ExpressResponseLike {
  statusCode: number
  on(event: 'finish' | 'close', listener: () => void): void
}

/** Express next。 / Express next. */
export type ExpressNext = (error?: unknown) => void

/** Express 中间件。 / An Express middleware. */
export type ExpressMiddleware = (request: ExpressRequestLike, response: ExpressResponseLike, next: ExpressNext) => void

/** 请求上挂载管理器的默认键。 / Default key for the manager attached to the request. */
export const DEFAULT_ORM_KEY = 'orm'

/**
 * 创建 Express 中间件：进入时取连接并可选开启事务；`finish` 时按状态码提交
 * 或回滚，`close`（客户端提前断开）时回滚。连接在任一分支只归还一次。
 *
 * Create the Express middleware: acquire a connection and optionally start a
 * transaction on entry; commit or roll back on `finish` by status code, roll
 * back on `close` (client aborted). The connection returns exactly once.
 */
export function createExpressOrmMiddleware(dataSource: DataSource, options: HttpOrmOptions = {}): ExpressMiddleware {
  const key = options.key ?? DEFAULT_ORM_KEY
  return (request, response, next) => {
    const runner = dataSource.createQueryRunner()
    const transactional = options.transaction !== false && dataSource.driver.dialect.capabilities.transactions
    const state = { settled: false }
    void runner.connect()
      .then(async () => {
        if (transactional) await runner.startTransaction(options.isolation)
      })
      .then(() => {
        request[key] = new EntityManager(dataSource, runner)
        response.on('finish', () => { void settle(runner, transactional, response.statusCode < 400, state) })
        response.on('close', () => { void settle(runner, transactional, false, state) })
        next()
      })
      .catch((error: unknown) => {
        void settle(runner, transactional, false, state).finally(() => next(error))
      })
  }
}

/** 从请求取管理器。 / Read the manager from the request. */
export function getExpressOrm(request: ExpressRequestLike, key = DEFAULT_ORM_KEY): EntityManager {
  const manager = request[key]
  if (!(manager instanceof EntityManager)) {
    throw new Error(`No ORM entity manager is attached under "${key}". Mount createExpressOrmMiddleware() before this handler.`)
  }
  return manager
}

/** 提交或回滚，且只结算一次；最后归还连接。 / Commit or roll back exactly once, then release. */
async function settle(runner: QueryRunner, transactional: boolean, commit: boolean, state: { settled: boolean }): Promise<void> {
  if (state.settled) return
  state.settled = true
  try {
    if (transactional && runner.isTransactionActive) {
      if (commit) await runner.commitTransaction()
      else await runner.rollbackTransaction()
    }
  } finally {
    await runner.release()
  }
}
