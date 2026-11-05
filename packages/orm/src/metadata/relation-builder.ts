/**
 * 关系构建：目标解析、外键列、多对多中间表与双向绑定。
 * 从主构建器拆出，保证每个文件只承担一个阶段的职责。
 *
 * Relation building: target resolution, FK columns, many-to-many junctions and
 * inverse binding. Split from the main builder so each file owns one phase.
 *
 * @module @veren/orm/metadata/relation-builder
 */

import { InvalidMetadataError } from '../errors/index.ts'
import type { NamingStrategyInterface } from '../naming/naming-strategy.ts'
import type { EntityDeclaration, RelationDeclaration } from './declarations.ts'
import { ColumnMetadata, EntityMetadata, RelationMetadata } from './entity-metadata.ts'
import { applyPrefix } from './table-name.ts'
import type { MetadataBuildOptions } from './builder.ts'

/** 第二阶段：解析目标、补外键列与中间表。 / Phase two: resolve targets, build foreign keys and junctions. */
export function resolveRelations(
  metadatas: readonly EntityMetadata[],
  declarations: readonly EntityDeclaration[],
  byName: ReadonlyMap<string, EntityMetadata>,
  byTarget: ReadonlyMap<Function, EntityMetadata>,
  options: MetadataBuildOptions,
  junctions: EntityMetadata[],
): void {
  for (const metadata of metadatas) {
    const declaration = declarations.find((candidate) => candidate.targetName === metadata.targetName)
    for (const relation of metadata.relations) {
      const target = lookupTarget(relation, byName, byTarget)
      relation.targetMetadata = target
      const relationDeclaration = declaration?.relations.find((candidate) => candidate.propertyName === relation.propertyName)
      if (isJoinColumnRelation(relation, relationDeclaration)) {
        buildJoinColumn(relation, target, relationDeclaration, options.namingStrategy)
      }
      if (relation.relationType === 'many-to-many' && isJunctionOwner(relation, relationDeclaration)) {
        junctions.push(buildJunction(metadata, relation, target, relationDeclaration, options.namingStrategy, options.entityPrefix))
      }
    }
  }
}

/** 关系目标解析；未声明即失败。 / Resolve a relation target; an undeclared target fails. */
function lookupTarget(
  relation: RelationMetadata,
  byName: ReadonlyMap<string, EntityMetadata>,
  byTarget: ReadonlyMap<Function, EntityMetadata>,
): EntityMetadata {
  const resolved = relation.type()
  const target = typeof resolved === 'string' ? byName.get(resolved) : byTarget.get(resolved as Function)
  if (target === undefined) {
    throw new InvalidMetadataError(
      `Relation "${relation.entityMetadata.targetName}.${relation.propertyName}" points at an entity that is not declared. Add the target class or EntitySchema to the data sources "entities" option.`,
    )
  }
  return target
}

/** 该关系是否落外键列。 / Whether the relation materializes a foreign-key column. */
function isJoinColumnRelation(relation: RelationMetadata, declaration: RelationDeclaration | undefined): boolean {
  if (relation.relationType === 'many-to-one') return true
  if (relation.relationType === 'one-to-one') {
    return declaration?.joinColumnName !== undefined || declaration?.referencedColumnName !== undefined || declaration?.inverseSide === undefined
  }
  return false
}

/** 是否为多对多的拥有侧。 / Whether the relation owns the junction table. */
function isJunctionOwner(relation: RelationMetadata, declaration: RelationDeclaration | undefined): boolean {
  return declaration?.hasJoinTable === true || declaration?.inverseSide === undefined
}

/** 建外键列（不进入 entity.columns，只挂在 relation 上）。 / Build the FK column without adding it to entity.columns. */
function buildJoinColumn(
  relation: RelationMetadata,
  target: EntityMetadata,
  declaration: RelationDeclaration | undefined,
  namingStrategy: NamingStrategyInterface,
): void {
  const referenced = declaration?.referencedColumnName === undefined
    ? target.primaryColumn
    : target.findColumn(declaration.referencedColumnName)
  if (referenced === undefined) {
    throw new InvalidMetadataError(
      `Relation "${relation.entityMetadata.targetName}.${relation.propertyName}" references a missing column "${declaration?.referencedColumnName}".`,
    )
  }
  const databaseName = declaration?.joinColumnName
    ?? namingStrategy.joinColumnName(relation.propertyName, referenced.propertyName)
  relation.joinColumns.push(new ColumnMetadata(relation.entityMetadata, {
    propertyName: relation.propertyName,
    databaseName,
    type: referenced.type,
    options: { nullable: relation.options.nullable ?? true },
    isPrimary: false,
    isGenerated: false,
  }))
}

/** 建多对多中间表元数据。 / Build the many-to-many junction metadata. */
function buildJunction(
  owner: EntityMetadata,
  relation: RelationMetadata,
  target: EntityMetadata,
  declaration: RelationDeclaration | undefined,
  namingStrategy: NamingStrategyInterface,
  entityPrefix: string | undefined,
): EntityMetadata {
  const junctionName = declaration?.joinTableName ?? namingStrategy.joinTableName(owner.tableName, target.tableName, relation.propertyName)
  const junction = new EntityMetadata({
    targetName: `${owner.targetName}_${relation.propertyName}_junction`,
    tableName: applyPrefix(junctionName, entityPrefix),
  })
  const ownerColumn = buildJunctionColumn(junction, owner.primaryColumn, declaration?.joinTableColumn
    ?? namingStrategy.joinTableColumnName(owner.tableName, owner.primaryColumn.propertyName))
  const inverseColumn = buildJunctionColumn(junction, target.primaryColumn, declaration?.inverseJoinTableColumn
    ?? namingStrategy.joinTableInverseColumnName(target.tableName, target.primaryColumn.propertyName))
  junction.columns.push(ownerColumn, inverseColumn)
  junction.primaryColumns.push(ownerColumn, inverseColumn)
  relation.junctionEntityMetadata = junction
  return junction
}

/** 中间表的连接列：类型跟随被引用主键。 / A junction column whose type follows the referenced primary key. */
function buildJunctionColumn(junction: EntityMetadata, referenced: ColumnMetadata, databaseName: string): ColumnMetadata {
  return new ColumnMetadata(junction, {
    propertyName: databaseName,
    databaseName,
    type: referenced.type,
    options: { nullable: false },
    isPrimary: true,
    isGenerated: false,
  })
}

/** 双向关系绑定；赋值语义保证重跑幂等。 / Bind inverses; assignment semantics keep it idempotent. */
export function bindInverses(metadatas: readonly EntityMetadata[]): void {
  for (const metadata of metadatas) {
    for (const relation of metadata.relations) {
      if (relation.inverseSidePropertyPath === undefined) continue
      const target = findInverseTarget(relation, metadatas)
      const inverse = target.findRelation(relation.inverseSidePropertyPath)
      if (inverse === undefined) {
        throw new InvalidMetadataError(
          `Relation "${metadata.targetName}.${relation.propertyName}" declares inverse side "${relation.inverseSidePropertyPath}" which does not exist on "${target.targetName}".`,
        )
      }
      relation.inverseRelation = inverse
      inverse.inverseRelation = relation
    }
  }
  for (const metadata of metadatas) {
    for (const relation of metadata.relations) {
      if (relation.relationType !== 'many-to-many' || relation.junctionEntityMetadata !== undefined) continue
      relation.junctionEntityMetadata = relation.inverseRelation?.junctionEntityMetadata
    }
  }
}

/** 找到关系的目标元数据。 / Locate the inverse target metadata. */
function findInverseTarget(relation: RelationMetadata, metadatas: readonly EntityMetadata[]): EntityMetadata {
  const resolved = relation.type()
  const target = typeof resolved === 'string'
    ? metadatas.find((candidate) => candidate.targetName === resolved)
    : metadatas.find((candidate) => candidate.target === resolved)
  if (target === undefined) throw new InvalidMetadataError(`Inverse target of "${relation.entityMetadata.targetName}.${relation.propertyName}" is missing.`)
  return target
}
