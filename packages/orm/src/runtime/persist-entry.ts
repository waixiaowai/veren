/**
 * 持久化入口适配：把仓储/管理器的多态参数转成管线调用，并还原单实体返回形状。
 * 从 EntityManager 拆出，门面类因此只保留一行委托。
 *
 * Persistence entry adapter: turn the polymorphic repository/manager arguments
 * into a pipeline call and restore the single-entity return shape. Split from
 * EntityManager so the facade stays a one-line delegation.
 *
 * @module @veren/orm/runtime/persist-entry
 */

import { persistEntities, type PersistMode } from '../persistence/persist.ts'
import type { EntityTarget, EntityValues, RemoveOptions, SaveOptions } from '../types.ts'
import type { EntityManager } from './entity-manager.ts'
import { isEntityTarget, normalizePersistArgs, targetOf } from './manager-helpers.ts'

/** 保存/删除的统一入口：归一参数、解析元数据、交给持久化管线。 / The shared save/remove entry: normalize args, resolve metadata, call the pipeline. */
export async function runPersist(
  manager: EntityManager,
  mode: PersistMode,
  first: EntityTarget | object | readonly object[],
  second?: object | readonly object[] | SaveOptions | RemoveOptions,
  third?: SaveOptions | RemoveOptions,
): Promise<EntityValues | EntityValues[]> {
  const many = isEntityTarget(first) ? Array.isArray(second) : Array.isArray(first)
  const entities = await persist(manager, mode, first, second, third)
  return many ? entities : entities[0]!
}

/** 归一参数并交给持久化管线。 / Normalize arguments and hand off to the pipeline. */
function persist(
  manager: EntityManager,
  mode: PersistMode,
  first: EntityTarget | object | readonly object[],
  second?: object | readonly object[] | SaveOptions | RemoveOptions,
  third?: SaveOptions | RemoveOptions,
): Promise<EntityValues[]> {
  const normalized = normalizePersistArgs(first, second, third)
  if (normalized.entities.length === 0) return Promise.resolve([])
  const target = normalized.target ?? targetOf(normalized.entities[0]!)
  const metadata = manager.dataSource.getMetadata(target)
  return persistEntities(manager, metadata, normalized.entities, mode, normalized.options)
}
