/**
 * 数据源：预配置数据库连接的总管理器。
 * `initialize` 串行完成「连接 → 元数据构建校验 → 危险开关」，任一步失败即整体
 * 失败，绝不留下「连上了但元数据不全」的中间态。
 *
 * The data source: the total manager of a preconfigured database connection.
 * `initialize` runs "connect → build/validate metadata → danger switches"
 * serially; any failure fails the whole call and never leaves a
 * "connected but metadata incomplete" intermediate state.
 *
 * @module @veren/orm/runtime/data-source
 */

import { CannotExecuteNotConnectedError, EntityMetadataNotFoundError } from '../errors/index.ts'
import { getDriverDefinition } from '../driver/registry.ts'
import type { Driver } from '../driver/driver.ts'
import type { QueryRunner } from '../driver/query-runner.ts'
import { buildEntityMetadatas } from '../metadata/builder.ts'
import { EntityMetadata } from '../metadata/entity-metadata.ts'
import { isEntitySchema, type EntitySchema } from '../metadata/entity-schema.ts'
import { MigrationExecutor } from '../migration/executor.ts'
import type { Migration, MigrationInterface } from '../migration/migration.ts'
import { DefaultNamingStrategy, type NamingStrategyInterface } from '../naming/naming-strategy.ts'
import { SchemaBuilder } from '../schema/schema-builder.ts'
import type { SqlInMemory } from '../schema/table.ts'
import { createLogger, type Logger } from '../logger/logger.ts'
import type {
  DataSourceOptions,
  EntityTarget,
  IsolationLevel,
  QueryResult,
  TransactionCallback,
} from '../types.ts'
import { EntityManager } from './entity-manager.ts'
import { Repository } from './repository.ts'

/** 数据源生命周期与全部资源的唯一入口。 / The single entry to the data source lifecycle and all resources. */
export class DataSource {
  readonly options: DataSourceOptions
  readonly driver: Driver
  readonly namingStrategy: NamingStrategyInterface
  readonly logger: Logger
  private metadatas: EntityMetadata[] = []
  private targets = new Map<Function, EntityMetadata>()
  private names = new Map<string, EntityMetadata>()
  private cachedManager: EntityManager | undefined
  private initialization: Promise<this> | undefined
  private initialized = false

  constructor(options: DataSourceOptions) {
    this.options = options
    this.driver = getDriverDefinition(options.type).create(options)
    this.namingStrategy = options.namingStrategy ?? new DefaultNamingStrategy()
    this.logger = createLogger(options)
  }

  /** 是否已初始化 / whether initialization completed */
  get isInitialized(): boolean {
    return this.initialized
  }

  /** 全局管理器 / the global entity manager */
  get manager(): EntityManager {
    this.cachedManager ??= new EntityManager(this)
    return this.cachedManager
  }

  /** 构建后的元数据快照 / the built metadata snapshot */
  get entityMetadatas(): readonly EntityMetadata[] {
    return this.metadatas
  }

  /** 初始化唯一入口；幂等且并发安全。 / The single initialize entry; idempotent and concurrency-safe. */
  initialize(): Promise<this> {
    this.initialization ??= this.doInitialize()
    return this.initialization
  }

  /** 反向释放全部资源；重复调用幂等。 / Release everything in reverse; repeated calls are idempotent. */
  async destroy(): Promise<void> {
    await this.driver.destroy()
    this.initialized = false
    this.initialization = undefined
    this.cachedManager = undefined
    this.metadatas = []
    this.targets.clear()
    this.names.clear()
  }

  /** 按类、EntitySchema、名字或元数据查找。 / Look up by class, EntitySchema, name or metadata. */
  getMetadata(target: EntityTarget | EntityMetadata): EntityMetadata {
    if (target instanceof EntityMetadata) return target
    if (isEntitySchema(target)) return this.bySchema(target)
    if (typeof target === 'string') {
      const found = this.names.get(target)
      if (found !== undefined) return found
      throw new EntityMetadataNotFoundError(target)
    }
    const found = this.targets.get(target)
    if (found !== undefined) return found
    throw new EntityMetadataNotFoundError(target.name)
  }

  /** 领取单实体仓储。 / Get a single-entity repository. */
  getRepository<Entity extends object = object>(target: EntityTarget<Entity>): Repository<Entity> {
    return this.manager.getRepository(target)
  }

  /** 发放执行器。 / Hand out a query runner. */
  createQueryRunner(): QueryRunner {
    return this.driver.createQueryRunner()
  }

  /** 原生查询透传。 / Raw query pass-through. */
  query<T = QueryResult>(sql: string, parameters: readonly unknown[] = []): Promise<T> {
    return this.manager.query(sql, parameters) as Promise<T>
  }

  /** 事务透传。 / Transaction pass-through. */
  transaction<T>(run: TransactionCallback<T>): Promise<T>
  transaction<T>(isolation: IsolationLevel, run: TransactionCallback<T>): Promise<T>
  transaction<T>(
    isolationOrRun: IsolationLevel | TransactionCallback<T>,
    maybeRun?: TransactionCallback<T>,
  ): Promise<T> {
    return typeof isolationOrRun === 'function'
      ? this.manager.transaction(isolationOrRun)
      : this.manager.transaction(isolationOrRun, maybeRun!)
  }

  /** 危险开关：删掉全部表。 / Danger switch: drop every table. */
  async dropDatabase(): Promise<void> {
    this.assertInitialized()
    await new SchemaBuilder(this, this.driver).drop()
  }

  /** 模式同步（危险开关）。 / Schema synchronization (a danger switch). */
  async synchronize(): Promise<void> {
    this.assertInitialized()
    await new SchemaBuilder(this, this.driver).build()
  }

  /** 只算不执行；生产安全。 / Compute without executing; safe in production. */
  async schemaLog(): Promise<SqlInMemory> {
    this.assertInitialized()
    return new SchemaBuilder(this, this.driver).log()
  }

  /** 执行全部 pending 迁移。 / Run every pending migration. */
  async runMigrations(): Promise<Migration[]> {
    this.assertInitialized()
    return new MigrationExecutor(this).executePendingMigrations()
  }

  /** 回退最后一条迁移。 / Revert the last migration. */
  async undoLastMigration(): Promise<void> {
    this.assertInitialized()
    await new MigrationExecutor(this).undoLastMigration()
  }

  /** 迁移状态。 / Migration status. */
  async showMigrations(): Promise<Migration[]> {
    this.assertInitialized()
    return new MigrationExecutor(this).showMigrations()
  }

  /** 迁移类清单。 / Declared migration classes. */
  get migrations(): readonly (new () => MigrationInterface)[] {
    return this.options.migrations ?? []
  }

  /** 事件订阅者清单。 / Declared event subscribers. */
  get subscribers(): NonNullable<DataSourceOptions['subscribers']> {
    return this.options.subscribers ?? []
  }

  /** 初始化实现。 / The initialize implementation. */
  private async doInitialize(): Promise<this> {
    try {
      await this.driver.initialize()
      const built = buildEntityMetadatas({
        entities: this.options.entities ?? [],
        namingStrategy: this.namingStrategy,
        entityPrefix: this.options.entityPrefix,
      })
      this.metadatas = built.metadatas
      this.targets = new Map(built.byTarget)
      this.names = new Map(built.byName)
      this.initialized = true
      if (this.options.dropSchema === true) await this.dropDatabase()
      if (this.options.migrationsRun === true) await this.runMigrations()
      if (this.options.synchronize === true) await this.synchronize()
      return this
    } catch (error) {
      await this.driver.destroy().catch(() => undefined)
      this.initialized = false
      this.initialization = undefined
      this.metadatas = []
      this.targets.clear()
      this.names.clear()
      throw error
    }
  }

  /** EntitySchema 查找，失败给出可行动消息。 / EntitySchema lookup with an actionable failure. */
  private bySchema(schema: EntitySchema<object>): EntityMetadata {
    const found = this.names.get(schema.name)
    if (found !== undefined) return found
    throw new EntityMetadataNotFoundError(schema.name)
  }

  /** 未初始化即拒绝数据访问。 / Refuse data access before initialization. */
  private assertInitialized(): void {
    if (!this.initialized) throw new CannotExecuteNotConnectedError()
  }
}
