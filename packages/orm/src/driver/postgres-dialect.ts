/**
 * PostgreSQL 方言：双引号标识符、`$n` 位置参数、RETURNING 与标准事务语句。
 *
 * The PostgreSQL dialect: double-quoted identifiers, `$n` positional
 * parameters, RETURNING and standard transaction statements.
 *
 * @module @veren/orm/driver/postgres-dialect
 */

import type { ColumnMetadata } from '../metadata/entity-metadata.ts'
import type { ColumnType, IsolationLevel } from '../types.ts'
import { withLength, withPrecision, type DriverCapabilities, type SqlDialect } from './dialect.ts'

/** 基础类型映射。 / Base type map. */
const BASE_TYPES: { readonly [K in ColumnType]: string } = {
  int: 'integer',
  integer: 'integer',
  bigint: 'bigint',
  smallint: 'smallint',
  varchar: 'varchar',
  text: 'text',
  boolean: 'boolean',
  float: 'real',
  double: 'double precision',
  decimal: 'numeric',
  date: 'date',
  datetime: 'timestamp',
  timestamp: 'timestamp',
  time: 'time',
  json: 'json',
  jsonb: 'jsonb',
  blob: 'bytea',
  uuid: 'uuid',
  'simple-array': 'text',
  'simple-json': 'text',
}

/** PostgreSQL 方言实现。 / The PostgreSQL dialect implementation. */
export class PostgresDialect implements SqlDialect {
  readonly name = 'postgres'
  readonly capabilities: DriverCapabilities = {
    returning: true,
    uuidGeneration: true,
    transactions: true,
    savepoints: true,
  }
  readonly commitStatement = 'COMMIT'
  readonly rollbackStatement = 'ROLLBACK'
  readonly nowExpression = 'CURRENT_TIMESTAMP'

  escape(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`
  }

  createParameter(position: number): string {
    return `$${position}`
  }

  mapColumnType(column: ColumnMetadata): string {
    const base = BASE_TYPES[column.type]
    if (column.type === 'varchar') return withLength(base, column, 255)
    if (column.type === 'decimal') return withPrecision(base, column)
    return base
  }

  beginStatements(isolation?: IsolationLevel): string[] {
    return isolation === undefined ? ['BEGIN'] : [`BEGIN ISOLATION LEVEL ${isolation}`]
  }

  supportsType(_type?: ColumnType): boolean {
    return true
  }
}
