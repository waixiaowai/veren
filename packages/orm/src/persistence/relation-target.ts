/**
 * 关系目标解析断言：持久化与关系构建共用。
 * Relation-target assertion shared by persistence and relation building.
 *
 * @module @veren/orm/persistence/relation-target
 */

import { CannotCreateEntityIdMapError } from '../errors/index.ts'
import type { EntityMetadata, RelationMetadata } from '../metadata/entity-metadata.ts'

/** 关系目标必须已解析；否则是元数据构建缺陷。 / The relation target must be resolved; otherwise metadata building is defective. */
export function requireTarget(relation: RelationMetadata): EntityMetadata {
  if (relation.targetMetadata === undefined) throw new CannotCreateEntityIdMapError(relation.entityMetadata.targetName)
  return relation.targetMetadata
}
