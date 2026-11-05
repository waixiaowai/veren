/**
 * 关系级联：拥有侧先存、一对多后存、多对多重建中间表，删除时反向推进。
 * 与主流程分开，级联规则因此可以独立阅读与测试。
 *
 * Relation cascades: owning side first, one-to-many children after, many-to-many
 * junctions rebuilt, and the reverse order on removal. Split from the main flow
 * so cascade rules stay independently readable and testable.
 *
 * @module @veren/orm/persistence/persist-relations
 */

import { CannotCreateEntityIdMapError } from '../errors/index.ts'
import type { EntityMetadata, RelationMetadata } from '../metadata/entity-metadata.ts'
import { In } from '../query/find-operator.ts'
import { DeleteQueryBuilder } from '../query/update-builder.ts'
import { InsertQueryBuilder } from '../query/insert-builder.ts'
import type { EntityManager } from '../runtime/entity-manager.ts'
import type { EntityValues, FindManyOptions } from '../types.ts'
import { persistOne, type PersistOptions } from './persist.ts'
import { requireTarget } from './relation-target.ts'

/** 拥有侧级联：目标先保存，外键值随后从对象里取。 / Owning cascade: targets save first; FK values are read from them afterwards. */
export async function cascadeOwning(
  manager: EntityManager,
  metadata: EntityMetadata,
  entity: EntityValues,
  options: PersistOptions,
  visited: Set<object>,
): Promise<void> {
  for (const relation of metadata.relations) {
    if (relation.joinColumns.length === 0 || !cascadeEnabled(relation)) continue
    const value = entity[relation.propertyName]
    if (value === null || value === undefined || typeof value !== 'object') continue
    await persistOne(manager, requireTarget(relation), value as EntityValues, 'save', options, visited)
  }
}

/** 一对多级联：父先有主键，再把父对象挂到子实体上。 / One-to-many cascade: the parent's key exists first, then it is attached to each child. */
export async function cascadeInverse(
  manager: EntityManager,
  metadata: EntityMetadata,
  entity: EntityValues,
  options: PersistOptions,
  visited: Set<object>,
): Promise<void> {
  for (const relation of metadata.relations) {
    if (relation.relationType !== 'one-to-many' || !cascadeEnabled(relation)) continue
    const children = entity[relation.propertyName]
    if (!Array.isArray(children)) continue
    for (const child of children) {
      if (typeof child !== 'object' || child === null) continue
      if (relation.inverseRelation !== undefined) child[relation.inverseRelation.propertyName] = entity
      await persistOne(manager, requireTarget(relation), child as EntityValues, 'save', options, visited)
    }
  }
}

/** 多对多级联：先存目标端，再重建中间表行。 / Many-to-many cascade: save the target side, then rebuild junction rows. */
export async function cascadeJunctions(
  manager: EntityManager,
  metadata: EntityMetadata,
  entity: EntityValues,
  options: PersistOptions,
  visited: Set<object>,
): Promise<void> {
  for (const relation of metadata.relations) {
    if (relation.relationType !== 'many-to-many' || !cascadeEnabled(relation)) continue
    const values = entity[relation.propertyName]
    if (!Array.isArray(values)) continue
    for (const target of values) {
      if (typeof target !== 'object' || target === null) continue
      await persistOne(manager, requireTarget(relation), target as EntityValues, 'save', options, visited)
    }
    await syncJunction(manager, relation, entity, values)
  }
}

/** 级联删除一对多子实体。 / Cascade-remove one-to-many children. */
export async function cascadeRemoveChildren(
  manager: EntityManager,
  metadata: EntityMetadata,
  entity: EntityValues,
  options: PersistOptions,
  visited: Set<object>,
): Promise<void> {
  for (const relation of metadata.relations) {
    if (relation.relationType !== 'one-to-many' || !relation.cascades('remove')) continue
    const inverseJoin = relation.inverseRelation?.joinColumns[0]
    if (inverseJoin === undefined) continue
    const key = entity[metadata.primaryColumn.propertyName]
    if (key === undefined) continue
    const children = await manager.findByMetadata(requireTarget(relation), {
      where: { [inverseJoin.propertyName]: In([key]) },
      withDeleted: true,
    } as FindManyOptions<object>)
    for (const child of children) await persistOne(manager, requireTarget(relation), child, 'remove', options, visited)
  }
}

/** 删除该实体参与的全部多对多中间表行。 / Delete every junction row this entity participates in. */
export async function clearJunctions(manager: EntityManager, metadata: EntityMetadata, entity: EntityValues): Promise<void> {
  const key = entity[metadata.primaryColumn.propertyName]
  if (key === undefined) return
  for (const relation of metadata.relations) {
    if (relation.relationType !== 'many-to-many') continue
    const junction = relation.junctionEntityMetadata
    const [ownerColumn, targetColumn] = junction?.columns ?? []
    if (junction === undefined || ownerColumn === undefined || targetColumn === undefined) continue
    await deleteJunctionRows(manager, junction, ownerColumn.databaseName, key)
    await deleteJunctionRows(manager, junction, targetColumn.databaseName, key)
  }
}

/** 重建一个多对多关系的中间表行。 / Rebuild the junction rows of one many-to-many relation. */
async function syncJunction(
  manager: EntityManager,
  relation: RelationMetadata,
  owner: EntityValues,
  targets: readonly unknown[],
): Promise<void> {
  const junction = relation.junctionEntityMetadata
  const [ownerColumn, targetColumn] = junction?.columns ?? []
  if (junction === undefined || ownerColumn === undefined || targetColumn === undefined) return
  const ownerKey = owner[relation.entityMetadata.primaryColumn.propertyName]
  if (ownerKey === undefined) throw new CannotCreateEntityIdMapError(relation.entityMetadata.targetName)
  await deleteJunctionRows(manager, junction, ownerColumn.databaseName, ownerKey)
  const rows: EntityValues[] = []
  for (const target of targets) {
    if (typeof target !== 'object' || target === null) continue
    const key = (target as EntityValues)[requireTarget(relation).primaryColumn.propertyName]
    if (key === undefined) continue
    rows.push({ [ownerColumn.propertyName]: ownerKey, [targetColumn.propertyName]: key })
  }
  if (rows.length === 0) return
  await new InsertQueryBuilder(manager.dataSource, junction, manager.queryRunner).values(rows).execute()
}

/** 清空某实体在某关系下的中间表行。 / Clear one entity's junction rows for a relation. */
async function deleteJunctionRows(
  manager: EntityManager,
  junction: EntityMetadata,
  columnName: string,
  key: unknown,
): Promise<void> {
  const builder = new DeleteQueryBuilder(manager.dataSource, junction, manager.queryRunner)
  builder.where(`${builder.escape(columnName)} = :ownerKey`).setParameter('ownerKey', key)
  await builder.execute()
}

/** 级联开关判定。 / Cascade switch check. */
function cascadeEnabled(relation: RelationMetadata): boolean {
  return relation.cascades('insert') || relation.cascades('update')
}
