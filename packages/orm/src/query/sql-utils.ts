/**
 * 查询 SQL 的一小组纯函数：属性 → 列、别名 → 稳定结果键。
 * 这些规则只写一次，查询构建、结果装配与迁移生成共用同一口径。
 *
 * A small set of pure query SQL helpers: property → column, alias → stable
 * result key. Written once so the builder, the row mapper and migration
 * generation share identical rules.
 *
 * @module @veren/orm/query/sql-utils
 */

import { EntityPropertyNotFoundError } from '../errors/index.ts'
import type { EntityMetadata } from '../metadata/entity-metadata.ts'

/** 属性名 → 库内列名；关系属性映射到其外键列。 / Property → database column; relation properties map to their FK. */
export function resolveDatabaseName(metadata: EntityMetadata, property: string): string {
  const column = metadata.findColumn(property)
  if (column !== undefined) return column.databaseName
  const relation = metadata.findRelation(property)
  const joinColumn = relation?.joinColumns[0]
  if (joinColumn !== undefined) return joinColumn.databaseName
  throw new EntityPropertyNotFoundError(property, metadata.targetName)
}

/** 结果行里的稳定键：`别名_列名`。 / Stable result key: `alias_column`. */
export function resultKey(alias: string, databaseName: string): string {
  return `${alias}_${databaseName}`
}

/** 渲染 `"alias"."column"`；空别名渲染为不带限定的 `"column"`。 / Render `"alias"."column"`; an empty alias renders unqualified. */
export function columnRef(escape: (name: string) => string, alias: string, databaseName: string): string {
  return alias === '' ? escape(databaseName) : `${escape(alias)}.${escape(databaseName)}`
}

/** 实体全部列的带别名投影（关系外键列一并取出，供关系装载使用）。 / Aliased projection of every column, relation FKs included for loading. */
export function projectionOf(escape: (name: string) => string, alias: string, metadata: EntityMetadata): string[] {
  const projections = metadata.columns.map((column) => {
    const key = resultKey(alias, column.databaseName)
    return `${columnRef(escape, alias, column.databaseName)} AS ${escape(key)}`
  })
  for (const relation of metadata.relations) {
    for (const joinColumn of relation.joinColumns) {
      const key = resultKey(alias, joinColumn.databaseName)
      projections.push(`${columnRef(escape, alias, joinColumn.databaseName)} AS ${escape(key)}`)
    }
  }
  return projections
}
