/**
 * 关系装载器：默认策略是「每层一条附加查询」，而不是大 join。
 * 对每个请求的关系只查一次相关行并按主键分组，没有 N+1，也没有笛卡尔积去重。
 *
 * The relation loader: the default strategy is one additional query per layer,
 * not a big join. Each requested relation costs one query, grouped by primary
 * key — no N+1 and no cartesian-product de-duplication.
 *
 * @module @veren/orm/runtime/relation-loader
 */

import { EntityPropertyNotFoundError, UnsupportedFeatureError } from '../errors/index.ts'
import type { EntityMetadata, RelationMetadata } from '../metadata/entity-metadata.ts'
import { In } from '../query/find-operator.ts'
import type { EntityValues, FindManyOptions, Row } from '../types.ts'
import type { EntityManager } from './entity-manager.ts'

/** 按声明装载关系；递归处理嵌套声明。 / Load relations as declared, recursing into nested declarations. */
export async function loadRelations(
  manager: EntityManager,
  entities: EntityValues[],
  metadata: EntityMetadata,
  relations: object | undefined,
  withDeleted: boolean,
): Promise<void> {
  if (relations === undefined || entities.length === 0) return
  for (const [property, nested] of Object.entries(relations)) {
    if (nested === false) continue
    const relation = metadata.findRelation(property)
    if (relation === undefined) throw new EntityPropertyNotFoundError(property, metadata.targetName)
    await loadRelation(manager, entities, relation, nested === true ? undefined : nested, withDeleted)
  }
}

/** 装载单个关系。 / Load one relation. */
async function loadRelation(
  manager: EntityManager,
  owners: EntityValues[],
  relation: RelationMetadata,
  nested: object | undefined,
  withDeleted: boolean,
): Promise<void> {
  if (relation.relationType === 'many-to-many') {
    await loadManyToMany(manager, owners, relation, nested, withDeleted)
    return
  }
  if (relation.joinColumns.length > 0) {
    await loadOwning(manager, owners, relation, nested, withDeleted)
    return
  }
  await loadInverse(manager, owners, relation, nested, withDeleted)
}

/** 多对一 / 一对一拥有侧：按外键批量取目标。 / many-to-one / owning one-to-one: batch-load targets by FK. */
async function loadOwning(
  manager: EntityManager,
  owners: EntityValues[],
  relation: RelationMetadata,
  nested: object | undefined,
  withDeleted: boolean,
): Promise<void> {
  const target = requireTarget(relation)
  const keys = uniqueKeys(owners.map((owner) => owner[relation.propertyName]))
  if (keys.length === 0) {
    for (const owner of owners) owner[relation.propertyName] = null
    return
  }
  const targets = await fetchByPrimaryKeys(manager, target, keys, withDeleted)
  const index = indexByPrimary(target, targets)
  for (const owner of owners) {
    const key = keyOf(owner[relation.propertyName])
    owner[relation.propertyName] = key === undefined ? null : index.get(key) ?? null
  }
  const loaded = [...index.values()]
  if (nested !== undefined) await loadRelations(manager, loaded, target, nested, withDeleted)
}

/** 一对多 / 非拥有侧一对一：按反向外键批量取子行。 / one-to-many / inverse one-to-one: batch children by inverse FK. */
async function loadInverse(
  manager: EntityManager,
  owners: EntityValues[],
  relation: RelationMetadata,
  nested: object | undefined,
  withDeleted: boolean,
): Promise<void> {
  const target = requireTarget(relation)
  const inverseJoin = relation.inverseRelation?.joinColumns[0]
  if (inverseJoin === undefined) {
    throw new UnsupportedFeatureError(`Relation "${relation.propertyName}" without a foreign key on either side`)
  }
  const ownerKeys = uniqueKeys(owners.map((owner) => owner[relation.entityMetadata.primaryColumn.propertyName]))
  if (ownerKeys.length === 0) return
  const children = await fetchByForeignKey(manager, target, inverseJoin.propertyName, ownerKeys, withDeleted)
  const grouped = groupBy(children, (child) => keyOf(child[inverseJoin.propertyName]))
  for (const owner of owners) {
    const key = keyOf(owner[relation.entityMetadata.primaryColumn.propertyName])
    const matches = key === undefined ? [] : grouped.get(key) ?? []
    owner[relation.propertyName] = relation.relationType === 'one-to-many' ? matches : matches[0] ?? null
  }
  if (nested !== undefined) await loadRelations(manager, children, target, nested, withDeleted)
}

/** 多对多：先取中间表行，再取目标行。 / many-to-many: fetch junction rows, then targets. */
async function loadManyToMany(
  manager: EntityManager,
  owners: EntityValues[],
  relation: RelationMetadata,
  nested: object | undefined,
  withDeleted: boolean,
): Promise<void> {
  const target = requireTarget(relation)
  const junction = relation.junctionEntityMetadata
  const [first, second] = junction?.columns ?? []
  if (junction === undefined || first === undefined || second === undefined) {
    throw new UnsupportedFeatureError(`Relation "${relation.propertyName}" has no junction metadata`)
  }
  const ownerColumn = relation.isOwning ? first : second
  const targetColumn = relation.isOwning ? second : first
  const ownerKeys = uniqueKeys(owners.map((owner) => owner[relation.entityMetadata.primaryColumn.propertyName]))
  if (ownerKeys.length === 0) return
  const junctionRows = await fetchByForeignKey(manager, junction, ownerColumn.propertyName, ownerKeys, withDeleted)
  const grouped = groupBy(junctionRows, (row) => keyOf(row[ownerColumn.propertyName]))
  const targetKeys = uniqueKeys(junctionRows.map((row) => row[targetColumn.propertyName]))
  const targets = await fetchByPrimaryKeys(manager, target, targetKeys, withDeleted)
  const index = indexByPrimary(target, targets)
  for (const owner of owners) {
    const key = keyOf(owner[relation.entityMetadata.primaryColumn.propertyName])
    const ids = (key === undefined ? [] : grouped.get(key) ?? []).map((row) => row[targetColumn.propertyName])
    owner[relation.propertyName] = ids
      .map((id) => index.get(keyOf(id) ?? ''))
      .filter((entity): entity is EntityValues => entity !== undefined)
  }
  if (nested !== undefined) await loadRelations(manager, targets, target, nested, withDeleted)
}

/** 按主键集合取行。 / Fetch rows by primary-key set. */
async function fetchByPrimaryKeys(
  manager: EntityManager,
  target: EntityMetadata,
  keys: readonly unknown[],
  withDeleted: boolean,
): Promise<EntityValues[]> {
  const where = { [target.primaryColumn.propertyName]: In(keys) }
  return manager.findByMetadata(target, { where, withDeleted } as FindManyOptions<object>)
}

/** 按外键集合取行。 / Fetch rows by foreign-key set. */
async function fetchByForeignKey(
  manager: EntityManager,
  target: EntityMetadata,
  property: string,
  keys: readonly unknown[],
  withDeleted: boolean,
): Promise<EntityValues[]> {
  return manager.findByMetadata(target, { where: { [property]: In(keys) }, withDeleted } as FindManyOptions<object>)
}

/** 主键值 → 实体索引。 / Primary-key value → entity index. */
function indexByPrimary(metadata: EntityMetadata, entities: readonly EntityValues[]): Map<string, EntityValues> {
  const index = new Map<string, EntityValues>()
  for (const entity of entities) {
    const key = keyOf(entity[metadata.primaryColumn.propertyName])
    if (key !== undefined) index.set(key, entity)
  }
  return index
}

/** 按 key 分组。 / Group rows by key. */
function groupBy<T>(items: readonly T[], keyOfItem: (item: T) => string | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOfItem(item)
    if (key === undefined) continue
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [item])
    else bucket.push(item)
  }
  return groups
}

/** 去重后的非空键。 / Unique non-null keys. */
function uniqueKeys(values: readonly unknown[]): unknown[] {
  const seen = new Set<string>()
  const keys: unknown[] = []
  for (const value of values) {
    const key = keyOf(value)
    if (key === undefined || seen.has(key)) continue
    seen.add(key)
    keys.push(value)
  }
  return keys
}

/** 值的稳定字符串键；null/undefined 返回 undefined。 / Stable string key; null/undefined map to undefined. */
function keyOf(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  return String(value)
}

/** 关系目标必须已解析。 / The relation target must be resolved. */
function requireTarget(relation: RelationMetadata): EntityMetadata {
  if (relation.targetMetadata === undefined) {
    throw new UnsupportedFeatureError(`Relation "${relation.propertyName}" has no resolved target`)
  }
  return relation.targetMetadata
}
