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
import { ConfigurableValueCodec, MYSQL_RULES, type ValueCodec } from './value-codec.ts'
import { MysqlQuerySyntax } from './query-syntax.ts'
import type { QuerySyntax } from './query-syntax.ts'
import { MysqlSchemaSyntax } from './schema-syntax.ts'
import type { SchemaSyntax } from './schema-syntax.ts'

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
  datetime: 'datetime(3)',
  timestamp: 'datetime(3)',
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
  readonly values: ValueCodec = new ConfigurableValueCodec(MYSQL_RULES)
  readonly query: QuerySyntax = new MysqlQuerySyntax()
  readonly schema: SchemaSyntax
  readonly capabilities: DriverCapabilities = {
    returning: false,
    multiRowGeneratedIds: false,
    ddlTransactions: false,
    uuidGeneration: true,
    transactions: true,
    savepoints: true,
  }
  readonly commitStatement = 'COMMIT'
  readonly rollbackStatement = 'ROLLBACK'
  readonly nowExpression = 'CURRENT_TIMESTAMP'

  constructor() {
    this.schema = new MysqlSchemaSyntax(this)
  }

  escape(identifier: string): string {
    return `\`${identifier.replaceAll('`', '``')}\``
  }

  createParameter(_position?: number): string {
    return '?'
  }

  mapColumnType(column: ColumnMetadata): string {
    const base = BASE_TYPES[column.type]
    if (column.type === 'varchar') return withLength(base, column, 255) + ' COLLATE utf8mb4_bin'
    if (column.type === 'decimal') return withPrecision(base, column)
    if (column.type === 'boolean') return 'tinyint(1)'
    if (column.type === 'uuid') return 'char(36) COLLATE utf8mb4_bin'
    // MySQL 默认 ci collation 会让 `=`/排序大小写不敏感，与 PG/SQLite 不一致。
    // MySQL's default ci collation makes `=`/sorting case-insensitive, unlike PG/SQLite.
    if (column.type === 'text' || column.type === 'simple-array' || column.type === 'simple-json') {
      return `${base} COLLATE utf8mb4_bin`
    }
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
