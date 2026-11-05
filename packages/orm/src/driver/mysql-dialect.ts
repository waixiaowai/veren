/**
 * MySQL 方言：反引号标识符、`?` 占位、无 RETURNING（生成值靠 insertId 回填），
 * 隔离级别必须在事务语句之前单独设置。
 *
 * The MySQL dialect: backtick identifiers, `?` placeholders, no RETURNING
 * (generated values come back through insertId), and isolation levels that must
 * be set before the transaction statement.
 *
 * @module @veren/orm/driver/mysql-dialect
 */

import type { ColumnMetadata } from '../metadata/entity-metadata.ts'
import type { ColumnType, IsolationLevel } from '../types.ts'
import { withLength, withPrecision, type DriverCapabilities, type SqlDialect } from './dialect.ts'

/** 基础类型映射。 / Base type map. */
const BASE_TYPES: { readonly [K in ColumnType]: string } = {
  int: 'int',
  integer: 'int',
  bigint: 'bigint',
  smallint: 'smallint',
  varchar: 'varchar',
  text: 'text',
  boolean: 'tinyint',
  float: 'float',
  double: 'double',
  decimal: 'decimal',
  date: 'date',
  datetime: 'datetime',
  timestamp: 'datetime',
  time: 'time',
  json: 'json',
  jsonb: 'json',
  blob: 'blob',
  uuid: 'char',
  'simple-array': 'text',
  'simple-json': 'text',
}

/** MySQL 方言实现。 / The MySQL dialect implementation. */
export class MysqlDialect implements SqlDialect {
  readonly name = 'mysql'
  readonly capabilities: DriverCapabilities = {
    returning: false,
    uuidGeneration: true,
    transactions: true,
    savepoints: true,
  }
  readonly commitStatement = 'COMMIT'
  readonly rollbackStatement = 'ROLLBACK'
  readonly nowExpression = 'CURRENT_TIMESTAMP'

  escape(identifier: string): string {
    return `\`${identifier.replaceAll('`', '``')}\``
  }

  createParameter(_position?: number): string {
    return '?'
  }

  mapColumnType(column: ColumnMetadata): string {
    const base = BASE_TYPES[column.type]
    if (column.type === 'varchar') return withLength(base, column, 255)
    if (column.type === 'decimal') return withPrecision(base, column)
    if (column.type === 'boolean') return 'tinyint(1)'
    if (column.type === 'uuid') return 'char(36)'
    return base
  }

  beginStatements(isolation?: IsolationLevel): string[] {
    return isolation === undefined
      ? ['START TRANSACTION']
      : [`SET TRANSACTION ISOLATION LEVEL ${isolation}`, 'START TRANSACTION']
  }

  supportsType(_type?: ColumnType): boolean {
    return true
  }
}
