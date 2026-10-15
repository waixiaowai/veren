/**
 * Dialect assembly: the single-connection Driver (transaction hooks are
 * no-ops — the domain's write chain already serializes writes), a SQLite-like
 * capability adapter, a metadata introspector over declared tables, and the
 * `Dialect` that wires it all together.
 * Dialect 装配：单连接 Driver（事务钩子为 no-op——domain 写链已把写串行化）、
 * SQLite 风格能力适配器、基于已声明表的元数据 introspector，以及把这一切接起来
 * 的 `Dialect`。
 * @module src/dialect
 */
import {
  Kysely,
  type CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type MigrationLockOptions,
  type QueryResult,
  type TableMetadata,
} from 'kysely'
import { createDomainQueryCompiler } from './compiler.js'
import { executeInstruction } from './executor.js'
import { DialectError, type DshDomainLike, type Instruction } from './types.js'

/** Capability profile: no transactions, no schema DDL, returning supported. 能力档案：无事务、无 schema DDL、支持 returning。 */
const adapterProfile: DialectAdapter = {
  supportsCreateIfNotExists: true,
  supportsMultipleConnections: false,
  supportsTransactionalDdl: false,
  supportsReturning: true,
  supportsOutput: false,
  // Migration locks are meaningless without schema DDL; both are no-ops.
  // 无 schema DDL 时迁移锁无意义；两者均为 no-op。
  acquireMigrationLock: async () => {},
  releaseMigrationLock: async () => {},
}

/** Parse the JSON instruction carried in `CompiledQuery.sql`. 解析 `CompiledQuery.sql` 承载的 JSON 指令。 */
function parseInstruction(sql: string): Instruction {
  let instruction: unknown
  try {
    instruction = JSON.parse(sql)
  } catch {
    throw new DialectError('DIALECT_INVALID_INSTRUCTION', 'compiled sql is not a valid instruction document')
  }
  const candidate = instruction as Instruction
  if (candidate?.v !== 1 || typeof candidate.op !== 'string' || typeof candidate.from !== 'string') {
    throw new DialectError('DIALECT_INVALID_INSTRUCTION', 'instruction document fails validation')
  }
  return candidate
}

/** Single shared connection; every query parses its instruction and executes. 单一共享连接；每条查询解析指令后执行。 */
function createConnection(domain: DshDomainLike): DatabaseConnection {
  const run = async <R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> => {
    const result = await executeInstruction(domain, parseInstruction(compiledQuery.sql))
    return result as QueryResult<R>
  }
  const connection: DatabaseConnection = {
    executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
      // We only consume the instruction document carried in `sql`.
      // 我们只消费 `sql` 中承载的指令文档。
      return run<R>(compiledQuery)
    },
    async *streamQuery<R>(compiledQuery: CompiledQuery): AsyncIterableIterator<QueryResult<R>> {
      yield await run<R>(compiledQuery)
    },
  }
  return connection
}

/** Driver over one domain handle: one connection, no pooling, no transactions. 面向单个 domain 句柄的 Driver：单连接、无池化、无事务。 */
class DomainDriver implements Driver {
  private readonly connection: DatabaseConnection
  constructor(domain: DshDomainLike) {
    this.connection = createConnection(domain)
  }
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return this.connection
  }
  async beginTransaction(): Promise<void> {}
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
  // The consumer owns the domain's lifecycle; the driver never closes it.
  // domain 生命周期归消费方；driver 绝不关闭它。
}

/**
 * Introspector exposing the declared tables; column metadata is derived from
 * the first stored record (dynamically typed values mean `dataType` is
 * informational only).
 * Introspector 暴露已声明表；列元数据从首条记录推导（值动态类型化，`dataType`
 * 仅为参考信息）。
 */
function createIntrospector(domain: DshDomainLike, tables: readonly string[]): DatabaseIntrospector {
  return {
    async getSchemas() {
      return []
    },
    async getTables(): Promise<TableMetadata[]> {
      return tables.map(name => {
        const first = domain.table(name).entries().next()
        const columns = first.done ? [] : Object.keys(first.value[1] as Record<string, unknown>).map(column => ({
          name: column,
          dataType: 'text',
          isAutoIncrementing: false,
          isNullable: true,
          hasDefaultValue: false,
        }))
        return { name, isView: false, isForeign: false, columns }
      })
    },
  }
}

/**
 * Build the Kysely `Dialect` over one open domain handle. Declared table
 * names power the introspector; writes resolve tables lazily by instruction
 * so the handle stays the single source of truth.
 * 基于已打开 domain 句柄构建 Kysely `Dialect`。已声明表名供 introspector 使用；
 * 写操作按指令惰性解析表，句柄始终是唯一事实来源。
 */
export function createDomainDialect(domain: DshDomainLike, declaredTables: readonly string[]): Dialect {
  return {
    createAdapter: () => adapterProfile,
    createDriver: () => new DomainDriver(domain),
    createQueryCompiler: createDomainQueryCompiler,
    createIntrospector: (_db: Kysely<any>) => createIntrospector(domain, declaredTables),
  }
}

/**
 * Convenience: open a `Kysely` instance bound to the domain. The returned
 * instance is ready for `kyselyAdapter(db, { type: 'sqlite', transaction:
 * false })` in Better Auth or direct query building anywhere else. The caller
 * keeps ownership of `domain.close()`.
 * 便捷方法：打开绑定到 domain 的 `Kysely` 实例。返回实例可直接用于 Better Auth
 * 的 `kyselyAdapter(db, { type: 'sqlite', transaction: false })`，或任何其他地方
 * 直接构建查询。`domain.close()` 的所有权仍在调用方。
 */
export function createDomainKysely(domain: DshDomainLike, declaredTables: readonly string[]): Kysely<Record<string, never>> {
  return new Kysely<Record<string, never>>({ dialect: createDomainDialect(domain, declaredTables) })
}

// Re-exported so consumers fail loud without importing internals.
// 重新导出，消费方无需引入内部模块即可显式失败于坏查询。
export { DialectError }
