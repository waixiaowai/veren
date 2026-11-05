/**
 * 实体管理器：全部实体的统一操作入口与事务边界实现者。
 * 自身不产 SQL：读走查询构建器，写走持久化管线，两者都在别处。
 *
 * The entity manager: the unified entry for every entity and the transaction
 * boundary itself. It produces no SQL: reads go through the query builder and
 * writes through the persistence pipeline, both defined elsewhere.
 *
 * @module @veren/orm/runtime/entity-manager
 */

import {
  EmptyCriteriaError,
  EntityNotFoundError,
  EntityPropertyNotFoundError,
} from '../errors/index.ts'
import type { QueryRunner } from '../driver/query-runner.ts'
import type { EntityMetadata } from '../metadata/entity-metadata.ts'
import { persistEntities, type PersistMode } from '../persistence/persist.ts'
import { applyWhereClause } from '../query/find-options.ts'
import { InsertQueryBuilder } from '../query/insert-builder.ts'
import { SelectQueryBuilder } from '../query/select-builder.ts'
import { DeleteQueryBuilder, UpdateQueryBuilder } from '../query/update-builder.ts'
import type {
  DeleteResult,
  EntityTarget,
  EntityValues,
  FindManyOptions,
  FindOptionsWhere,
  InsertResult,
  IsolationLevel,
  QueryResult,
  RemoveOptions,
  SaveOptions,
  UpdateResult,
} from '../types.ts'
import type { DataSource } from './data-source.ts'
import { assertCriteria, requireDeleteDateColumn, resolveRelations } from './manager-helpers.ts'
import { runPersist } from './persist-entry.ts'
import { loadRelations } from './relation-loader.ts'
import { Repository } from './repository.ts'

/** 实体管理器；事务内实例绑定事务专属执行器。 / The entity manager; a transactional instance binds the transaction runner. */
export class EntityManager {
  constructor(
    readonly dataSource: DataSource,
    readonly queryRunner?: QueryRunner,
  ) {}

  /** 领取单实体仓储。 / Get a single-entity repository. */
  getRepository<Entity extends object = object>(target: EntityTarget<Entity>): Repository<Entity> {
    return new Repository(target, this)
  }

  /** 把自定义仓储重绑到当前管理器（事务内调用即共享事务）。 / Rebind a custom repository to this manager (shared transaction inside a callback). */
  withRepository<T extends Repository<object>>(repository: T): T {
    repository.manager = this
    return repository
  }

  /** 事务边界：回调返回则提交，抛出则回滚。 / Transaction boundary: commit on return, roll back on throw. */
  async transaction<T>(
    isolationOrRun: IsolationLevel | ((manager: EntityManager) => Promise<T>),
    maybeRun?: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const run = typeof isolationOrRun === 'function' ? isolationOrRun : maybeRun
    if (run === undefined) throw new EmptyCriteriaError('transaction')
    if (this.queryRunner !== undefined) return run(this)
    const runner = this.dataSource.createQueryRunner()
    await runner.connect()
    try {
      await runner.startTransaction(typeof isolationOrRun === 'string' ? isolationOrRun : undefined)
      const transactional = new EntityManager(this.dataSource, runner)
      runner.manager = transactional
      const result = await run(transactional)
      await runner.commitTransaction()
      return result
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      throw error
    } finally {
      await runner.release()
    }
  }

  /** 原生查询；自建执行器必定释放。 / Raw query; a self-created runner is always released. */
  async query(sql: string, parameters: readonly unknown[] = []): Promise<QueryResult> {
    const runner = this.queryRunner ?? this.dataSource.createQueryRunner()
    const ownRunner = this.queryRunner === undefined
    try {
      return await runner.query(sql, parameters)
    } finally {
      if (ownRunner) await runner.release()
    }
  }

  /** 领取 SELECT 构建器。 / Get a SELECT builder. */
  createQueryBuilder<Entity extends object = object>(target: EntityTarget<Entity>, alias?: string): SelectQueryBuilder<Entity> {
    return new SelectQueryBuilder(this.dataSource, this.dataSource.getMetadata(target), this.queryRunner, alias)
  }

  /** 实体级保存（含级联）。 / Entity-level save with cascades. */
  save<Entity extends object>(entity: Entity, options?: SaveOptions): Promise<Entity>
  save<Entity extends object>(entities: readonly Entity[], options?: SaveOptions): Promise<Entity[]>
  save<Entity extends object>(target: EntityTarget<Entity>, entities: Entity | readonly Entity[], options?: SaveOptions): Promise<Entity | Entity[]>
  async save<Entity extends object>(
    first: EntityTarget<Entity> | Entity | readonly Entity[],
    second?: Entity | readonly Entity[] | SaveOptions,
    third?: SaveOptions,
  ): Promise<Entity | Entity[]> {
    return runPersist(this, 'save', first, second, third) as Promise<Entity | Entity[]>
  }

  /** 实体级删除（含级联）。 / Entity-level remove with cascades. */
  async remove<Entity extends object>(
    first: EntityTarget<Entity> | Entity | readonly Entity[],
    second?: Entity | readonly Entity[] | RemoveOptions,
    third?: RemoveOptions,
  ): Promise<Entity | Entity[]> {
    return runPersist(this, 'remove', first, second, third) as Promise<Entity | Entity[]>
  }

  /** 软删（写删除时间列）。 / Soft remove (writes the delete-date column). */
  async softRemove<Entity extends object>(
    first: EntityTarget<Entity> | Entity | readonly Entity[],
    second?: Entity | readonly Entity[] | RemoveOptions,
    third?: RemoveOptions,
  ): Promise<Entity | Entity[]> {
    return runPersist(this, 'soft-remove', first, second, third) as Promise<Entity | Entity[]>
  }

  /** 恢复软删行。 / Recover a soft-removed row. */
  async recover<Entity extends object>(
    first: EntityTarget<Entity> | Entity | readonly Entity[],
    second?: Entity | readonly Entity[] | RemoveOptions,
    third?: RemoveOptions,
  ): Promise<Entity | Entity[]> {
    return runPersist(this, 'recover', first, second, third) as Promise<Entity | Entity[]>
  }

  /** 声明式查询。 / Declarative query. */
  async find<Entity extends object>(target: EntityTarget<Entity>, options: FindManyOptions<Entity> = {}): Promise<EntityValues[]> {
    return this.findByMetadata(this.dataSource.getMetadata(target), options)
  }

  /** 按元数据查询（关系装载内部使用）。 / Query by metadata (used by relation loading). */
  async findByMetadata(metadata: EntityMetadata, options: FindManyOptions<object> = {}): Promise<EntityValues[]> {
    const qb = new SelectQueryBuilder(this.dataSource, metadata, this.queryRunner)
    qb.setFindOptions(options)
    this.applySoftDeleteFilter(qb, metadata, options.withDeleted)
    const entities = await qb.getMany()
    await loadRelations(this, entities, metadata, resolveRelations(metadata, options.relations), options.withDeleted ?? false)
    return entities
  }

  /** 查单个；空结果返回 undefined。 / Find one; empty stays undefined. */
  async findOne<Entity extends object>(target: EntityTarget<Entity>, options: FindManyOptions<Entity> = {}): Promise<EntityValues | undefined> {
    const entities = await this.find(target, { ...options, take: 1 })
    return entities[0]
  }

  /** 查单个；空结果抛 EntityNotFoundError。 / Find one; empty throws EntityNotFoundError. */
  async findOneOrFail<Entity extends object>(target: EntityTarget<Entity>, options: FindManyOptions<Entity> = {}): Promise<EntityValues> {
    const entity = await this.findOne(target, options)
    if (entity === undefined) throw new EntityNotFoundError(this.dataSource.getMetadata(target).targetName, JSON.stringify(options.where ?? {}))
    return entity
  }

  /** 结果与总数。 / Results plus total count. */
  async findAndCount<Entity extends object>(target: EntityTarget<Entity>, options: FindManyOptions<Entity> = {}): Promise<[EntityValues[], number]> {
    return Promise.all([this.find(target, options), this.count(target, options)])
  }

  /** 计数。 / Count. */
  async count<Entity extends object>(target: EntityTarget<Entity>, options: FindManyOptions<Entity> = {}): Promise<number> {
    const metadata = this.dataSource.getMetadata(target)
    const qb = new SelectQueryBuilder(this.dataSource, metadata, this.queryRunner)
    qb.setFindOptions({ ...options, take: undefined, skip: undefined })
    this.applySoftDeleteFilter(qb, metadata, options.withDeleted)
    return qb.getCount()
  }

  /** 是否存在。 / Whether any row exists. */
  async exists<Entity extends object>(target: EntityTarget<Entity>, options: FindManyOptions<Entity> = {}): Promise<boolean> {
    return (await this.count(target, options)) > 0
  }

  /** 快捷插入（无级联、无事件）。 / Quick insert (no cascade, no events). */
  insert(target: EntityTarget, values: EntityValues | readonly EntityValues[]): Promise<InsertResult> {
    const builder = new InsertQueryBuilder(this.dataSource, this.dataSource.getMetadata(target), this.queryRunner)
    return builder.values(values).execute()
  }

  /** 快捷更新（无级联、无事件）。 / Quick update (no cascade, no events). */
  update(target: EntityTarget, criteria: object, values: EntityValues): Promise<UpdateResult> {
    assertCriteria(criteria, 'update')
    const builder = new UpdateQueryBuilder(this.dataSource, this.dataSource.getMetadata(target), this.queryRunner)
    builder.set(values)
    applyWhereClause(builder, criteria)
    return builder.execute()
  }

  /** 快捷删除（无级联、无事件）。 / Quick delete (no cascade, no events). */
  delete(target: EntityTarget, criteria: object): Promise<DeleteResult> {
    assertCriteria(criteria, 'delete')
    const builder = new DeleteQueryBuilder(this.dataSource, this.dataSource.getMetadata(target), this.queryRunner)
    applyWhereClause(builder, criteria)
    return builder.execute()
  }

  /** 快捷软删。 / Quick soft delete. */
  softDelete(target: EntityTarget, criteria: object): Promise<UpdateResult> {
    const metadata = this.dataSource.getMetadata(target)
    const deleteColumn = requireDeleteDateColumn(metadata)
    assertCriteria(criteria, 'softDelete')
    const values: EntityValues = { [deleteColumn.propertyName]: new Date() }
    if (metadata.updateDateColumn !== undefined) values[metadata.updateDateColumn.propertyName] = new Date()
    return this.update(target, criteria, values)
  }

  /** 快捷恢复。 / Quick restore. */
  restore(target: EntityTarget, criteria: object): Promise<UpdateResult> {
    const metadata = this.dataSource.getMetadata(target)
    const deleteColumn = requireDeleteDateColumn(metadata)
    assertCriteria(criteria, 'restore')
    return this.update(target, criteria, { [deleteColumn.propertyName]: null })
  }

  /** 计数递增；表达式内联列名，值走参数。 / Increment; the column is inlined, the value stays a parameter. */
  increment(target: EntityTarget, criteria: object, property: string, value: number): Promise<UpdateResult> {
    return this.incrementBy(target, criteria, property, value)
  }

  /** 计数递减。 / Decrement. */
  decrement(target: EntityTarget, criteria: object, property: string, value: number): Promise<UpdateResult> {
    return this.incrementBy(target, criteria, property, -value)
  }

  /** 清空一张表（显式 1 = 1，绕过空条件防护）。 / Clear a table (explicit 1 = 1, bypassing the empty-criteria guard). */
  async clear(target: EntityTarget): Promise<void> {
    const builder = new DeleteQueryBuilder(this.dataSource, this.dataSource.getMetadata(target), this.queryRunner)
    builder.where('1 = 1')
    await builder.execute()
  }

  /** 创建实体实例；不写库。 / Create an entity instance without writing. */
  create<Entity extends object>(target: EntityTarget<Entity>, plain: object = {}): EntityValues {
    return this.dataSource.getMetadata(target).create(plain)
  }

  /** 合并普通对象到实体。 / Merge plain objects into an entity. */
  merge<Entity extends object>(target: EntityTarget<Entity>, entity: EntityValues, ...plains: object[]): EntityValues {
    return Object.assign(entity, ...plains)
  }

  /** 预载：按主键读出现有行再合并；不存在返回 undefined。 / Preload: read the row by primary key and merge; undefined when absent. */
  async preload<Entity extends object>(target: EntityTarget<Entity>, plain: object): Promise<EntityValues | undefined> {
    const metadata = this.dataSource.getMetadata(target)
    const criteria: EntityValues = {}
    for (const column of metadata.primaryColumns) {
      const value = (plain as EntityValues)[column.propertyName]
      if (value !== undefined) criteria[column.propertyName] = value
    }
    if (Object.keys(criteria).length === 0) return metadata.create(plain)
    const existing = await this.findOne(target, { where: criteria as FindOptionsWhere<Entity> })
    return existing === undefined ? undefined : Object.assign(existing, plain)
  }

  /** 递增/递减共享实现。 / Shared increment/decrement implementation. */
  private incrementBy(target: EntityTarget, criteria: object, property: string, value: number): Promise<UpdateResult> {
    assertCriteria(criteria, 'increment')
    const metadata = this.dataSource.getMetadata(target)
    const column = metadata.findColumn(property)
    if (column === undefined) throw new EntityPropertyNotFoundError(property, metadata.targetName)
    const builder = new UpdateQueryBuilder(this.dataSource, metadata, this.queryRunner)
    const parameter = builder.addParameter(value, 'inc')
    builder.setExpression(property, `${builder.escape(column.databaseName)} + :${parameter}`)
    applyWhereClause(builder, criteria)
    return builder.execute()
  }

  /** 软删过滤：未开启 withDeleted 时排除已删行。 / Soft-delete filter unless withDeleted is on. */
  private applySoftDeleteFilter(qb: SelectQueryBuilder, metadata: EntityMetadata, withDeleted?: boolean): void {
    const column = metadata.deleteDateColumn
    if (column === undefined || withDeleted === true) return
    qb.andWhere(`${qb.escape(qb.alias)}.${qb.escape(column.databaseName)} IS NULL`)
  }


}
