/**
 * 声明归一：把装饰器参数与 EntitySchema 折叠成同一种内部声明。
 * 构建器只消费这里的声明，因此两条声明来源共享一条构建管线。
 *
 * Declaration normalization: folds decorator arguments and EntitySchema into a
 * single internal declaration shape. The builder consumes only these, so both
 * declaration sources share one pipeline.
 *
 * @module @veren/orm/metadata/declarations
 */

import type { ColumnOptions, EntityClass, EntityTarget, RelationOptions } from '../types.ts'
import type { GenerationStrategy, RelationType, SpecialColumn } from './args.ts'
import { getMetadataArgsStorage, type MetadataArgsStorage } from './args.ts'
import type { EntitySchemaColumnOptions, EntitySchemaOptions, EntitySchemaRelationOptions } from './entity-schema.ts'
import { isEntitySchema, type EntitySchema } from './entity-schema.ts'
import { InvalidMetadataError } from '../errors/index.ts'

/** 归一后的列声明。 / Normalized column declaration. */
export interface ColumnDeclaration {
  propertyName: string
  options: ColumnOptions
  primary: boolean
  generation?: GenerationStrategy
  special?: SpecialColumn
}

/** 归一后的关系声明。 / Normalized relation declaration. */
export interface RelationDeclaration {
  propertyName: string
  relationType: RelationType
  target: () => object | string
  inverseSide?: string
  options: RelationOptions
  joinColumnName?: string
  referencedColumnName?: string
  hasJoinTable: boolean
  joinTableName?: string
  joinTableColumn?: string
  inverseJoinTableColumn?: string
}

/** 归一后的索引声明。 / Normalized index declaration. */
export interface IndexDeclaration {
  name?: string
  properties: readonly string[]
  unique: boolean
}

/** 一个实体的全部声明。 / Every declaration of one entity. */
export interface EntityDeclaration {
  target?: Function
  targetName: string
  tableName?: string
  schema?: string
  columns: ColumnDeclaration[]
  relations: RelationDeclaration[]
  indices: IndexDeclaration[]
  uniques: IndexDeclaration[]
}

/**
 * 收集声明，并递归补入关系目标——关系指向的实体即使没写进 `entities`，
 * 只要它被装饰过就自动纳入，避免「漏写一个实体就启动失败」的常见坑。
 *
 * Collect declarations and recursively include relation targets: a decorated
 * entity reachable through a relation joins automatically, avoiding the common
 * "forgot one entity in the list" startup failure.
 */
export function collectDeclarations(
  entities: readonly EntityTarget[],
  storage: MetadataArgsStorage = getMetadataArgsStorage(),
): EntityDeclaration[] {
  const declarations: EntityDeclaration[] = []
  const seen = new Set<string>()
  for (const target of entities) addTarget(target, declarations, seen, storage)
  autoIncludeRelationTargets(declarations, seen, storage)
  return declarations
}

/** 加入一个显式目标（类或 EntitySchema）。 / Add one explicit target (class or EntitySchema). */
function addTarget(
  target: EntityTarget,
  declarations: EntityDeclaration[],
  seen: Set<string>,
  storage: MetadataArgsStorage,
): void {
  if (isEntitySchema(target)) {
    const declaration = fromSchema(target)
    if (seen.has(declaration.targetName)) return
    seen.add(declaration.targetName)
    declarations.push(declaration)
    return
  }
  if (typeof target === 'string') {
    const table = storage.tables.find((candidate) => candidate.target.name === target)
    if (table === undefined) throw new InvalidMetadataError(`Entity name "${target}" does not match any decorated class.`)
    addClassDeclaration(table.target, declarations, seen, storage)
    return
  }
  addClassDeclaration(target, declarations, seen, storage)
}

/** 从装饰器存储构造一个类声明。 / Build one class declaration from decorator storage. */
function addClassDeclaration(
  target: EntityClass | Function,
  declarations: EntityDeclaration[],
  seen: Set<string>,
  storage: MetadataArgsStorage,
): void {
  const targetName = target.name
  if (seen.has(targetName)) return
  const table = storage.tables.find((candidate) => candidate.target === target)
  if (table === undefined) {
    throw new InvalidMetadataError(`Class "${targetName}" has no @Entity() decorator. Decorate it or declare an EntitySchema instead.`)
  }
  seen.add(targetName)
  declarations.push({
    target,
    targetName,
    tableName: table.name,
    schema: table.schema,
    columns: storage.columns.filter((column) => column.target === target).map(toColumnDeclaration),
    relations: storage.relations.filter((relation) => relation.target === target).map(toRelationDeclaration(storage)),
    indices: storage.indices.filter((index) => index.target === target && index.unique === false).map(toIndexDeclaration),
    uniques: storage.indices.filter((index) => index.target === target && index.unique === true).map(toIndexDeclaration),
  })
}

/** 列参数 → 列声明。 / Column args → column declaration. */
function toColumnDeclaration(column: MetadataArgsStorage['columns'][number]): ColumnDeclaration {
  return {
    propertyName: column.propertyName,
    options: column.options,
    primary: column.primary,
    generation: column.generation,
    special: column.special,
  }
}

/** 关系参数 → 关系声明（闭包捕获 JoinColumn / JoinTable 参数）。 / Relation args → declaration, capturing join args. */
function toRelationDeclaration(storage: MetadataArgsStorage) {
  return (relation: MetadataArgsStorage['relations'][number]): RelationDeclaration => {
    const joinColumn = storage.joinColumns.find((candidate) => candidate.target === relation.target && candidate.propertyName === relation.propertyName)
    const joinTable = storage.joinTables.find((candidate) => candidate.target === relation.target && candidate.propertyName === relation.propertyName)
    return {
      propertyName: relation.propertyName,
      relationType: relation.relationType,
      target: relation.type,
      inverseSide: relation.inverseSide,
      options: relation.options,
      joinColumnName: joinColumn?.name,
      referencedColumnName: joinColumn?.referencedColumnName,
      hasJoinTable: joinTable !== undefined,
      joinTableName: joinTable?.name,
      joinTableColumn: joinTable?.joinColumn,
      inverseJoinTableColumn: joinTable?.inverseJoinColumn,
    }
  }
}

/** 索引参数 → 索引声明。 / Index args → index declaration. */
function toIndexDeclaration(index: MetadataArgsStorage['indices'][number]): IndexDeclaration {
  return {
    name: index.name,
    properties: index.propertyName === undefined ? index.columns ?? [] : [index.propertyName],
    unique: index.unique,
  }
}

/** EntitySchema → 归一声明。 / EntitySchema → normalized declaration. */
function fromSchema<Entity extends object>(schema: EntitySchema<Entity>): EntityDeclaration {
  const options = schema.options
  return {
    target: options.target,
    targetName: options.name,
    tableName: options.tableName,
    columns: fromSchemaColumns(options),
    relations: fromSchemaRelations(options),
    indices: (options.indices ?? []).map((index) => ({ name: index.name, properties: index.columns, unique: false })),
    uniques: (options.uniques ?? []).map((index) => ({ name: index.name, properties: index.columns, unique: true })),
  }
}

/** 声明式列 → 归一列。 / Declarative columns → normalized columns. */
function fromSchemaColumns<Entity extends object>(options: EntitySchemaOptions<Entity>): ColumnDeclaration[] {
  const entries = Object.entries(options.columns) as [string, EntitySchemaColumnOptions][]
  return entries.map(([propertyName, columnOptions]) => ({
    propertyName,
    options: columnOptions,
    primary: columnOptions.primary === true,
    generation: columnOptions.generated === true
      ? (columnOptions.type === 'uuid' ? 'uuid' as GenerationStrategy : 'increment' as GenerationStrategy)
      : undefined,
  }))
}

/** 声明式关系 → 归一关系。 / Declarative relations → normalized relations. */
function fromSchemaRelations<Entity extends object>(options: EntitySchemaOptions<Entity>): RelationDeclaration[] {
  const entries = Object.entries(options.relations ?? {}) as [string, EntitySchemaRelationOptions][]
  return entries.map(([propertyName, relationOptions]) => ({
    propertyName,
    relationType: relationOptions.type,
    target: resolveSchemaTarget(relationOptions.target),
    inverseSide: relationOptions.inverseSide,
    options: relationOptions,
    joinColumnName: relationOptions.joinColumn,
    referencedColumnName: relationOptions.referencedColumnName,
    hasJoinTable: relationOptions.type === 'many-to-many'
      && (relationOptions.joinTableName !== undefined || relationOptions.inverseSide === undefined),
    joinTableName: relationOptions.joinTableName,
    joinTableColumn: relationOptions.joinTableColumn,
    inverseJoinTableColumn: relationOptions.inverseJoinTableColumn,
  }))
}

/** 把声明式的目标字段统一成惰性函数。 / Normalize a schema target into a lazy resolver. */
function resolveSchemaTarget(target: string | EntityClass | (() => EntityClass | string)): () => object | string {
  if (typeof target === 'function') {
    const asClass = target as EntityClass
    if (asClass.prototype !== undefined) return () => asClass
    return target as () => object | string
  }
  return () => target
}

/**
 * 递归补入关系指向的实体声明，直到闭包稳定。
 * Recursively add entities reached through relations until the closure is stable.
 */
function autoIncludeRelationTargets(
  declarations: EntityDeclaration[],
  seen: Set<string>,
  storage: MetadataArgsStorage,
): void {
  for (let index = 0; index < declarations.length && index < 128; index += 1) {
    const declaration = declarations[index]!
    for (const relation of declaration.relations) {
      const resolved = relation.target()
      const className = typeof resolved === 'string' ? resolved : (resolved as Function).name
      if (className === undefined || seen.has(className)) continue
      const table = typeof resolved === 'string'
        ? storage.tables.find((candidate) => candidate.target.name === resolved)
        : storage.tables.find((candidate) => candidate.target === resolved)
      if (table !== undefined) addClassDeclaration(table.target, declarations, seen, storage)
    }
  }
}
