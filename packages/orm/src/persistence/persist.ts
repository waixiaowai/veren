/**
 * 持久化管线：把对象图展开成按依赖排序的写入，并包进事务。
 * 顺序是插入 → 更新 → 删除；拥有侧关联先于当前实体，一对多子实体后于当前
 * 实体，多对多中间表在两端都有主键之后才写。
 *
 * The persistence pipeline: expand an object graph into dependency-ordered
 * writes inside a transaction. Order is insert → update → delete; owning-side
 * relations precede the current entity, one-to-many children follow it, and
 * many-to-many junction rows wait until both ends have primary keys.
 *
 * @module @veren/orm/persistence/persist
 */

import { CannotCreateEntityIdMapError, MissingDeleteDateColumnError, OptimisticLockVersionMismatchError } from '../errors/index.ts'
import type { ColumnMetadata, EntityMetadata } from '../metadata/entity-metadata.ts'
import { InsertQueryBuilder } from '../query/insert-builder.ts'
import { DeleteQueryBuilder, UpdateQueryBuilder } from '../query/update-builder.ts'
import { EntityManager } from '../runtime/entity-manager.ts'
import type { EntityValues, FindManyOptions, RemoveOptions, SaveOptions } from '../types.ts'
import { cascadeInverse, cascadeJunctions, cascadeOwning, cascadeRemoveChildren, clearJunctions } from './persist-relations.ts'
import { assignValues, broadcast, buildSaveValues, isUnchanged, primaryValues } from './persist-values.ts'

/** 持久化模式。 / Persistence modes. */
export type PersistMode = 'save' | 'remove' | 'soft-remove' | 'recover'

/** 持久化选项。 / Persistence options. */
export type PersistOptions = SaveOptions & RemoveOptions

/** 入口：包事务、逐实体推进、失败整体回滚。 / Entry: wrap a transaction, process entities, roll back everything on failure. */
export async function persistEntities(
  manager: EntityManager,
  metadata: EntityMetadata,
  entities: readonly EntityValues[],
  mode: PersistMode,
  options: PersistOptions,
): Promise<EntityValues[]> {
  const runner = manager.queryRunner ?? manager.dataSource.createQueryRunner()
  const ownRunner = manager.queryRunner === undefined
  const transactional = manager.queryRunner === undefined ? new EntityManager(manager.dataSource, runner) : manager
  const canTransact = manager.dataSource.driver.dialect.capabilities.transactions && options.transaction !== false
  try {
    if (ownRunner) await runner.connect()
    if (canTransact && !runner.isTransactionActive) await runner.startTransaction()
    const visited = new Set<object>()
    for (const entity of entities) await persistOne(transactional, metadata, entity, mode, options, visited)
    if (canTransact && ownRunner && runner.isTransactionActive) await runner.commitTransaction()
    return [...entities]
  } catch (error) {
    // 只回滚自己开的事务；外层事务由外层回调决定生死。
    // Roll back only a transaction this call owns; an outer transaction is the outer callback's call.
    if (ownRunner && canTransact && runner.isTransactionActive) await runner.rollbackTransaction()
    throw error
  } finally {
    if (ownRunner) await runner.release()
  }
}

/** 单实体推进；visited 防循环级联。 / Process one entity; `visited` breaks cyclic cascades. */
export async function persistOne(
  manager: EntityManager,
  metadata: EntityMetadata,
  entity: EntityValues,
  mode: PersistMode,
  options: PersistOptions,
  visited: Set<object>,
): Promise<void> {
  if (visited.has(entity)) return
  visited.add(entity)
  if (mode === 'remove') {
    await removeOne(manager, metadata, entity, options, visited)
    return
  }
  if (mode === 'soft-remove' || mode === 'recover') {
    await updateSpecial(manager, metadata, entity, mode === 'recover')
    return
  }
  await saveOne(manager, metadata, entity, options, visited)
}

/** 保存：先父后己、再子、最后中间表。 / Save: parents, self, children, then junction rows. */
async function saveOne(
  manager: EntityManager,
  metadata: EntityMetadata,
  entity: EntityValues,
  options: PersistOptions,
  visited: Set<object>,
): Promise<void> {
  await cascadeOwning(manager, metadata, entity, options, visited)
  const existing = await findExisting(manager, metadata, entity)
  const isInsert = existing === undefined
  const values = buildSaveValues(metadata, entity, isInsert)
  const listeners = options.listeners !== false
  if (isInsert) await insertOne(manager, metadata, entity, values, listeners)
  else if (!isUnchanged(metadata, values, existing)) await updateOne(manager, metadata, entity, values, existing, listeners)
  await cascadeInverse(manager, metadata, entity, options, visited)
  await cascadeJunctions(manager, metadata, entity, options, visited)
}

/** 库内基线查询；无主键即视为新增。 / Database baseline lookup; no primary key means an insert. */
async function findExisting(manager: EntityManager, metadata: EntityMetadata, entity: EntityValues): Promise<EntityValues | undefined> {
  const criteria = primaryValues(metadata, entity)
  if (Object.keys(criteria).length === 0) return undefined
  const rows = await manager.findByMetadata(metadata, { where: criteria, withDeleted: true } as FindManyOptions<object>)
  return rows[0]
}

/** 插入并回填生成列。 / Insert and write generated columns back. */
async function insertOne(
  manager: EntityManager,
  metadata: EntityMetadata,
  entity: EntityValues,
  values: EntityValues,
  listeners: boolean,
): Promise<void> {
  await broadcast(manager, 'beforeInsert', metadata, entity, {}, listeners)
  const result = await new InsertQueryBuilder(manager.dataSource, metadata, manager.queryRunner).values(values).execute()
  assignValues(metadata, entity, values)
  const generated = result.generatedMaps[0]
  if (generated !== undefined) applyGenerated(manager, metadata, entity, generated)
  await broadcast(manager, 'afterInsert', metadata, entity, {}, listeners)
  if (metadata.primaryColumns.every((column) => column.getEntityValue(entity) !== undefined)) return
  if (metadata.primaryColumn.isGenerated) throw new CannotCreateEntityIdMapError(metadata.targetName)
}

/** 回填数据库生成列。 / Write generated columns back. */
function applyGenerated(manager: EntityManager, metadata: EntityMetadata, entity: EntityValues, generated: EntityValues): void {
  for (const [key, value] of Object.entries(generated)) {
    const column = metadata.findColumn(key) ?? metadata.findColumnByDatabaseName(key)
    if (column !== undefined) column.setEntityValue(entity, manager.dataSource.driver.prepareHydratedValue(column, value))
  }
}

/** 更新并校验乐观锁。 / Update and check the optimistic lock. */
async function updateOne(
  manager: EntityManager,
  metadata: EntityMetadata,
  entity: EntityValues,
  values: EntityValues,
  existing: EntityValues,
  listeners: boolean,
): Promise<void> {
  if (Object.keys(values).length === 0) return
  const updatedColumns = Object.keys(values)
    .map((property) => metadata.findColumn(property))
    .filter((column): column is ColumnMetadata => column !== undefined)
  await broadcast(manager, 'beforeUpdate', metadata, entity, { databaseEntity: existing, updatedColumns }, listeners)
  const builder = new UpdateQueryBuilder(manager.dataSource, metadata, manager.queryRunner)
  builder.set(values)
  applyPrimaryCriteria(builder, metadata, entity)
  const versionColumn = metadata.versionColumn
  const expectedVersion = versionColumn?.getEntityValue(entity)
  if (versionColumn !== undefined && expectedVersion !== undefined) {
    builder.andWhere(`${builder.escape(versionColumn.databaseName)} = :expectedVersion`).setParameter('expectedVersion', expectedVersion)
  }
  const result = await builder.execute()
  if (versionColumn !== undefined && expectedVersion !== undefined && result.affected === 0) {
    throw new OptimisticLockVersionMismatchError(metadata.targetName, expectedVersion, versionColumn.getEntityValue(existing))
  }
  assignValues(metadata, entity, values)
  await broadcast(manager, 'afterUpdate', metadata, entity, { databaseEntity: existing, updatedColumns }, listeners)
}

/** 删除：先子后己，多对多中间表先清。 / Remove: children first, junction rows first. */
async function removeOne(
  manager: EntityManager,
  metadata: EntityMetadata,
  entity: EntityValues,
  options: PersistOptions,
  visited: Set<object>,
): Promise<void> {
  const listeners = options.listeners !== false
  await broadcast(manager, 'beforeRemove', metadata, entity, {}, listeners)
  await cascadeRemoveChildren(manager, metadata, entity, options, visited)
  await clearJunctions(manager, metadata, entity)
  const builder = new DeleteQueryBuilder(manager.dataSource, metadata, manager.queryRunner)
  applyPrimaryCriteria(builder, metadata, entity)
  await builder.execute()
  await broadcast(manager, 'afterRemove', metadata, entity, {}, listeners)
}

/** 软删/恢复。 / Soft remove/recover. */
async function updateSpecial(manager: EntityManager, metadata: EntityMetadata, entity: EntityValues, recover: boolean): Promise<void> {
  const deleteColumn = metadata.deleteDateColumn
  if (deleteColumn === undefined) throw new MissingDeleteDateColumnError(metadata.targetName)
  const builder = new UpdateQueryBuilder(manager.dataSource, metadata, manager.queryRunner)
  const values: EntityValues = { [deleteColumn.propertyName]: recover ? null : new Date() }
  if (metadata.updateDateColumn !== undefined) values[metadata.updateDateColumn.propertyName] = new Date()
  builder.set(values)
  applyPrimaryCriteria(builder, metadata, entity)
  await builder.execute()
  assignValues(metadata, entity, values)
}

/** 主键条件。 / Primary-key criteria. */
function applyPrimaryCriteria(
  builder: UpdateQueryBuilder | DeleteQueryBuilder,
  metadata: EntityMetadata,
  entity: EntityValues,
): void {
  for (const column of metadata.primaryColumns) {
    const value = column.getEntityValue(entity)
    if (value === undefined) throw new CannotCreateEntityIdMapError(metadata.targetName)
    const parameter = `pk_${column.propertyName}`
    builder.andWhere(`${builder.escape(column.databaseName)} = :${parameter}`).setParameter(parameter, value)
  }
}
