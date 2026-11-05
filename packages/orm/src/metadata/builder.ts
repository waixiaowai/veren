/**
 * 元数据构建器：声明 → 列 / 关系 / 索引互相连接的元数据图。
 * 构建分两阶段：先建骨架（列与关系对象），再交给关系构建器解析目标、补外键列
 * 与中间表、双向绑定；索引构建器最后生成名字。关系因此可以互相引用而不受
 * 声明顺序影响。
 *
 * The metadata builder turns declarations into a connected metadata graph. It
 * runs in two phases: first skeletons (columns and relation objects), then the
 * relation builder resolves targets, adds foreign keys/junctions and binds
 * inverses; the index builder names indices last. Relations may therefore
 * reference each other in any declaration order.
 *
 * @module @veren/orm/metadata/builder
 */

import {
  ColumnTypeUndefinedError,
  DuplicateMetadataError,
  InvalidMetadataError,
  MissingPrimaryColumnError,
} from '../errors/index.ts'
import type { NamingStrategyInterface } from '../naming/naming-strategy.ts'
import type { ColumnType, EntityTarget } from '../types.ts'
import type { MetadataArgsStorage } from './args.ts'
import { collectDeclarations, type ColumnDeclaration, type EntityDeclaration, type RelationDeclaration } from './declarations.ts'
import { ColumnMetadata, EntityMetadata, RelationMetadata } from './entity-metadata.ts'
import { applyIndices } from './index-builder.ts'
import { bindInverses, resolveRelations } from './relation-builder.ts'
import { applyPrefix } from './table-name.ts'

/** 构建输入。 / Builder input. */
export interface MetadataBuildOptions {
  entities: readonly EntityTarget[]
  namingStrategy: NamingStrategyInterface
  entityPrefix?: string
  storage?: MetadataArgsStorage
}

/** 构建结果：实体列表与两套查找索引。 / Build output: entity list plus two lookup indices. */
export interface MetadataBuildResult {
  metadatas: EntityMetadata[]
  byTarget: ReadonlyMap<Function, EntityMetadata>
  byName: ReadonlyMap<string, EntityMetadata>
}

/**
 * 两阶段构建入口；任何校验失败都直接抛错（启动门禁语义）。
 * The two-phase entry; any validation failure throws immediately (startup gate).
 */
export function buildEntityMetadatas(options: MetadataBuildOptions): MetadataBuildResult {
  const declarations = collectDeclarations(options.entities, options.storage)
  const metadatas: EntityMetadata[] = []
  const byTarget = new Map<Function, EntityMetadata>()
  const byName = new Map<string, EntityMetadata>()
  for (const declaration of declarations) {
    const metadata = buildSkeleton(declaration, options)
    metadatas.push(metadata)
    byName.set(metadata.targetName, metadata)
    if (metadata.target !== undefined) byTarget.set(metadata.target, metadata)
  }
  const junctions: EntityMetadata[] = []
  resolveRelations(metadatas, declarations, byName, byTarget, options, junctions)
  bindInverses(metadatas)
  applyIndices(metadatas, declarations, options.namingStrategy)
  validateAll(metadatas)
  return { metadatas: [...metadatas, ...junctions], byTarget, byName }
}

/** 第一阶段：列与关系骨架。 / Phase one: columns and relation skeletons. */
function buildSkeleton(declaration: EntityDeclaration, options: MetadataBuildOptions): EntityMetadata {
  const tableName = applyPrefix(options.namingStrategy.tableName(declaration.targetName, declaration.tableName), options.entityPrefix)
  const metadata = new EntityMetadata({
    target: declaration.target,
    targetName: declaration.targetName,
    tableName,
    schema: declaration.schema,
  })
  for (const column of declaration.columns) {
    metadata.columns.push(buildColumn(metadata, column, declaration.targetName, options.namingStrategy))
  }
  metadata.primaryColumns.push(...metadata.columns.filter((column) => column.isPrimary))
  for (const relation of declaration.relations) {
    metadata.relations.push(buildRelation(metadata, relation))
  }
  return metadata
}

/** 单列构造与类型解析。 / Build one column and resolve its type. */
function buildColumn(
  metadata: EntityMetadata,
  column: ColumnDeclaration,
  targetName: string,
  namingStrategy: NamingStrategyInterface,
): ColumnMetadata {
  const type = resolveColumnType(column, targetName)
  const databaseName = namingStrategy.columnName(column.propertyName, column.options.name)
  return new ColumnMetadata(metadata, {
    propertyName: column.propertyName,
    databaseName,
    type,
    options: column.options,
    isPrimary: column.primary,
    isGenerated: column.generation !== undefined,
    generationStrategy: column.generation,
    isCreateDate: column.special === 'createDate',
    isUpdateDate: column.special === 'updateDate',
    isDeleteDate: column.special === 'deleteDate',
    isVersion: column.special === 'version',
  })
}

/** 类型解析：显式优先，特殊列有默认类型，其余拒绝启动。 / Type resolution: explicit first, special columns have defaults, everything else fails. */
function resolveColumnType(column: ColumnDeclaration, targetName: string): ColumnType {
  if (column.options.type !== undefined) return column.options.type
  if (column.generation === 'uuid') return 'uuid'
  if (column.generation === 'increment') return 'integer'
  if (column.special !== undefined) return 'datetime'
  throw new ColumnTypeUndefinedError(targetName, column.propertyName)
}

/** 关系骨架（此时还没有外键列）。 / Relation skeleton, before foreign keys exist. */
function buildRelation(metadata: EntityMetadata, relation: RelationDeclaration): RelationMetadata {
  return new RelationMetadata(metadata, {
    relationType: relation.relationType,
    propertyName: relation.propertyName,
    type: relation.target,
    inverseSide: relation.inverseSide,
    options: relation.options,
    hasJoinTable: relation.hasJoinTable,
  })
}

/** 最终校验：主键、表名唯一、主键非空。 / Final validation: primary keys, unique table names, non-null primaries. */
function validateAll(metadatas: readonly EntityMetadata[]): void {
  const tables = new Set<string>()
  for (const metadata of metadatas) {
    if (metadata.columns.length === 0) continue // 中间表在关系构建器里建立 / junctions are built by the relation builder
    if (metadata.primaryColumns.length === 0) throw new MissingPrimaryColumnError(metadata.targetName)
    if (metadata.primaryColumns.some((column) => column.isNullable)) {
      throw new InvalidMetadataError(`Primary column "${metadata.targetName}.${metadata.primaryColumn.propertyName}" cannot be nullable.`)
    }
    if (tables.has(metadata.tableName)) throw new DuplicateMetadataError(metadata.tableName)
    tables.add(metadata.tableName)
  }
}
