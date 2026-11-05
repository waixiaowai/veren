/**
 * 模式内存模型：表、列、索引与外键的只读快照。
 * 只在模式同步与迁移生成期存活，不是运行期元数据的一部分。
 *
 * The schema memory model: read-only snapshots of tables, columns, indices and
 * foreign keys. It lives only during schema sync and migration generation, not
 * as part of runtime metadata.
 *
 * @module @veren/orm/schema/table
 */

/** 表列。 / A table column. */
export interface TableColumn {
  name: string
  type: string
  isNullable: boolean
  isPrimary: boolean
}

/** 表索引或唯一约束。 / A table index or unique constraint. */
export interface TableIndex {
  name: string
  columnNames: readonly string[]
  isUnique: boolean
}

/** 外键。 / A foreign key. */
export interface TableForeignKey {
  name: string
  columnNames: readonly string[]
  referencedTableName: string
  referencedColumnNames: readonly string[]
  onDelete?: string
}

/** 表。 / A table. */
export interface Table {
  name: string
  columns: readonly TableColumn[]
  indices: readonly TableIndex[]
  uniques: readonly TableIndex[]
  foreignKeys: readonly TableForeignKey[]
}

/** 一条待执行或已执行的 SQL。 / One SQL statement, pending or already executed. */
export interface SchemaQuery {
  query: string
  parameters?: readonly unknown[]
}

/** 双向模式差集：up 用于升版，down 用于回退。 / The bidirectional schema delta: `up` upgrades, `down` reverts. */
export interface SqlInMemory {
  upQueries: SchemaQuery[]
  downQueries: SchemaQuery[]
}
