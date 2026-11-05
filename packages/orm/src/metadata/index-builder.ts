/**
 * 索引构建：唯一约束、普通索引与命名策略。
 * 只消费已完成的列与关系元数据，不改变实体形状。
 *
 * Index building: unique constraints, regular indices and naming strategy. It
 * consumes finished column/relation metadata and never changes entity shape.
 *
 * @module @veren/orm/metadata/index-builder
 */

import { EntityPropertyNotFoundError } from '../errors/index.ts'
import type { NamingStrategyInterface } from '../naming/naming-strategy.ts'
import type { EntityDeclaration } from './declarations.ts'
import type { EntityMetadata, IndexMetadata } from './entity-metadata.ts'

/** 生成索引与唯一约束元数据。 / Build index and unique metadata. */
export function applyIndices(
  metadatas: readonly EntityMetadata[],
  declarations: readonly EntityDeclaration[],
  namingStrategy: NamingStrategyInterface,
): void {
  for (const metadata of metadatas) {
    const declaration = declarations.find((candidate) => candidate.targetName === metadata.targetName)
    if (declaration === undefined) continue
    const indices: IndexMetadata[] = []
    const uniques: IndexMetadata[] = []
    for (const column of metadata.columns) {
      if (column.options.unique === true) uniques.push(toIndex(namingStrategy, metadata, [column.propertyName], undefined, true))
    }
    for (const index of declaration.indices) indices.push(toIndex(namingStrategy, metadata, index.properties, index.name, false))
    for (const unique of declaration.uniques) uniques.push(toIndex(namingStrategy, metadata, unique.properties, unique.name, true))
    metadata.indices.push(...dedupe(indices))
    metadata.uniques.push(...dedupe(uniques))
  }
}

/** 单个索引构造，属性名解析为列名。 / Build one index, resolving property names to column names. */
function toIndex(
  namingStrategy: NamingStrategyInterface,
  metadata: EntityMetadata,
  properties: readonly string[],
  customName: string | undefined,
  unique: boolean,
): IndexMetadata {
  const databaseNames = properties.map((property) => resolveDatabaseName(metadata, property))
  const name = customName ?? (unique
    ? namingStrategy.uniqueConstraintName(metadata.tableName, databaseNames)
    : namingStrategy.indexName(metadata.tableName, databaseNames))
  return { name, properties, unique }
}

/** 属性名 → 列名（关系属性走其外键列）。 / Property → column name, with relations mapped to their FK. */
function resolveDatabaseName(metadata: EntityMetadata, property: string): string {
  const column = metadata.findColumn(property)
  if (column !== undefined) return column.databaseName
  const relation = metadata.findRelation(property)
  const joinColumn = relation?.joinColumns[0]
  if (joinColumn !== undefined) return joinColumn.databaseName
  throw new EntityPropertyNotFoundError(property, metadata.targetName)
}

/** 按名去重，先到先得。 / Deduplicate by name, first wins. */
function dedupe(indices: readonly IndexMetadata[]): IndexMetadata[] {
  const seen = new Set<string>()
  return indices.filter((index) => {
    if (seen.has(index.name)) return false
    seen.add(index.name)
    return true
  })
}
