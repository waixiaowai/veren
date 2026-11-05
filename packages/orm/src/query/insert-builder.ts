/**
 * INSERT 构建器：批量值集、生成列省略与 RETURNING 能力分支。
 * 空值集短路为「零行插入」，绝不产生数据库往返。
 *
 * The INSERT builder: batch value sets, generated-column omission and the
 * RETURNING capability branch. An empty value set short-circuits to a zero-row
 * insert with no database round trip.
 *
 * @module @veren/orm/query/insert-builder
 */

import type { EntityValues, InsertResult } from '../types.ts'
import type { QueryResult } from '../types.ts'
import { QueryBuilder } from './query-builder.ts'
import { resolveDatabaseName } from './sql-utils.ts'

/** INSERT 查询构建器。 / The INSERT query builder. */
export class InsertQueryBuilder<Entity extends object = object> extends QueryBuilder<Entity> {
  /** 追加值集；可多次调用。 / Append value sets; callable repeatedly. */
  values(values: EntityValues | readonly EntityValues[]): this {
    this.expressionMap.values.push(...(Array.isArray(values) ? values : [values]))
    return this
  }

  /** 指定返回列；默认返回全部列（方言支持时）。 / Choose returning columns; defaults to all when supported. */
  returning(columns: readonly string[]): this {
    this.expressionMap.returning = [...columns]
    return this
  }

  /** SQL 生成。 / SQL generation. */
  getSql(): string {
    const columns = this.insertColumns()
    if (columns.length === 0 || this.expressionMap.values.length === 0) return ''
    const rows = this.expressionMap.values.map((value) => this.renderRow(value, columns))
    const head = `INSERT INTO ${this.escape(this.metadata.tableName)} (${columns.map((column) => this.escape(column.databaseName)).join(', ')})`
    const returning = this.renderReturning()
    return `${head} VALUES ${rows.join(', ')}${returning}`
  }

  /** 执行并归一化插入结果。 / Execute and normalize the insert result. */
  async execute(): Promise<InsertResult> {
    if (this.expressionMap.values.length === 0) {
      return { raw: undefined, generatedMaps: [], identifiers: [] }
    }
    const [sql, parameters] = this.getQueryAndParameters()
    const result = await this.executeSql(sql, parameters)
    const generatedMaps = this.generatedMaps(result)
    return { raw: result.raw, generatedMaps, identifiers: generatedMaps }
  }

  /** 参与插入的列：普通列与关系外键列。 / Columns to insert: regular columns plus relation FK columns. */
  private insertColumns(): { propertyName: string; databaseName: string }[] {
    const first = this.expressionMap.values[0]
    if (first === undefined) return []
    return Object.keys(first)
      .filter((property) => this.metadata.findColumn(property) !== undefined || this.metadata.findRelation(property)?.joinColumns[0] !== undefined)
      .map((property) => ({
        propertyName: property,
        databaseName: resolveDatabaseName(this.metadata, property),
      }))
  }

  /** 渲染一行占位。 / Render one row of placeholders. */
  private renderRow(value: EntityValues, columns: readonly { propertyName: string }[]): string {
    const placeholders = columns.map((column) => {
      const meta = this.metadata.findColumn(column.propertyName)
      const prepared = meta === undefined ? value[column.propertyName] : this.dataSource.driver.preparePersistentValue(meta, value[column.propertyName])
      return `:${this.addParameter(prepared, 'v')}`
    })
    return `(${placeholders.join(', ')})`
  }

  /** RETURNING 子句；方言不支持时返回空串。 / The RETURNING clause; empty when the dialect lacks support. */
  private renderReturning(): string {
    if (!this.dataSource.driver.dialect.capabilities.returning) return ''
    const columns = this.expressionMap.returning
    return columns.length === 0 ? ' RETURNING *' : ` RETURNING ${columns.map((column) => this.escape(column)).join(', ')}`
  }

  /** 生成值映射：RETURNING 行或自增 insertId。 / Generated maps: RETURNING rows or the auto-increment insertId. */
  private generatedMaps(result: QueryResult): EntityValues[] {
    if (result.rows.length > 0) return result.rows.map((row) => ({ ...row }))
    const primary = this.metadata.primaryColumn
    if (result.insertId === undefined) return []
    if (primary.generationStrategy !== 'increment') return []
    return this.expressionMap.values.map(() => ({ [primary.propertyName]: result.insertId }))
  }
}
