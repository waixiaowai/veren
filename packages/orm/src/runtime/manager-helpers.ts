/**
 * 管理器辅助：参数归一、空条件防护与软删列断言。
 * 从 EntityManager 拆出，让门面类只保留操作入口。
 *
 * Manager helpers: argument normalization, empty-criteria guard and the
 * delete-date assertion. Split from EntityManager so the facade keeps only
 * operation entries.
 *
 * @module @veren/orm/runtime/manager-helpers
 */

import { EmptyCriteriaError, MissingDeleteDateColumnError } from '../errors/index.ts'
import { isEntitySchema } from '../metadata/entity-schema.ts'
import type { EntityMetadata } from '../metadata/entity-metadata.ts'
import type { EntityTarget, EntityValues, RemoveOptions, SaveOptions } from '../types.ts'

/** 归一后的持久化参数。 / Normalized persistence arguments. */
export interface NormalizedPersistArgs {
  target?: EntityTarget
  entities: readonly EntityValues[]
  options: SaveOptions & RemoveOptions
}

/** 持久化参数归一。 / Normalize persistence arguments. */
export function normalizePersistArgs(
  first: EntityTarget | object | readonly object[],
  second?: object | readonly object[] | SaveOptions | RemoveOptions,
  third?: SaveOptions | RemoveOptions,
): NormalizedPersistArgs {
  if (isEntityTarget(first)) {
    return {
      target: first,
      entities: toEntities(second),
      options: (third ?? {}) as SaveOptions & RemoveOptions,
    }
  }
  return { entities: toEntities(first), options: (second ?? {}) as SaveOptions & RemoveOptions }
}

/** 实体数组归一。 / Normalize to an entity array. */
function toEntities(value: unknown): readonly EntityValues[] {
  if (value === undefined) return []
  return (Array.isArray(value) ? value : [value]) as readonly EntityValues[]
}

/** 是否实体目标（类、名字、EntitySchema）。 / Whether a value is an entity target. */
export function isEntityTarget(value: unknown): value is EntityTarget {
  return typeof value === 'function' || typeof value === 'string' || isEntitySchema(value)
}

/** 从实体推断目标。 / Infer the target from an entity instance. */
export function targetOf(entity: EntityValues): EntityTarget {
  const target = entity.constructor
  if (typeof target !== 'function' || target === Object) {
    throw new EmptyCriteriaError('save without an explicit target on a plain object')
  }
  return target as EntityTarget
}

/** 空条件防护。 / Empty-criteria guard. */
export function assertCriteria(criteria: object, methodName: string): void {
  if (criteria === null || typeof criteria !== 'object' || Array.isArray(criteria)) {
    throw new EmptyCriteriaError(methodName)
  }
  if (Object.keys(criteria).length === 0) throw new EmptyCriteriaError(methodName)
}

/** 软删列必须存在。 / The delete-date column must exist. */
export function requireDeleteDateColumn(metadata: EntityMetadata): NonNullable<EntityMetadata['deleteDateColumn']> {
  const column = metadata.deleteDateColumn
  if (column === undefined) throw new MissingDeleteDateColumnError(metadata.targetName)
  return column
}

/** 合并显式关系声明与 eager 关系；两者都为空时返回 undefined。 / Merge explicit relations with eager ones; undefined when both are empty. */
export function resolveRelations(metadata: EntityMetadata, provided?: object): object | undefined {
  const entries = new Map(Object.entries(provided ?? {}))
  for (const relation of metadata.relations) {
    if (relation.isEager && !entries.has(relation.propertyName)) entries.set(relation.propertyName, true)
  }
  return entries.size === 0 ? undefined : Object.fromEntries(entries)
}
