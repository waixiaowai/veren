/**
 * UPDATE 与 DELETE 构建器：按条件改写行，返回列能力与生成值回写。
 * 写条件不在此处校验——空条件防护由 EntityManager 统一把关（避免两条通道
 * 各自漏一次）。
 *
 * UPDATE and DELETE builders: rewrite rows by criteria, with returning-column
 * capability and generated-value write-back. Criteria safety is not checked
 * here — the EntityManager owns the empty-criteria guard so the two channels
 * cannot diverge.
 *
 * @module @veren/orm/query/update-builder
 */

import type { DeleteResult, EntityValues, UpdateResult } from '../types.ts'
import { EmptyCriteriaError } from '../errors/index.ts'
import { QueryBuilder } from './query-builder.ts'
import { resolveDatabaseName } from './sql-utils.ts'

/** UPDATE 查询构建器。 / The UPDATE query builder. */
export class UpdateQueryBuilder<Entity extends object = object> extends QueryBuilder<Entity> {
  /** 指定要更新的属性集合。 / Choose the property set to update. */
  set(values: EntityValues): this {
    this.expressionMap.updateSet = []
    for (const [property, value] of Object.entries(values)) {
      const column = resolveDatabaseName(this.metadata, property)
      const meta = this.metadata.findColumn(property)
      const prepared = meta === undefined ? value : this.dataSource.driver.preparePersistentValue(meta, value)
      const parameter = this.addParameter(prepared, 'u')
      this.expressionMap.updateSet.push({ column, parameter })
    }
    return this
  }

  /** 追加一段原始赋值表达式（如 `col + :inc`）；值仍走参数通道。 / Append a raw assignment expression such as `col + :inc`; values still use parameters. */
  setExpression(property: string, expression: string): this {
    this.expressionMap.updateSet.push({ column: resolveDatabaseName(this.metadata, property), raw: expression })
    return this
  }

  /** 指定返回列。 / Choose returning columns. */
  returning(columns: readonly string[]): this {
    this.expressionMap.returning = [...columns]
    return this
  }

  /** SQL 生成。 / SQL generation. */
  getSql(): string {
    if (this.expressionMap.updateSet.length === 0) return ''
    const assignments = this.expressionMap.updateSet
      .map((item) => `${this.escape(item.column)} = ${item.raw ?? `:${item.parameter}`}`)
      .join(', ')
    const where = this.renderWheres()
    const returning = this.dataSource.driver.dialect.capabilities.returning && this.expressionMap.returning.length > 0
      ? ` RETURNING ${this.expressionMap.returning.map((column) => this.escape(column)).join(', ')}`
      : ''
    return `UPDATE ${this.escape(this.metadata.tableName)} SET ${assignments}${where === '' ? '' : ` WHERE ${where}`}${returning}`
  }

  /** 执行并归一化更新结果。 / Execute and normalize the update result. */
  async execute(): Promise<UpdateResult> {
    if (this.renderWheres() === '') throw new EmptyCriteriaError('update')
    const [sql, parameters] = this.getQueryAndParameters()
    const result = await this.executeSql(sql, parameters)
    return {
      raw: result.raw,
      generatedMaps: result.rows.map((row) => ({ ...row })),
      affected: result.affected,
    }
  }
}

/** DELETE 查询构建器。 / The DELETE query builder. */
export class DeleteQueryBuilder<Entity extends object = object> extends QueryBuilder<Entity> {
  /** 指定返回列。 / Choose returning columns. */
  returning(columns: readonly string[]): this {
    this.expressionMap.returning = [...columns]
    return this
  }

  /** SQL 生成。 / SQL generation. */
  getSql(): string {
    const where = this.renderWheres()
    const returning = this.dataSource.driver.dialect.capabilities.returning && this.expressionMap.returning.length > 0
      ? ` RETURNING ${this.expressionMap.returning.map((column) => this.escape(column)).join(', ')}`
      : ''
    return `DELETE FROM ${this.escape(this.metadata.tableName)}${where === '' ? '' : ` WHERE ${where}`}${returning}`
  }

  /** 执行并归一化删除结果。 / Execute and normalize the delete result. */
  async execute(): Promise<DeleteResult> {
    if (this.renderWheres() === '') throw new EmptyCriteriaError('delete')
    const [sql, parameters] = this.getQueryAndParameters()
    const result = await this.executeSql(sql, parameters)
    return { raw: result.raw, affected: result.affected }
  }
}
