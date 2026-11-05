/**
 * @veren/orm 的结构化错误面（基础层）：稳定 code + 类名，两者都是公共契约。
 * 错误消息面向开发者，三要素固定为「发生了什么 / 为什么 / 下一步做什么」。
 *
 * The structured error surface (base layer): a stable `code` plus the class name
 * are both public contracts. Messages target developers and always answer what
 * happened, why, and what to do next.
 *
 * @module @veren/orm/errors/base
 */

/** 稳定错误码；新增码只能追加，不得改名。 / Stable error codes; append only, never rename. */
export type OrmErrorCode =
  | 'QUERY_FAILED'
  | 'QUERY_RUNNER_RELEASED'
  | 'TRANSACTION_ALREADY_STARTED'
  | 'TRANSACTION_NOT_STARTED'
  | 'MISSING_DRIVER'
  | 'DRIVER_PACKAGE_NOT_INSTALLED'
  | 'DRIVER_OPTION_NOT_SET'
  | 'UNSUPPORTED_DATA_TYPE'
  | 'CANNOT_EXECUTE_NOT_CONNECTED'
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_METADATA_NOT_FOUND'
  | 'MISSING_PRIMARY_COLUMN'
  | 'COLUMN_TYPE_UNDEFINED'
  | 'DUPLICATE_METADATA'
  | 'CIRCULAR_RELATIONS'
  | 'INVALID_METADATA'
  | 'EMPTY_CRITERIA'
  | 'ENTITY_PROPERTY_NOT_FOUND'
  | 'CANNOT_CREATE_ENTITY_ID'
  | 'MISSING_DELETE_DATE_COLUMN'
  | 'OPTIMISTIC_LOCK_MISMATCH'
  | 'SCHEMA_SYNC_FAILED'
  | 'MIGRATION_FAILED'
  | 'UNSUPPORTED_FEATURE'

/**
 * 全部 ORM 错误的公共祖先。原型链显式修复，跨编译目标保持 `instanceof`。
 * Common ancestor of every ORM error. The prototype chain is repaired so
 * `instanceof` survives every compilation target.
 */
export abstract class OrmError extends Error {
  /** 稳定错误码 / stable error code */
  abstract readonly code: OrmErrorCode

  constructor(message: string) {
    super(message)
    this.name = new.target.name
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * SQL 执行失败：驱动原始错误挂在 `driverError` 上，永不裸抛。
 * A query failed: the raw driver error rides on `driverError` and is never
 * thrown bare.
 */
export class QueryFailedError extends OrmError {
  readonly code = 'QUERY_FAILED' as const
  readonly query: string
  readonly parameters: readonly unknown[]
  readonly driverError: unknown

  constructor(query: string, parameters: readonly unknown[], driverError: unknown) {
    const reason = driverError instanceof Error ? driverError.message : String(driverError)
    super(`Query failed: ${reason}\nSQL: ${query}\nParameters: ${formatParameters(parameters)}`)
    this.query = query
    this.parameters = parameters
    this.driverError = driverError
  }
}

/** 参数数组的可读摘要；截断超长值，避免日志被大值淹没。 / Readable parameter summary, long values truncated. */
function formatParameters(parameters: readonly unknown[]): string {
  const text = parameters.map((value) => (typeof value === 'string' ? `'${value}'` : String(value))).join(', ')
  return text.length > 500 ? `${text.slice(0, 500)}…` : text
}

/** 执行器已释放后再使用 / using a released query runner */
export class QueryRunnerAlreadyReleasedError extends OrmError {
  readonly code = 'QUERY_RUNNER_RELEASED' as const
  constructor() {
    super('This query runner has been released and can no longer run queries. Create a new one or keep it alive for the transaction scope.')
  }
}

/** 同一执行器重复开启事务 / starting a transaction twice on one runner */
export class TransactionAlreadyStartedError extends OrmError {
  readonly code = 'TRANSACTION_ALREADY_STARTED' as const
  constructor() {
    super('A transaction is already active on this query runner. Use the entity manager handed to the transaction callback instead of starting a nested one.')
  }
}

/** 未开启事务却提交或回滚 / committing or rolling back without a transaction */
export class TransactionNotStartedError extends OrmError {
  readonly code = 'TRANSACTION_NOT_STARTED' as const
  constructor() {
    super('This query runner has no active transaction to commit or roll back. Start one first or remove the commit call.')
  }
}

/** 方言名未注册 / unknown dialect name */
export class MissingDriverError extends OrmError {
  readonly code = 'MISSING_DRIVER' as const
  readonly driverType: string
  readonly available: readonly string[]

  constructor(driverType: string, available: readonly string[]) {
    super(`No driver is registered for data source type "${driverType}". Registered types: ${available.join(', ') || '(none)'}. Import the matching "@veren/orm/driver/<type>" entry or call registerDriver().`)
    this.driverType = driverType
    this.available = available
  }
}

/** 客户端库缺失 / missing client package */
export class DriverPackageNotInstalledError extends OrmError {
  readonly code = 'DRIVER_PACKAGE_NOT_INSTALLED' as const
  readonly packageName: string

  constructor(packageName: string) {
    super(`The "${packageName}" package is required by this driver but is not installed. Install it (for example "pnpm add ${packageName}") or pass an explicit client to the data source options.`)
    this.packageName = packageName
  }
}

/** 驱动必填选项缺失 / required driver option missing */
export class DriverOptionNotSetError extends OrmError {
  readonly code = 'DRIVER_OPTION_NOT_SET' as const
  readonly optionName: string

  constructor(optionName: string) {
    super(`Driver option "${optionName}" is required but was not provided. Add it to the data source options.`)
    this.optionName = optionName
  }
}

/** 方言不支持该列类型 / dialect does not support a column type */
export class UnsupportedDataTypeError extends OrmError {
  readonly code = 'UNSUPPORTED_DATA_TYPE' as const
  readonly dataType: string

  constructor(dataType: string, driverType: string) {
    super(`Column type "${dataType}" is not supported by the "${driverType}" dialect. Pick another type or contribute a mapping for this dialect.`)
    this.dataType = dataType
  }
}

/** 未初始化数据源即访问数据 / data access before initialize */
export class CannotExecuteNotConnectedError extends OrmError {
  readonly code = 'CANNOT_EXECUTE_NOT_CONNECTED' as const
  constructor() {
    super('This data source is not initialized, so no data access is possible. Call await dataSource.initialize() before using repositories or the entity manager.')
  }
}

/** findOneOrFail 查无结果 / findOneOrFail found nothing */
export class EntityNotFoundError extends OrmError {
  readonly code = 'ENTITY_NOT_FOUND' as const
  readonly targetName: string

  constructor(targetName: string, criteria: string) {
    super(`No "${targetName}" matches the given criteria (${criteria}). Query with findOne() when a missing row is a normal outcome.`)
    this.targetName = targetName
  }
}

/** 目标未在任何数据源注册 / target not registered on this data source */
export class EntityMetadataNotFoundError extends OrmError {
  readonly code = 'ENTITY_METADATA_NOT_FOUND' as const
  readonly targetName: string

  constructor(targetName: string) {
    super(`No metadata is registered for "${targetName}". Add the entity class or EntitySchema to the data source "entities" option.`)
    this.targetName = targetName
  }
}
