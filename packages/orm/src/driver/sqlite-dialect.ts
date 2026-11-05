/**
 * SQLite 方言：双引号标识符、`?` 占位、动态类型与 RETURNING。
 * Cloudflare D1 与 libSQL 复用同一方言，只替换环境桥。
 *
 * The SQLite dialect: double-quoted identifiers, `?` placeholders, dynamic
 * typing and RETURNING. Cloudflare D1 and libSQL reuse it with a different
 * environment bridge.
 *
 * @module @veren/orm/driver/sqlite-dialect
 */

import type { ColumnMetadata } from '../metadata/entity-metadata.ts'
import type { ColumnType, IsolationLevel } from '../types.ts'
import { withLength, withPrecision, type DriverCapabilities, type SqlDialect } from './dialect.ts'

/** 基础类型映射；长度与精度由渲染函数补充。 / Base type map; length and precision are added by helpers. */
const BASE_TYPES: { readonly [K in ColumnType]: string } = {
  int: 'integer',
  integer: 'integer',
  bigint: 'integer',
  smallint: 'integer',
  varchar: 'varchar',
  text: 'text',
  boolean: 'integer',
  float: 'real',
  double: 'real',
  decimal: 'numeric',
  date: 'text',
  datetime: 'text',
  timestamp: 'text',
  time: 'text',
  json: 'text',
  jsonb: 'text',
  blob: 'blob',
  uuid: 'text',
  'simple-array': 'text',
  'simple-json': 'text',
}

/** SQLite 方言实现。 / The SQLite dialect implementation. */
export class SqliteDialect implements SqlDialect {
  readonly name = 'sqlite'
  readonly capabilities: DriverCapabilities
  readonly commitStatement = 'COMMIT'
  readonly rollbackStatement = 'ROLLBACK'
  readonly nowExpression = 'CURRENT_TIMESTAMP'

  /** `overrides` 让 D1 这类不支持显式事务的宿主关掉事务能力。 / `overrides` lets hosts such as D1 disable explicit transactions. */
  constructor(overrides: { transactions?: boolean; returning?: boolean; savepoints?: boolean } = {}) {
    this.capabilities = {
      returning: overrides.returning ?? true,
      uuidGeneration: true,
      transactions: overrides.transactions ?? true,
      savepoints: overrides.savepoints ?? true,
    }
  }

  escape(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`
  }

  createParameter(_position?: number): string {
    return '?'
  }

  mapColumnType(column: ColumnMetadata): string {
    const base = BASE_TYPES[column.type]
    if (column.type === 'varchar') return withLength(base, column, 255)
    if (column.type === 'decimal') return withPrecision(base, column)
    return base
  }

  beginStatements(_isolation?: IsolationLevel): string[] {
    return ['BEGIN']
  }

  supportsType(_type?: ColumnType): boolean {
    return true
  }
}
