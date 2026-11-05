/**
 * 原始行 → 实体：按 `别名_列名` 键取值，经值转换器后写回实体属性。
 * 只装配主实体；关系的装载由关系加载器以独立查询完成（避免笛卡尔积去重）。
 *
 * Raw rows → entities: read `alias_column` keys, run value transformers, write
 * entity properties. Only the main entity is assembled; relation loading uses
 * independent queries to avoid cartesian-product de-duplication.
 *
 * @module @veren/orm/query/transformer
 */

import type { Driver } from '../driver/driver.ts'
import type { EntityMetadata } from '../metadata/entity-metadata.ts'
import type { EntityValues, Row } from '../types.ts'
import { resultKey } from './sql-utils.ts'

/** 行集 → 实体数组。 / Rows → entity array. */
export function rowsToEntities(
  rows: readonly Row[],
  metadata: EntityMetadata,
  alias: string,
  driver: Driver,
): EntityValues[] {
  return rows.map((row) => rowToEntity(row, metadata, alias, driver))
}

/** 单行 → 实体；缺失的列保持实体默认值。 / One row → entity; missing columns keep entity defaults. */
export function rowToEntity(row: Row, metadata: EntityMetadata, alias: string, driver: Driver): EntityValues {
  const entity = metadata.create()
  for (const column of metadata.columns) {
    const key = resultKey(alias, column.databaseName)
    if (!Object.hasOwn(row, key)) continue
    column.setEntityValue(entity, driver.prepareHydratedValue(column, row[key]))
  }
  for (const relation of metadata.relations) {
    const joinColumn = relation.joinColumns[0]
    if (joinColumn === undefined) continue
    const key = resultKey(alias, joinColumn.databaseName)
    if (Object.hasOwn(row, key)) entity[relation.propertyName] = row[key]
  }
  return entity
}
