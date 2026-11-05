/**
 * @veren/orm 的公共类型面：配置、结果、事件与方言无关的最小词汇。
 * 类型只描述形状，不含任何运行时逻辑。
 *
 * The public type surface of @veren/orm: configuration, results, events and the
 * smallest dialect-neutral vocabulary. Types describe shapes only; no runtime
 * logic lives here.
 *
 * @module @veren/orm/types
 */

import type { EntitySchema } from './metadata/entity-schema.ts'
import type { NamingStrategyInterface } from './naming/naming-strategy.ts'
import type { Logger } from './logger/logger.ts'
import type { QueryRunner } from './driver/query-runner.ts'
import type { MigrationInterface } from './migration/migration.ts'
import type { EntitySubscriberInterface } from './subscriber/subscriber.ts'
import type { EntityManager } from './runtime/entity-manager.ts'

/** 可构造的实体类；构造参数不参与契约。 / Constructible entity class; constructor args are not part of the contract. */
export type EntityClass<Entity extends object = object> = new (...args: never[]) => Entity

/** 实体目标的三种声明形态。 / The three declaration forms of an entity target. */
export type EntityTarget<Entity extends object = object> =
  | EntityClass<Entity>
  | string
  | EntitySchema<Entity>

/** 一行原始数据（列名 → 值）；数据库边界天然是字典，故保留索引签名。 / One raw row; the database boundary is a dictionary by nature. */
export type Row = { readonly [column: string]: unknown }

/** 可写入实体的属性字典。 / A dictionary of writable entity properties. */
export type EntityValues = { [property: string]: unknown }

/** 列类型词汇，方言负责映射为具体 DDL 类型。 / Column type vocabulary; dialects map it to concrete DDL types. */
export type ColumnType =
  | 'int'
  | 'integer'
  | 'bigint'
  | 'smallint'
  | 'varchar'
  | 'text'
  | 'boolean'
  | 'float'
  | 'double'
  | 'decimal'
  | 'date'
  | 'datetime'
  | 'timestamp'
  | 'time'
  | 'json'
  | 'jsonb'
  | 'blob'
  | 'uuid'
  | 'simple-array'
  | 'simple-json'

/** 值转换器；读写两侧各一次。 / Value transformer applied once on each side. */
export interface ValueTransformer {
  to(value: unknown): unknown
  from(value: unknown): unknown
}

/** 列定义选项。 / Column definition options. */
export interface ColumnOptions {
  type?: ColumnType
  name?: string
  length?: number
  precision?: number
  scale?: number
  nullable?: boolean
  default?: unknown
  unique?: boolean
  primary?: boolean
  generated?: boolean
  transformer?: ValueTransformer | readonly ValueTransformer[]
  comment?: string
  enum?: readonly string[]
}

/** 关系定义选项。 / Relation definition options. */
export interface RelationOptions {
  cascade?: boolean | readonly CascadeOption[]
  eager?: boolean
  nullable?: boolean
  orphanedRowAction?: 'nullify' | 'delete' | 'soft-delete' | 'disable'
  onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION'
  onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION'
  createForeignKeyConstraints?: boolean
  joinColumn?: string
  inverseJoinColumn?: string
}

/** 级联动作。 / Cascade actions. */
export type CascadeOption = 'insert' | 'update' | 'remove' | 'soft-remove' | 'recover'

/** 数据库隔离级别。 / Database isolation level. */
export type IsolationLevel =
  | 'READ UNCOMMITTED'
  | 'READ COMMITTED'
  | 'REPEATABLE READ'
  | 'SERIALIZABLE'

/** 日志级别。 / Log levels. */
export type LogLevel = 'query' | 'schema' | 'error' | 'warn' | 'info' | 'log' | 'migration'

/** 日志配置。 / Logging configuration. */
export type LoggingOptions = boolean | 'all' | readonly LogLevel[]

/** 客户端一次查询的归一化结果。 / The normalized result of one client query. */
export interface SqlQueryResult {
  rows: readonly Row[]
  affected?: number
  insertId?: number | bigint
}

/**
 * 环境桥：任何平台只要实现这一个方法就能承载全部 ORM 能力。
 * 核心与方言不 import 任何 Node 内建，数据库连接完全由这一层注入。
 *
 * The environment bridge: any platform that implements this single method can
 * host the whole ORM. Core and dialects import no Node built-in; the actual
 * connection is injected entirely through this layer.
 */
export interface SqlClient {
  query(sql: string, parameters?: readonly unknown[]): Promise<SqlQueryResult>
  close?(): Promise<void>
}

/** 客户端工厂；异步以便驱动惰性打开连接池。 / Client factory; async so a driver can lazily open its pool. */
export type SqlClientFactory = (options: DataSourceOptions) => Promise<SqlClient>

/** 数据源公共配置。方言专有字段按需声明在同一扁平对象上，驱动读取自己关心的键。 / Shared data source options; dialect-specific keys sit on the same flat object and each driver reads what it needs. */
export interface DataSourceOptions {
  /** 方言名，必须已注册 / dialect name, must be registered */
  type: string
  /** 实体声明（类、EntitySchema 或表名） / entity declarations */
  entities?: readonly EntityTarget[]
  /** 事件订阅者 / event subscribers */
  subscribers?: readonly EntitySubscriberInterface<object>[]
  /** 迁移类 / migration classes */
  migrations?: readonly (new () => MigrationInterface)[]
  /** 危险开关：启动期模式同步 / dangerous: schema sync at startup */
  synchronize?: boolean
  /** 危险开关：启动期删表重建 / dangerous: drop tables at startup */
  dropSchema?: boolean
  /** 危险开关：启动期自动迁移 / dangerous: run pending migrations at startup */
  migrationsRun?: boolean
  /** 迁移账本表名，默认 migrations / migration ledger table, default `migrations` */
  migrationsTableName?: string
  /** 全部表名前缀 / prefix for every table name */
  entityPrefix?: string
  /** 日志开关 / logging switches */
  logging?: LoggingOptions
  /** 自定义日志器；false 关闭 / custom logger; false disables */
  logger?: Logger | false
  /** 慢查询阈值（毫秒） / slow-query threshold in milliseconds */
  maxQueryExecutionTime?: number
  /** 命名策略 / naming strategy */
  namingStrategy?: NamingStrategyInterface
  /** 显式环境桥，优先于驱动默认连接 / explicit environment bridge, wins over the driver default */
  client?: SqlClient | SqlClientFactory
  /** 连接串（postgres/mysql 使用） / connection string used by postgres/mysql */
  url?: string
  /** 数据库文件名（sqlite 使用，缺省内存库） / sqlite file name, defaults to an in-memory database */
  filename?: string
  /** 主机（postgres/mysql 使用） / host for postgres/mysql */
  host?: string
  /** 端口（postgres/mysql 使用） / port for postgres/mysql */
  port?: number
  /** 用户名（postgres/mysql 使用） / user name */
  username?: string
  /** 密码（postgres/mysql 使用） / password */
  password?: string
  /** 数据库名（postgres/mysql 使用） / database name */
  database?: string
  /** 额外透传字段，驱动自定义 / extra pass-through fields read by custom drivers */
  extra?: object
}

/** 保存选项。 / Save options. */
export interface SaveOptions {
  /** 是否广播事件与执行监听器，默认 true / whether to broadcast events and listeners, default true */
  listeners?: boolean
  /** 是否自行包裹事务，默认 true / whether to wrap in a transaction, default true */
  transaction?: boolean
  /** 是否回写数据库生成列，默认 true / whether to write generated columns back, default true */
  reload?: boolean
  /** 透传给订阅者的业务载荷 / business payload passed to subscribers */
  data?: object
}

/** 删除选项。 / Remove options. */
export interface RemoveOptions {
  listeners?: boolean
  transaction?: boolean
  data?: object
}

/** 插入结果。 / Insert result. */
export interface InsertResult {
  raw: unknown
  generatedMaps: readonly EntityValues[]
  identifiers: readonly EntityValues[]
}

/** 更新结果。 / Update result. */
export interface UpdateResult {
  raw: unknown
  generatedMaps: readonly EntityValues[]
  affected?: number
}

/** 删除结果。 / Delete result. */
export interface DeleteResult {
  raw: unknown
  affected?: number
}

/** 事务回调。 / A transaction callback. */
export type TransactionCallback<T> = (manager: EntityManager) => Promise<T>

/** 查询构建器执行结果。 / Query builder execution result. */
export interface QueryResult {
  raw: unknown
  rows: readonly Row[]
  affected?: number
  insertId?: number | bigint
}

/** 声明式查询选项（由查询域定义，此处再导出以保持公共入口单一）。 / Declarative options, re-exported from the query domain for one public entry. */
export type {
  FindManyOptions,
  FindOptionsOrder,
  FindOptionsRelations,
  FindOptionsWhere,
} from './query/find-options.ts'
