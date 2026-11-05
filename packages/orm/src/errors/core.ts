/**
 * @veren/orm 的元数据、持久化、模式与迁移错误。
 * 与 base 同属一个体系：类名即稳定标识，构造内修好原型链。
 *
 * Metadata, persistence, schema and migration errors. Same system as `base`:
 * the class name is the stable identifier and the prototype chain is repaired.
 *
 * @module @veren/orm/errors/core
 */

import { OrmError } from './base.ts'

/** 实体缺主键 / entity has no primary column */
export class MissingPrimaryColumnError extends OrmError {
  readonly code = 'MISSING_PRIMARY_COLUMN' as const
  readonly targetName: string

  constructor(targetName: string) {
    super(`Entity "${targetName}" has no primary column. Decorate one property with @PrimaryColumn or @PrimaryGeneratedColumn.`)
    this.targetName = targetName
  }
}

/** 列类型无法推断且未显式声明 / column type missing */
export class ColumnTypeUndefinedError extends OrmError {
  readonly code = 'COLUMN_TYPE_UNDEFINED' as const
  readonly targetName: string
  readonly propertyName: string

  constructor(targetName: string, propertyName: string) {
    super(`Column "${targetName}.${propertyName}" has no type. Pass { type: "..." } explicitly; this library deliberately does not rely on reflect-metadata.`)
    this.targetName = targetName
    this.propertyName = propertyName
  }
}

/** 同名元数据重复注册 / duplicate metadata registration */
export class DuplicateMetadataError extends OrmError {
  readonly code = 'DUPLICATE_METADATA' as const
  readonly metadataName: string

  constructor(metadataName: string) {
    super(`Metadata "${metadataName}" is registered more than once. Keep one declaration per table name and remove the duplicate.`)
    this.metadataName = metadataName
  }
}

/** 关系双向绑定失败 / relation inverse binding failed */
export class CircularRelationsError extends OrmError {
  readonly code = 'CIRCULAR_RELATIONS' as const
  constructor(message: string) {
    super(`${message} Declare the inverse side of the relation so both ends point at each other.`)
  }
}

/** 元数据校验失败 / metadata validation failed */
export class InvalidMetadataError extends OrmError {
  readonly code = 'INVALID_METADATA' as const
  constructor(message: string) {
    super(message)
  }
}

/** 空写条件被拒绝 / empty write criteria rejected */
export class EmptyCriteriaError extends OrmError {
  readonly code = 'EMPTY_CRITERIA' as const
  constructor(methodName: string) {
    super(`${methodName} requires a non-empty criteria. An empty condition would rewrite or delete every row, so it is rejected on purpose.`)
  }
}

/** 属性或关系名不存在 / unknown property or relation path */
export class EntityPropertyNotFoundError extends OrmError {
  readonly code = 'ENTITY_PROPERTY_NOT_FOUND' as const
  readonly propertyPath: string
  readonly targetName: string

  constructor(propertyPath: string, targetName: string) {
    super(`Property "${propertyPath}" does not exist on "${targetName}". Check the spelling or add the column/relation to the entity.`)
    this.propertyPath = propertyPath
    this.targetName = targetName
  }
}

/** 新实体无法推断标识 / new entity identifier cannot be inferred */
export class CannotCreateEntityIdMapError extends OrmError {
  readonly code = 'CANNOT_CREATE_ENTITY_ID' as const
  readonly targetName: string

  constructor(targetName: string) {
    super(`Cannot infer the identifier of a new "${targetName}" entity. Provide primary key values or use a generated primary column.`)
    this.targetName = targetName
  }
}

/** 软删缺少删除时间列 / soft delete without a delete-date column */
export class MissingDeleteDateColumnError extends OrmError {
  readonly code = 'MISSING_DELETE_DATE_COLUMN' as const
  readonly targetName: string

  constructor(targetName: string) {
    super(`Entity "${targetName}" has no delete-date column, so soft delete cannot work. Add a @DeleteDateColumn() property or use remove().`)
    this.targetName = targetName
  }
}

/** 乐观锁版本不匹配 / optimistic lock version mismatch */
export class OptimisticLockVersionMismatchError extends OrmError {
  readonly code = 'OPTIMISTIC_LOCK_MISMATCH' as const
  readonly targetName: string

  constructor(targetName: string, expected: unknown, actual: unknown) {
    super(`Version mismatch while updating "${targetName}": expected ${String(expected)}, database has ${String(actual)}. Reload the entity and merge before retrying.`)
    this.targetName = targetName
  }
}

/** 模式同步失败 / schema synchronization failed */
export class SchemaSyncError extends OrmError {
  readonly code = 'SCHEMA_SYNC_FAILED' as const
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

/** 迁移执行失败 / migration execution failed */
export class MigrationError extends OrmError {
  readonly code = 'MIGRATION_FAILED' as const
  readonly migrationName: string

  constructor(migrationName: string, message: string) {
    super(`Migration "${migrationName}" failed: ${message}`)
    this.migrationName = migrationName
  }
}

/** 驱动能力不支持的操作 / operation not supported by the driver */
export class UnsupportedFeatureError extends OrmError {
  readonly code = 'UNSUPPORTED_FEATURE' as const
  constructor(feature: string) {
    super(`${feature} is not supported by the current driver. Check the driver capability flags before using this feature.`)
  }
}
