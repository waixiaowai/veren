import { describe, expect, it } from 'vitest'
import {
  ColumnMetadata,
  EntityMetadata,
  escapeQueryWithParameters,
  MysqlDialect,
  PostgresDialect,
  SqliteDialect,
} from '../src/index.ts'

/** 构造一列用于类型映射断言。 / Build one column for type-mapping assertions. */
function column(type: 'integer' | 'varchar' | 'boolean' | 'json' | 'decimal'): ColumnMetadata {
  const metadata = new EntityMetadata({ targetName: 'Sample', tableName: 'sample' })
  return new ColumnMetadata(metadata, {
    propertyName: 'value',
    databaseName: 'value',
    type,
    options: type === 'varchar' ? { type, length: 64 } : { type },
    isPrimary: false,
  })
}

describe('dialects', () => {
  it('emits the right placeholder style per dialect', () => {
    const sql = 'SELECT * FROM users WHERE id = :id AND name = :name'
    expect(escapeQueryWithParameters(new PostgresDialect(), sql, { id: 1, name: 'a' })).toEqual([
      'SELECT * FROM users WHERE id = $1 AND name = $2',
      [1, 'a'],
    ])
    expect(escapeQueryWithParameters(new SqliteDialect(), sql, { id: 1, name: 'a' })).toEqual([
      'SELECT * FROM users WHERE id = ? AND name = ?',
      [1, 'a'],
    ])
    expect(escapeQueryWithParameters(new MysqlDialect(), sql, { id: 1, name: 'a' })).toEqual([
      'SELECT * FROM users WHERE id = ? AND name = ?',
      [1, 'a'],
    ])
  })

  it('rejects a missing named parameter before touching a database', () => {
    expect(() => escapeQueryWithParameters(new SqliteDialect(), 'SELECT :missing', {})).toThrow(/no value was provided/)
  })

  it('escapes identifiers per dialect', () => {
    expect(new PostgresDialect().escape('select')).toBe('"select"')
    expect(new SqliteDialect().escape('select')).toBe('"select"')
    expect(new MysqlDialect().escape('select')).toBe('`select`')
    expect(new PostgresDialect().escape('a"b')).toBe('"a""b"')
  })

  it('maps column types per dialect', () => {
    expect(new PostgresDialect().mapColumnType(column('integer'))).toBe('integer')
    expect(new PostgresDialect().mapColumnType(column('varchar'))).toBe('varchar(64)')
    expect(new MysqlDialect().mapColumnType(column('boolean'))).toBe('tinyint(1)')
    expect(new SqliteDialect().mapColumnType(column('boolean'))).toBe('integer')
    expect(new MysqlDialect().mapColumnType(column('json'))).toBe('json')
    expect(new PostgresDialect().mapColumnType(column('decimal'))).toBe('numeric(10,0)')
  })

  it('declares capabilities explicitly instead of switching on dialect names', () => {
    expect(new PostgresDialect().capabilities.returning).toBe(true)
    expect(new MysqlDialect().capabilities.returning).toBe(false)
    expect(new SqliteDialect({ transactions: false }).capabilities.transactions).toBe(false)
  })
})
