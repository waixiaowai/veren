/**
 * 方言面：转义、占位符、类型映射与事务语句的唯一收敛点。
 * 方言是纯函数集合（不碰连接、不碰环境），因此可以在浏览器、Workers 与
 * Node 上得到逐字一致的 SQL——这也是跨平台测试的基础。
 *
 * The dialect face: the single convergence point for escaping, placeholders,
 * type mapping and transaction statements. A dialect is a set of pure
 * functions (no connection, no environment), so the same SQL comes out
 * byte-for-byte on browsers, Workers and Node — the basis for cross-platform
 * tests.
 *
 * @module @veren/orm/driver/dialect
 */

import { InvalidMetadataError } from '../errors/index.ts'
import type { ColumnMetadata } from '../metadata/entity-metadata.ts'
import type { ColumnType, IsolationLevel } from '../types.ts'

/** 驱动能力面：上游只探测能力，不写方言名分支。 / Capability face: callers probe capabilities, not dialect names. */
export interface DriverCapabilities {
  /** 是否支持 INSERT/UPDATE ... RETURNING / whether RETURNING works */
  readonly returning: boolean
  /** 是否由库生成 UUID / whether the library generates UUIDs */
  readonly uuidGeneration: boolean
  /** 是否支持事务 / whether transactions work */
  readonly transactions: boolean
  /** 是否支持保存点嵌套 / whether savepoints work */
  readonly savepoints: boolean
}

/** 独占数据库的方言。 / A dialect that speaks one database's SQL. */
export interface SqlDialect {
  readonly name: string
  readonly capabilities: DriverCapabilities
  /** 转义标识符 / escape an identifier */
  escape(identifier: string): string
  /** 生成第 n 个（1 起）位置参数占位符 / placeholder for the n-th (1-based) parameter */
  createParameter(position: number): string
  /** 列类型映射为 DDL 类型 / map a column to its DDL type */
  mapColumnType(column: ColumnMetadata): string
  /** 开启事务的语句序列 / statements opening a transaction */
  beginStatements(isolation?: IsolationLevel): string[]
  readonly commitStatement: string
  readonly rollbackStatement: string
  /** 当前时间表达式（SQL 内联） / current-time expression inlined into SQL */
  readonly nowExpression: string
  /** 是否支持该列类型 / whether the dialect supports the column type */
  supportsType(type: ColumnType): boolean
}

/**
 * 命名参数 → 方言位置参数。SQL 文本只含占位符，值只进参数数组。
 * Named parameters → dialect positional parameters. SQL text carries
 * placeholders only; values travel solely in the parameter array.
 */
export function escapeQueryWithParameters(
  dialect: SqlDialect,
  sql: string,
  parameters: Readonly<Record<string, unknown>>,
): [string, unknown[]] {
  const built: unknown[] = []
  const escaped = sql.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (match, name: string) => {
    if (!Object.hasOwn(parameters, name)) {
      throw new InvalidMetadataError(`SQL references parameter ":${name}" but no value was provided. Add it through setParameter() or the where clause.`)
    }
    built.push(parameters[name])
    return dialect.createParameter(built.length)
  })
  return [escaped, built]
}

/** 各列类型在三种关系型方言里的公共集合（用于能力校验）。 / The shared column-type set across the three relational dialects. */
export const RELATIONAL_COLUMN_TYPES: readonly ColumnType[] = [
  'int', 'integer', 'bigint', 'smallint', 'varchar', 'text', 'boolean', 'float',
  'double', 'decimal', 'date', 'datetime', 'timestamp', 'time', 'json', 'jsonb',
  'blob', 'uuid', 'simple-array', 'simple-json',
]

/** 带长度参数的类型渲染。 / Render a type with an optional length. */
export function withLength(base: string, column: ColumnMetadata, defaultLength?: number): string {
  const length = column.options.length ?? defaultLength
  return length === undefined ? base : `${base}(${length})`
}

/** 带精度与标度的类型渲染。 / Render a type with optional precision and scale. */
export function withPrecision(base: string, column: ColumnMetadata, defaultPrecision = 10, defaultScale = 0): string {
  const precision = column.options.precision ?? defaultPrecision
  const scale = column.options.scale ?? defaultScale
  return `${base}(${precision},${scale})`
}
