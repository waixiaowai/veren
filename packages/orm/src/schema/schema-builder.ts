/**
 * 模式同步器：元数据与实际库结构的差集计算与定序执行。
 * `log()` 只读内省、只算不执行；`build()` 才发 DDL；`drop()` 是显式的破坏开关。
 *
 * The schema synchronizer: diff metadata against the real database and execute
 * in a fixed order. `log()` only introspects and computes; `build()` emits DDL;
 * `drop()` is the explicit destructive switch.
 *
 * @module @veren/orm/schema/schema-builder
 */

import type { Driver } from '../driver/driver.ts'
import type { QueryRunner } from '../driver/query-runner.ts'
import type { ColumnMetadata, EntityMetadata } from '../metadata/entity-metadata.ts'
import { resolveDatabaseName } from '../query/sql-utils.ts'
import type { DataSource } from '../runtime/data-source.ts'
import { loadColumns, loadTableNames } from './introspect.ts'
import type { ExistingColumn } from './introspect.ts'
import { dropOrder } from './drop-order.ts'
import type { SchemaQuery, SqlInMemory } from './table.ts'

/** 模式同步器。 / The schema synchronizer. */
export class SchemaBuilder {
  constructor(
    private readonly dataSource: DataSource,
    private readonly driver: Driver,
  ) {}

  /** 执行差集；中途失败不自动回滚已完成的 DDL。 / Execute the delta; a mid-way failure does not roll back completed DDL. */
  async build(): Promise<void> {
    const runner = await this.openRunner()
    try {
      const delta = await this.compute(runner)
      for (const query of delta.upQueries) await runner.query(query.query, query.parameters)
    } finally {
      await runner.release()
    }
  }

  /** 只算不执行。 / Compute without executing. */
  async log(): Promise<SqlInMemory> {
    const runner = await this.openRunner()
    try {
      return await this.compute(runner)
    } finally {
      await runner.release()
    }
  }

  /** 删除元数据声明的全部表（危险）：先子表后父表。 / Drop every declared table (dangerous): children before parents. */
  async drop(): Promise<void> {
    const runner = await this.openRunner()
    try {
      for (const metadata of dropOrder(this.dataSource.entityMetadatas)) {
        await runner.query(`DROP TABLE IF EXISTS ${this.driver.dialect.escape(metadata.tableName)}`)
      }
    } finally {
      await runner.release()
    }
  }

  /** 计算差集：缺表建表，缺列加列。 / Compute the delta: create missing tables, add missing columns. */
  private async compute(runner: QueryRunner): Promise<SqlInMemory> {
    const existingTables = new Set(await loadTableNames(this.driver, runner))
    const upQueries: SchemaQuery[] = []
    for (const metadata of this.dataSource.entityMetadatas) {
      if (!existingTables.has(metadata.tableName)) {
        upQueries.push(...this.createTable(metadata))
        continue
      }
      upQueries.push(...await this.addMissingColumns(runner, metadata))
    }
    return { upQueries, downQueries: [] }
  }

  /** 建表 + 索引。 / CREATE TABLE plus indices. */
  private createTable(metadata: EntityMetadata): SchemaQuery[] {
    const definitions = [
      ...metadata.columns.map((column) => this.columnDefinition(column)),
      ...metadata.relations.flatMap((relation) => relation.joinColumns.map((column) => this.columnDefinition(column))),
    ]
    const primary = this.primaryKeyDefinition(metadata)
    if (primary !== undefined) definitions.push(primary)
    definitions.push(...this.foreignKeyDefinitions(metadata))
    const queries: SchemaQuery[] = [{
      query: `CREATE TABLE ${this.driver.dialect.escape(metadata.tableName)} (${definitions.join(', ')})`,
    }]
    queries.push(...this.indexQueries(metadata))
    return queries
  }

  /** 列定义；方言策略负责自增与默认值。 / Column definition; the dialect policy owns auto-increment and defaults. */
  private columnDefinition(column: ColumnMetadata): string {
    return this.driver.dialect.schema.column(column)
  }

  /** 主键定义；SQLite 单自增主键已内联。 / Primary key; SQLite's auto-increment single key is inline. */
  private primaryKeyDefinition(metadata: EntityMetadata): string | undefined {
    return this.driver.dialect.schema.primaryKey(metadata)
  }

  /** 外键定义：拥有侧关系物化为库内约束。 / Foreign keys: owning-side relations become real constraints. */
  private foreignKeyDefinitions(metadata: EntityMetadata): string[] {
    const definitions: string[] = []
    for (const relation of metadata.relations) {
      const joinColumn = relation.joinColumns[0]
      const target = relation.targetMetadata
      if (joinColumn === undefined || target === undefined) continue
      if (relation.options.createForeignKeyConstraints === false) continue
      const escape = this.driver.dialect.escape.bind(this.driver.dialect)
      const name = this.dataSource.namingStrategy.foreignKeyName(
        metadata.tableName,
        [joinColumn.databaseName],
        target.tableName,
        [target.primaryColumn.databaseName],
      )
      const action = relation.options.onDelete === undefined ? '' : ` ON DELETE ${relation.options.onDelete}`
      definitions.push(`CONSTRAINT ${escape(name)} FOREIGN KEY (${escape(joinColumn.databaseName)}) REFERENCES ${escape(target.tableName)} (${escape(target.primaryColumn.databaseName)})${action}`)
    }
    return definitions
  }

  /** 索引与唯一约束语句。 / Index and unique-constraint statements. */
  private indexQueries(metadata: EntityMetadata): SchemaQuery[] {
    const queries: SchemaQuery[] = []
    const escape = this.driver.dialect.escape.bind(this.driver.dialect)
    for (const index of [...metadata.indices, ...metadata.uniques]) {
      const columns = index.properties.map((property) => escape(resolveDatabaseName(metadata, property))).join(', ')
      queries.push({
        query: `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${escape(index.name)} ON ${escape(metadata.tableName)} (${columns})`,
      })
    }
    return queries
  }

  /** 已有表补列；只加不删（删列需要显式迁移）。 / Add columns to an existing table; never drop (dropping needs an explicit migration). */
  private async addMissingColumns(runner: QueryRunner, metadata: EntityMetadata): Promise<SchemaQuery[]> {
    const existing = new Set((await loadColumns(this.driver, runner, metadata.tableName)).map((column) => column.name))
    const columns: ColumnMetadata[] = [
      ...metadata.columns,
      ...metadata.relations.flatMap((relation) => relation.joinColumns),
    ]
    return columns
      .filter((column) => !existing.has(column.databaseName) && !column.isPrimary)
      .map((column) => ({ query: `ALTER TABLE ${this.driver.dialect.escape(metadata.tableName)} ADD COLUMN ${this.columnDefinition(column)}` }))
  }

  /** 打开执行器。 / Open a query runner. */
  private async openRunner(): Promise<QueryRunner> {
    const runner = this.dataSource.createQueryRunner()
    await runner.connect()
    return runner
  }
}
