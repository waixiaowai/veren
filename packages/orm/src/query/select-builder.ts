/**
 * SELECT 构建器：投影、连接、条件、排序分页与实体装配。
 * 默认投影包含主实体与全部连接实体的列；用户显式 select 时只取显式列。
 *
 * The SELECT builder: projection, joins, conditions, ordering/paging and entity
 * assembly. The default projection covers the main entity and every joined
 * entity; an explicit `select` narrows it.
 *
 * @module @veren/orm/query/select-builder
 */

import { EntityPropertyNotFoundError, UnsupportedFeatureError } from '../errors/index.ts'
import type { EntityMetadata } from '../metadata/entity-metadata.ts'
import type { RelationMetadata } from '../metadata/entity-metadata.ts'
import type { EntityValues, FindManyOptions, QueryResult, Row } from '../types.ts'
import { applyFindOptions } from './find-options.ts'
import { QueryBuilder } from './query-builder.ts'
import { columnRef, projectionOf, resolveDatabaseName, resultKey } from './sql-utils.ts'
import { rowsToEntities } from './transformer.ts'

/** SELECT 查询构建器。 / The SELECT query builder. */
export class SelectQueryBuilder<Entity extends object = object> extends QueryBuilder<Entity> {
  /** 是否去重 / whether to select DISTINCT */
  distinct(enabled = true): this {
    this.expressionMap.distinct = enabled
    return this
  }

  /** 重设投影；空选择回到默认全列投影。 / Reset the projection; an empty selection restores the default. */
  select(selection?: string, alias?: string): this {
    this.expressionMap.selects = []
    if (selection !== undefined && selection !== '') this.addSelect(selection, alias)
    return this
  }

  /** 追加一个投影；带括号或空格的片段视为原始 SQL。 / Append a projection; fragments with parentheses or spaces stay raw. */
  addSelect(selection: string, alias?: string): this {
    if (/[()\s]/.test(selection)) {
      this.expressionMap.selects.push(alias === undefined ? selection : `${selection} AS ${this.escape(alias)}`)
      return this
    }
    const target = this.resolveSelection(selection)
    const key = alias ?? resultKey(target.alias, target.databaseName)
    this.expressionMap.selects.push(`${columnRef(this.escape.bind(this), target.alias, target.databaseName)} AS ${this.escape(key)}`)
    return this
  }

  /** 内连接（按关系属性或原始条件）。 / Inner join by relation property or raw condition. */
  innerJoin(property: string, alias: string, condition?: string): this {
    return this.addJoin('inner', property, alias, condition)
  }

  /** 左连接（按关系属性或原始条件）。 / Left join by relation property or raw condition. */
  leftJoin(property: string, alias: string, condition?: string): this {
    return this.addJoin('left', property, alias, condition)
  }

  /** 声明式条件入口。 / The declarative find-options entry. */
  setFindOptions(options: FindManyOptions<Entity>): this {
    applyFindOptions(this, options)
    return this
  }

  /** 执行并取原始行。 / Execute and return raw rows. */
  async getRawMany(): Promise<readonly Row[]> {
    return (await this.execute()).rows
  }

  /** SELECT 的执行结果固定为原始行集。 / A SELECT always yields a raw row set. */
  override async execute(): Promise<QueryResult> {
    return (await super.execute()) as QueryResult
  }

  /** 执行并取第一行原始结果。 / Execute and return the first raw row. */
  async getRawOne(): Promise<Row | undefined> {
    return (await this.getRawMany())[0]
  }

  /** 执行并装配实体数组；空结果返回空数组。 / Execute and assemble entities; empty results stay empty. */
  async getMany(): Promise<EntityValues[]> {
    return rowsToEntities(await this.getRawMany(), this.metadata, this.alias, this.dataSource.driver)
  }

  /** 执行并装配单个实体；空结果返回 undefined。 / Execute and assemble one entity; empty results stay undefined. */
  async getOne(): Promise<EntityValues | undefined> {
    return (await this.getMany())[0]
  }

  /** 只查计数，不带排序与分页。 / Count only, without ordering or paging. */
  async getCount(): Promise<number> {
    const [sql, parameters] = this.dataSource.driver.escapeQueryWithParameters(this.buildSql(true), this.expressionMap.getParameters())
    const result = await this.executeSql(sql, parameters)
    return Number(result.rows[0]?.count ?? 0)
  }

  /** SQL 生成。 / SQL generation. */
  getSql(): string {
    return this.buildSql(false)
  }

  /** 投影目标解析。 / Resolve one projection target. */
  private resolveSelection(selection: string): { alias: string; databaseName: string } {
    const dot = selection.lastIndexOf('.')
    const alias = dot === -1 ? this.alias : selection.slice(0, dot)
    const property = dot === -1 ? selection : selection.slice(dot + 1)
    return { alias, databaseName: resolveDatabaseName(this.aliasMetadata(alias), property) }
  }

  /** 连接登记；多对多会先补一张中间表连接。 / Register a join; many-to-many first adds a junction join. */
  private addJoin(type: 'inner' | 'left', property: string, alias: string, condition?: string): this {
    const dot = property.lastIndexOf('.')
    const ownerAlias = dot === -1 ? this.alias : property.slice(0, dot)
    const propertyName = dot === -1 ? property : property.slice(dot + 1)
    const owner = this.aliasMetadata(ownerAlias)
    const relation = owner.findRelation(propertyName)
    if (relation === undefined) throw new EntityPropertyNotFoundError(propertyName, owner.targetName)
    const target = relation.targetMetadata
    if (target === undefined) throw new EntityPropertyNotFoundError(propertyName, owner.targetName)
    this.expressionMap.joins.push({
      type,
      alias,
      metadata: target,
      condition: condition ?? this.relationJoinCondition(ownerAlias, alias, relation),
      relation: property,
    })
    return this
  }

  /** 关系连接条件；多对多经中间表两跳。 / Join condition; many-to-many goes through the junction table. */
  private relationJoinCondition(ownerAlias: string, targetAlias: string, relation: RelationMetadata): string {
    const target = relation.targetMetadata
    if (target === undefined) throw new UnsupportedFeatureError(`Relation "${relation.propertyName}" without a resolved target`)
    if (relation.joinColumns.length > 0) {
      return `${this.column(`${ownerAlias}.${relation.joinColumns[0]!.propertyName}`)} = ${columnRef(this.escape.bind(this), targetAlias, target.primaryColumn.databaseName)}`
    }
    const inverseColumn = relation.inverseRelation?.joinColumns[0]
    if (inverseColumn !== undefined) {
      return `${this.column(`${targetAlias}.${inverseColumn.propertyName}`)} = ${columnRef(this.escape.bind(this), ownerAlias, relation.entityMetadata.primaryColumn.databaseName)}`
    }
    throw new UnsupportedFeatureError(`Joining relation "${relation.propertyName}" without a foreign key; load it through find relations instead`)
  }

  /** 组装整条 SELECT。 / Assemble the whole SELECT. */
  private buildSql(count: boolean): string {
    const selectClause = count ? 'COUNT(*) AS "count"' : this.renderSelects()
    const fromClause = `${this.escape(this.metadata.tableName)} ${this.escape(this.alias)}`
    const parts = [`SELECT ${this.expressionMap.distinct && !count ? 'DISTINCT ' : ''}${selectClause}`, `FROM ${fromClause}`]
    parts.push(...this.renderJoins())
    const where = this.renderWheres()
    if (where !== '') parts.push(`WHERE ${where}`)
    if (!count) parts.push(...this.renderGroupAndOrder())
    parts.push(this.renderLimitOffset())
    return parts.filter((part) => part !== '').join(' ')
  }

  /** 渲染投影。 / Render the projection. */
  private renderSelects(): string {
    if (this.expressionMap.selects.length > 0) return this.expressionMap.selects.join(', ')
    const projections = projectionOf(this.escape.bind(this), this.alias, this.metadata)
    for (const join of this.expressionMap.joins) {
      projections.push(...projectionOf(this.escape.bind(this), join.alias, join.metadata))
    }
    return projections.join(', ')
  }

  /** 渲染连接。 / Render joins. */
  private renderJoins(): string[] {
    return this.expressionMap.joins.map((join) => {
      const keyword = join.type === 'inner' ? 'INNER JOIN' : 'LEFT JOIN'
      return `${keyword} ${this.escape(join.metadata.tableName)} ${this.escape(join.alias)} ON ${join.condition}`
    })
  }

  /** 渲染分组与排序。 / Render grouping and ordering. */
  private renderGroupAndOrder(): string[] {
    const parts: string[] = []
    if (this.expressionMap.groupBys.length > 0) {
      parts.push(`GROUP BY ${this.expressionMap.groupBys.map((expression) => (/[()\s.]/.test(expression) ? expression : this.column(expression))).join(', ')}`)
    }
    const having = this.renderHavings()
    if (having !== '') parts.push(`HAVING ${having}`)
    const order = this.renderOrderBys()
    if (order !== '') parts.push(`ORDER BY ${order}`)
    return parts
  }

  /** 渲染分页；不同方言对「只有 offset」的支持不同。 / Render paging; dialects differ on offset-only. */
  private renderLimitOffset(): string {
    const { limit, offset } = this.expressionMap
    if (limit !== undefined && offset !== undefined) return `LIMIT ${limit} OFFSET ${offset}`
    if (limit !== undefined) return `LIMIT ${limit}`
    if (offset === undefined) return ''
    const dialect = this.dataSource.driver.dialect.name
    if (dialect === 'mysql') return `LIMIT 18446744073709551615 OFFSET ${offset}`
    if (dialect === 'sqlite') return `LIMIT -1 OFFSET ${offset}`
    return `LIMIT ALL OFFSET ${offset}`
  }
}
