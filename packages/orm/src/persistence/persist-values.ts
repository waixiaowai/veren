/**
 * 写入值构造与差异判定：特殊列、版本列、外键列与事件广播。
 * 与执行阶段分开，方便单测「值是什么」而不触碰数据库。
 *
 * Write-value construction and change detection: special, version and FK
 * columns plus event broadcasting. Split from execution so "what the values are"
 * can be tested without a database.
 *
 * @module @veren/orm/persistence/persist-values
 */

import type { EntityMetadata } from '../metadata/entity-metadata.ts'
import type { EntityManager } from '../runtime/entity-manager.ts'
import { Broadcaster, type SubscriberEventData } from '../subscriber/broadcaster.ts'
import { randomUuid } from '../util/random.ts'
import type { EntityValues } from '../types.ts'
import { requireTarget } from './relation-target.ts'

/** 构造写入值：特殊列、版本列与外键列都在这里补齐。 / Build write values: special, version and FK columns are filled here. */
export function buildSaveValues(metadata: EntityMetadata, entity: EntityValues, isInsert: boolean): EntityValues {
  const values: EntityValues = {}
  for (const column of metadata.columns) {
    if (column.isGenerated && isInsert) {
      if (column.generationStrategy === 'uuid' && column.getEntityValue(entity) === undefined) {
        values[column.propertyName] = randomUuid()
      }
      continue
    }
    if (!isInsert && column.isPrimary) continue
    const current = column.getEntityValue(entity)
    if (column.isVersion) {
      values[column.propertyName] = isInsert ? 1 : (typeof current === 'number' ? current : 0) + 1
      continue
    }
    if (column.isUpdateDate) {
      values[column.propertyName] = new Date()
      continue
    }
    if (column.isCreateDate && isInsert) {
      values[column.propertyName] = current ?? new Date()
      continue
    }
    if (current !== undefined) values[column.propertyName] = current
  }
  applyForeignKeys(metadata, entity, values)
  return values
}

/** 外键列：关系对象取其主键，标量原样写入。 / FK columns: take the target key from an object, pass a scalar through. */
function applyForeignKeys(metadata: EntityMetadata, entity: EntityValues, values: EntityValues): void {
  for (const relation of metadata.relations) {
    const joinColumn = relation.joinColumns[0]
    if (joinColumn === undefined) continue
    const value = entity[relation.propertyName]
    if (value === undefined) continue
    if (value === null) {
      values[relation.propertyName] = null
    } else if (typeof value === 'object') {
      const key = (value as EntityValues)[requireTarget(relation).primaryColumn.propertyName]
      if (key !== undefined) values[relation.propertyName] = key
    } else {
      values[relation.propertyName] = value
    }
  }
}

/** 无变化判定：忽略更新时间与版本列，重复 save 零写入。 / Unchanged check: ignore the update timestamp and version so a repeated save costs zero writes. */
export function isUnchanged(metadata: EntityMetadata, values: EntityValues, existing: EntityValues): boolean {
  const ignored = new Set<string>()
  if (metadata.updateDateColumn !== undefined) ignored.add(metadata.updateDateColumn.propertyName)
  if (metadata.versionColumn !== undefined) ignored.add(metadata.versionColumn.propertyName)
  for (const [property, value] of Object.entries(values)) {
    if (ignored.has(property)) continue
    const column = metadata.findColumn(property)
    if (column === undefined) continue
    if (!sameValue(value, column.getEntityValue(existing))) return false
  }
  return true
}

/** 值比较：日期按时间戳，其余严格相等。 / Value comparison: dates by timestamp, everything else strictly. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  return left === right
}

/** 主键值字典。 / Primary-key value map. */
export function primaryValues(metadata: EntityMetadata, entity: EntityValues): EntityValues {
  const values: EntityValues = {}
  for (const column of metadata.primaryColumns) {
    const value = column.getEntityValue(entity)
    if (value !== undefined) values[column.propertyName] = value
  }
  return values
}

/** 把写入值回写到实体。 / Write values back onto the entity. */
export function assignValues(metadata: EntityMetadata, entity: EntityValues, values: EntityValues): void {
  for (const [property, value] of Object.entries(values)) {
    const column = metadata.findColumn(property)
    if (column !== undefined) column.setEntityValue(entity, value)
  }
}

/** 广播一个事件点；`listeners: false` 时整体关闭。 / Broadcast one event; `listeners: false` disables everything. */
export async function broadcast(
  manager: EntityManager,
  hook: 'beforeInsert' | 'afterInsert' | 'beforeUpdate' | 'afterUpdate' | 'beforeRemove' | 'afterRemove',
  metadata: EntityMetadata,
  entity: EntityValues,
  extra: Omit<SubscriberEventData, 'entity' | 'metadata'>,
  enabled: boolean,
): Promise<void> {
  if (!enabled) return
  await new Broadcaster(manager.dataSource.subscribers).broadcast(hook, { entity, metadata, ...extra })
}
