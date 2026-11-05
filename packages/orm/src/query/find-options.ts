/**
 * 声明式查找条件：类型映射、操作符翻译与嵌套关系条件。
 * 翻译即投影——声明选项全部折叠为构建器调用，最终与链式 API 共享同一条
 * SQL 生产线。嵌套关系条件翻译为 EXISTS 子查询，不产生笛卡尔积。
 *
 * Declarative find options: type maps, operator translation and nested relation
 * conditions. Translation is projection — every option folds into builder calls,
 * sharing one SQL pipeline with the chained API. Nested relation conditions
 * become EXISTS subqueries, never a cartesian product.
 *
 * @module @veren/orm/query/find-options
 */

import { EntityPropertyNotFoundError, UnsupportedFeatureError } from '../errors/index.ts'
import type { EntityMetadata, RelationMetadata } from '../metadata/entity-metadata.ts'
import { Brackets } from './brackets.ts'
import { isFindOperator, type FindOperator } from './find-operator.ts'
import type { QueryBuilder } from './query-builder.ts'
import { columnRef, resolveDatabaseName } from './sql-utils.ts'

/** 条件接收面（构建器或括号组）。 / A condition sink (builder or bracket group). */
interface ConditionSink {
  andWhere(sql: string, parameters?: Readonly<Record<string, unknown>>): unknown
}

/** 关系目标去数组/空值，用于嵌套条件类型。 / Relation target without arrays/null, used by nested condition types. */
type NonNullEntity<T> = T extends readonly (infer U)[] ? U : NonNullable<T>

/** 声明式 where 映射。 / The declarative where map. */
export type FindOptionsWhere<Entity> = {
  [P in keyof Entity]?: NonNullEntity<Entity[P]> extends object
    ? FindOptionsWhere<NonNullEntity<Entity[P]>> | readonly FindOptionsWhere<NonNullEntity<Entity[P]>>[] | FindOperator<NonNullEntity<Entity[P]>> | Entity[P] | boolean
    : Entity[P] | FindOperator<Entity[P]>
}

/** 关系装载声明。 / Relation loading declarations. */
export type FindOptionsRelations<Entity> = {
  [P in keyof Entity]?: boolean | FindOptionsRelations<Entity[P]>
}

/** 排序声明。 / Order declarations. */
export type FindOptionsOrder<Entity> = {
  [P in keyof Entity]?: 'ASC' | 'DESC'
}

/** 查询选项。 / Find-many options. */
export interface FindManyOptions<Entity> {
  where?: FindOptionsWhere<Entity> | readonly FindOptionsWhere<Entity>[]
  relations?: FindOptionsRelations<Entity>
  order?: FindOptionsOrder<Entity>
  take?: number
  skip?: number
  withDeleted?: boolean
}

/** 应用声明式选项。 / Apply declarative options. */
export function applyFindOptions<Entity extends object>(
  qb: QueryBuilder<Entity>,
  options: FindManyOptions<Entity>,
): void {
  if (options.where !== undefined) applyWhere(qb, qb.metadata, options.where)
  if (options.order !== undefined) applyOrder(qb, options.order)
  if (options.take !== undefined) qb.take(options.take)
  if (options.skip !== undefined) qb.skip(options.skip)
}

/** 只应用条件（update/delete 复用同一套翻译）。 / Apply criteria only; update/delete reuse the same translation. */
export function applyWhereClause(qb: QueryBuilder, where: object): void {
  applyWhere(qb, qb.metadata, where)
}

/** where：数组是 OR 组，单对象是 AND。 / where: arrays are OR groups, a single object is AND. */
function applyWhere(
  qb: QueryBuilder,
  metadata: EntityMetadata,
  where: object | readonly object[] | undefined,
): void {
  if (where === undefined) return
  if (Array.isArray(where)) {
    qb.andWhere(new Brackets((root) => {
      for (const group of where) {
        root.orWhere(new Brackets((leaf) => addConditions(qb, leaf, metadata, group, qb.alias)))
      }
    }))
    return
  }
  addConditions(qb, qb, metadata, where, qb.alias)
}

/** 逐属性翻译条件。 / Translate conditions property by property. */
function addConditions(
  builder: QueryBuilder,
  sink: ConditionSink,
  metadata: EntityMetadata,
  where: object,
  alias: string,
): void {
  for (const [property, value] of Object.entries(where)) {
    if (value === undefined) continue
    sink.andWhere(conditionFor(builder, metadata, alias, property, value))
  }
}

/** 单个属性值 → SQL 条件。 / One property value → an SQL condition. */
function conditionFor(
  builder: QueryBuilder,
  metadata: EntityMetadata,
  alias: string,
  property: string,
  value: unknown,
): string {
  const relation = metadata.findRelation(property)
  if (isFindOperator(value)) return operatorCondition(builder, metadata, alias, property, value)
  if (relation !== undefined && value === true) return existenceCondition(builder, relation, alias, {})
  if (relation !== undefined && isPlainObject(value)) return nestedCondition(builder, relation, alias, property, value)
  return equalityCondition(builder, metadata, alias, property, value)
}

/** 相等条件；关系标量值自动映射到外键列。 / Equality; a scalar relation value maps to the FK column. */
function equalityCondition(
  builder: QueryBuilder,
  metadata: EntityMetadata,
  alias: string,
  property: string,
  value: unknown,
): string {
  const reference = columnRef(builder.escape.bind(builder), alias, resolveDatabaseName(metadata, property))
  return `${reference} = :${builder.addParameter(value, 'w')}`
}

/** 操作符 → SQL；嵌套操作符递归包裹。 / Operator → SQL, nesting recursively. */
function operatorCondition(
  builder: QueryBuilder,
  metadata: EntityMetadata,
  alias: string,
  property: string,
  operator: FindOperator,
): string {
  if (operator.type === 'not' && isFindOperator(operator.value)) {
    return `NOT (${operatorCondition(builder, metadata, alias, property, operator.value)})`
  }
  const reference = columnRef(builder.escape.bind(builder), alias, resolveDatabaseName(metadata, property))
  return simpleOperator(builder, reference, operator)
}

/** 单层操作符渲染。 / Render a single operator level. */
function simpleOperator(builder: QueryBuilder, reference: string, operator: FindOperator): string {
  switch (operator.type) {
    case 'equal': return `${reference} = :${builder.addParameter(operator.value, 'w')}`
    case 'not': return `${reference} <> :${builder.addParameter(operator.value, 'w')}`
    case 'in': return inCondition(builder, reference, operator.value)
    case 'isNull': return `${reference} IS NULL`
    case 'like': return `${reference} LIKE :${builder.addParameter(operator.value, 'w')}`
    case 'ilike': return `LOWER(${reference}) LIKE LOWER(:${builder.addParameter(operator.value, 'w')})`
    case 'between': return betweenCondition(builder, reference, operator.value)
    case 'lessThan': return `${reference} < :${builder.addParameter(operator.value, 'w')}`
    case 'lessThanOrEqual': return `${reference} <= :${builder.addParameter(operator.value, 'w')}`
    case 'moreThan': return `${reference} > :${builder.addParameter(operator.value, 'w')}`
    case 'moreThanOrEqual': return `${reference} >= :${builder.addParameter(operator.value, 'w')}`
    case 'raw': return rawCondition(builder, operator)
    default: throw new UnsupportedFeatureError(`Find operator "${operator.type}"`)
  }
}

/** IN 条件；空集合恒假，绝不生成 `IN ()`。 / IN condition; an empty set is always false, never `IN ()`. */
function inCondition(builder: QueryBuilder, reference: string, value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '1 = 0'
  const placeholders = value.map((item) => `:${builder.addParameter(item, 'w')}`)
  return `${reference} IN (${placeholders.join(', ')})`
}

/** BETWEEN 条件。 / BETWEEN condition. */
function betweenCondition(builder: QueryBuilder, reference: string, value: unknown): string {
  const pair = Array.isArray(value) ? value : [value, value]
  return `${reference} BETWEEN :${builder.addParameter(pair[0], 'w')} AND :${builder.addParameter(pair[1], 'w')}`
}

/** Raw 条件：值只经参数通道。 / Raw condition: values travel only through parameters. */
function rawCondition(builder: QueryBuilder, operator: FindOperator): string {
  for (const [name, value] of Object.entries(operator.objectLiteralParameters ?? {})) {
    builder.setParameter(name, value)
  }
  return operator.getSql?.() ?? '1 = 0'
}

/** 嵌套关系条件 → EXISTS 子查询。 / Nested relation conditions → EXISTS subqueries. */
function nestedCondition(
  builder: QueryBuilder,
  relation: RelationMetadata,
  ownerAlias: string,
  property: string,
  value: object | readonly object[],
): string {
  const target = relation.targetMetadata
  if (target === undefined) throw new EntityPropertyNotFoundError(property, relation.entityMetadata.targetName)
  const subAlias = `${ownerAlias}_${property}`
  const groups = Array.isArray(value) ? value : [value]
  const bracket = new Brackets((root) => {
    for (const group of groups) {
      root.orWhere(new Brackets((leaf) => addConditions(builder, leaf, target, group, subAlias)))
    }
  })
  builder.mergeParameters(bracket.getParameters())
  return `EXISTS (${relationSubquery(builder, relation, ownerAlias, subAlias)} AND ${bracket.render()})`
}

/** 关系存在判定（值为 true）。 / Relation existence check (value `true`). */
function existenceCondition(
  builder: QueryBuilder,
  relation: RelationMetadata,
  ownerAlias: string,
  nested: object,
): string {
  const target = relation.targetMetadata
  if (target === undefined) throw new UnsupportedFeatureError(`Relation "${relation.propertyName}" without a target`)
  const subAlias = `${ownerAlias}_${relation.propertyName}`
  const bracket = new Brackets((leaf) => addConditions(builder, leaf, target, nested, subAlias))
  builder.mergeParameters(bracket.getParameters())
  const rendered = bracket.render()
  const condition = rendered === '()' ? '' : ` AND ${rendered}`
  return `EXISTS (${relationSubquery(builder, relation, ownerAlias, subAlias)}${condition})`
}

/** 关系子查询的 FROM/WHERE 骨架。 / The FROM/WHERE skeleton of a relation subquery. */
function relationSubquery(
  builder: QueryBuilder,
  relation: RelationMetadata,
  ownerAlias: string,
  subAlias: string,
): string {
  const target = relation.targetMetadata
  if (target === undefined) throw new UnsupportedFeatureError(`Relation "${relation.propertyName}" without a target`)
  const escape = builder.escape.bind(builder)
  const targetTable = `${escape(target.tableName)} ${escape(subAlias)}`
  if (relation.junctionEntityMetadata !== undefined) {
    const junction = relation.junctionEntityMetadata
    const junctionAlias = `${subAlias}_j`
    const [ownerColumn, targetColumn] = junction.columns
    return `SELECT 1 FROM ${escape(junction.tableName)} ${escape(junctionAlias)} INNER JOIN ${targetTable} ON ${escape(junctionAlias)}.${escape(targetColumn!.databaseName)} = ${columnRef(escape, subAlias, target.primaryColumn.databaseName)} WHERE ${escape(junctionAlias)}.${escape(ownerColumn!.databaseName)} = ${columnRef(escape, ownerAlias, relation.entityMetadata.primaryColumn.databaseName)}`
  }
  const ownJoin = relation.joinColumns[0]
  if (ownJoin !== undefined) {
    return `SELECT 1 FROM ${targetTable} WHERE ${columnRef(escape, subAlias, target.primaryColumn.databaseName)} = ${columnRef(escape, ownerAlias, ownJoin.databaseName)}`
  }
  const inverseJoin = relation.inverseRelation?.joinColumns[0]
  if (inverseJoin !== undefined) {
    return `SELECT 1 FROM ${targetTable} WHERE ${columnRef(escape, subAlias, inverseJoin.databaseName)} = ${columnRef(escape, ownerAlias, relation.entityMetadata.primaryColumn.databaseName)}`
  }
  throw new UnsupportedFeatureError(`Nested condition on relation "${relation.propertyName}" without a foreign key`)
}

/** 排序声明 → 构建器。 / Order declarations → builder. */
function applyOrder<Entity extends object>(qb: QueryBuilder<Entity>, order: FindOptionsOrder<Entity>): void {
  for (const [property, direction] of Object.entries(order)) {
    if (direction === undefined || direction === null) continue
    qb.addOrderBy(property, direction as 'ASC' | 'DESC')
  }
}

/** 普通对象判定（排除数组、日期与操作符）。 / Plain-object check (arrays, dates and operators excluded). */
function isPlainObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}
