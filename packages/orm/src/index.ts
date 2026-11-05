/**
 * @veren/orm 公共入口：数据源、门面、声明式元数据、查询与持久化。
 * 方言通过子路径 `@veren/orm/driver/<type>` 显式注册；薄入口
 * `@veren/orm/cordis`、`/hono`、`/express` 只加载各自需要的那一层。
 *
 * The public entry of @veren/orm: data sources, facades, declarative metadata,
 * queries and persistence. Dialects register explicitly through
 * `@veren/orm/driver/<type>`; the thin entries `/cordis`, `/hono` and
 * `/express` load only the layer they need.
 *
 * @module @veren/orm
 */

export { DataSource } from './runtime/data-source.ts'
export { EntityManager } from './runtime/entity-manager.ts'
export { Repository } from './runtime/repository.ts'

export {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from './metadata/decorators.ts'
export type { AnyDecorator, EntityOptions, IndexDecoratorOptions } from './metadata/decorators.ts'
export { EntitySchema, isEntitySchema } from './metadata/entity-schema.ts'
export type {
  EntitySchemaColumnOptions,
  EntitySchemaIndexOptions,
  EntitySchemaOptions,
  EntitySchemaRelationOptions,
} from './metadata/entity-schema.ts'
export { ColumnMetadata, EntityMetadata, RelationMetadata } from './metadata/entity-metadata.ts'
export { getMetadataArgsStorage, MetadataArgsStorage } from './metadata/args.ts'

export {
  Between,
  Equal,
  FindOperator,
  ILike,
  In,
  isFindOperator,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Like,
  MoreThan,
  MoreThanOrEqual,
  Not,
  Raw,
} from './query/find-operator.ts'
export { Brackets } from './query/brackets.ts'
export type { WhereExpression } from './query/brackets.ts'
export { QueryExpressionMap } from './query/expression-map.ts'
export type { Alias, JoinAttribute, OrderByClause, QueryType, WhereClause } from './query/expression-map.ts'
export { SelectQueryBuilder } from './query/select-builder.ts'
export { InsertQueryBuilder } from './query/insert-builder.ts'
export { DeleteQueryBuilder, UpdateQueryBuilder } from './query/update-builder.ts'
export { applyFindOptions } from './query/find-options.ts'

export { registerDriver, getDriverDefinition, getRegisteredDriverTypes, hasDriver } from './driver/registry.ts'
export type { DriverDefinition } from './driver/registry.ts'
export { BaseDriver, singleClientPool, poolFromOptions } from './driver/driver.ts'
export type { ClientPool, Driver, PoolOpener } from './driver/driver.ts'
export { QueryRunner } from './driver/query-runner.ts'
export type { DriverCapabilities, SqlDialect } from './driver/dialect.ts'
export { escapeQueryWithParameters } from './driver/dialect.ts'
export { PostgresDialect } from './driver/postgres-dialect.ts'
export { MysqlDialect } from './driver/mysql-dialect.ts'
export { SqliteDialect } from './driver/sqlite-dialect.ts'

export { DefaultNamingStrategy, shortHash, snakeCase } from './naming/naming-strategy.ts'
export type { NamingStrategyInterface } from './naming/naming-strategy.ts'

export { ConsoleLogger, createLogger, NoopLogger, resolveLevels } from './logger/logger.ts'
export type { Logger } from './logger/logger.ts'

export { MigrationExecutor } from './migration/executor.ts'
export { migrationFromClass, migrationTimestamp } from './migration/migration.ts'
export type { Migration, MigrationInterface } from './migration/migration.ts'

export { SchemaBuilder } from './schema/schema-builder.ts'
export type { SchemaQuery, SqlInMemory, Table, TableColumn, TableForeignKey, TableIndex } from './schema/table.ts'

export type {
  BaseEvent,
  EntitySubscriberInterface,
  InsertEvent,
  LoadEvent,
  RemoveEvent,
  UpdateEvent,
} from './subscriber/subscriber.ts'

export * from './errors/index.ts'

export type {
  CascadeOption,
  ColumnOptions,
  ColumnType,
  DataSourceOptions,
  DeleteResult,
  EntityClass,
  EntityTarget,
  EntityValues,
  FindManyOptions,
  FindOptionsOrder,
  FindOptionsRelations,
  FindOptionsWhere,
  InsertResult,
  IsolationLevel,
  LoggingOptions,
  LogLevel,
  QueryResult,
  RelationOptions,
  RemoveOptions,
  Row,
  SaveOptions,
  SqlClient,
  SqlClientFactory,
  SqlQueryResult,
  TransactionCallback,
  UpdateResult,
  ValueTransformer,
} from './types.ts'
