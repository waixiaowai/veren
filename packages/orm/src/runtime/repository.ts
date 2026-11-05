/**
 * 浠撳偍锛氶潰鍚戝崟瀹炰綋鐨勮杽闂ㄩ潰锛屾墍鏈夋柟娉曚竴琛屽鎵樼粰绠＄悊鍣ㄣ€? * 瀹冧笉缂撳瓨缁撴灉銆佷笉鎸佹湁杩炴帴銆佷笉浜?SQL鈥斺€斾簨鍔″唴涓庝簨鍔″鐨勮涓哄洜姝ゅ畬鍏ㄤ竴鑷淬€? *
 * Repository: a thin single-entity facade; every method delegates to the
 * manager in one line. It caches no results, holds no connection and produces
 * no SQL, so behaviour inside and outside a transaction is identical.
 *
 * @module @veren/orm/runtime/repository
 */

import type { EntityMetadata } from '../metadata/entity-metadata.ts'
import type { EntityTarget, EntityValues, FindManyOptions, RemoveOptions, SaveOptions } from '../types.ts'
import type { EntityManager } from './entity-manager.ts'

/** 鍗曞疄浣撲粨鍌ㄣ€?/ A single-entity repository. */
export class Repository<Entity extends object = object> {
  constructor(
    readonly target: EntityTarget<Entity>,
    public manager: EntityManager,
  ) {}

  /** 鐩爣鍏冩暟鎹紙鎳掕В鏋愶級銆?/ Target metadata, resolved lazily. */
  get metadata(): EntityMetadata {
    return this.manager.dataSource.getMetadata(this.target)
  }

  find(options?: FindManyOptions<Entity>): Promise<Entity[]> {
    return this.manager.find(this.target, options) as Promise<Entity[]>
  }

  findBy(where: FindManyOptions<Entity>['where']): Promise<Entity[]> {
    return this.manager.find(this.target, { where }) as Promise<Entity[]>
  }

  findOne(options: FindManyOptions<Entity>): Promise<Entity | undefined> {
    return this.manager.findOne(this.target, { ...options, take: 1 }) as Promise<Entity | undefined>
  }

  findOneBy(where: FindManyOptions<Entity>['where']): Promise<Entity | undefined> {
    return this.manager.findOne(this.target, { where, take: 1 }) as Promise<Entity | undefined>
  }

  findOneOrFail(options: FindManyOptions<Entity>): Promise<Entity> {
    return this.manager.findOneOrFail(this.target, { ...options, take: 1 }) as Promise<Entity>
  }

  findOneByOrFail(where: FindManyOptions<Entity>['where']): Promise<Entity> {
    return this.manager.findOneOrFail(this.target, { where, take: 1 }) as Promise<Entity>
  }

  findAndCount(options?: FindManyOptions<Entity>): Promise<[Entity[], number]> {
    return this.manager.findAndCount(this.target, options) as Promise<[Entity[], number]>
  }

  count(options?: FindManyOptions<Entity>): Promise<number> {
    return this.manager.count(this.target, options)
  }

  exists(options: FindManyOptions<Entity>): Promise<boolean> {
    return this.manager.exists(this.target, options)
  }

  save(entity: Entity, options?: SaveOptions): Promise<Entity>
  save(entities: readonly Entity[], options?: SaveOptions): Promise<Entity[]>
  save(entity: Entity | readonly Entity[], options?: SaveOptions): Promise<Entity | Entity[]> {
    return this.manager.save(this.target, entity, options) as Promise<Entity | Entity[]>
  }

  remove(entity: Entity, options?: RemoveOptions): Promise<Entity>
  remove(entities: readonly Entity[], options?: RemoveOptions): Promise<Entity[]>
  remove(entity: Entity | readonly Entity[], options?: RemoveOptions): Promise<Entity | Entity[]> {
    return this.manager.remove(this.target, entity, options) as Promise<Entity | Entity[]>
  }

  softRemove(entity: Entity, options?: RemoveOptions): Promise<Entity>
  softRemove(entities: readonly Entity[], options?: RemoveOptions): Promise<Entity[]>
  softRemove(entity: Entity | readonly Entity[], options?: RemoveOptions): Promise<Entity | Entity[]> {
    return this.manager.softRemove(this.target, entity, options) as Promise<Entity | Entity[]>
  }

  recover(entity: Entity, options?: RemoveOptions): Promise<Entity>
  recover(entities: readonly Entity[], options?: RemoveOptions): Promise<Entity[]>
  recover(entity: Entity | readonly Entity[], options?: RemoveOptions): Promise<Entity | Entity[]> {
    return this.manager.recover(this.target, entity, options) as Promise<Entity | Entity[]>
  }

  insert(values: EntityValues | readonly EntityValues[]) {
    return this.manager.insert(this.target, values)
  }

  update(criteria: object, values: EntityValues) {
    return this.manager.update(this.target, criteria, values)
  }

  delete(criteria: object) {
    return this.manager.delete(this.target, criteria)
  }

  softDelete(criteria: object) {
    return this.manager.softDelete(this.target, criteria)
  }

  restore(criteria: object) {
    return this.manager.restore(this.target, criteria)
  }

  increment(property: string, value: number, criteria: object) {
    return this.manager.increment(this.target, criteria, property, value)
  }

  decrement(property: string, value: number, criteria: object) {
    return this.manager.decrement(this.target, criteria, property, value)
  }

  clear(): Promise<void> {
    return this.manager.clear(this.target)
  }

  create(plain?: object): EntityValues {
    return this.metadata.create(plain)
  }

  merge(entity: EntityValues, ...plains: object[]): EntityValues {
    return this.manager.merge(this.target, entity, ...plains)
  }

  preload(plain: object): Promise<EntityValues | undefined> {
    return this.manager.preload(this.target, plain)
  }

  hasId(entity: object): boolean {
    return this.metadata.primaryColumns.every((column) => column.getEntityValue(entity) !== undefined)
  }

  getId(entity: object): EntityValues {
    return Object.fromEntries(this.metadata.primaryColumns.map((column) => [column.propertyName, column.getEntityValue(entity)]))
  }

  createQueryBuilder(alias?: string) {
    return this.manager.createQueryBuilder(this.target as EntityTarget, alias)
  }

  query(sql: string, parameters?: readonly unknown[]) {
    return this.manager.query(sql, parameters)
  }

  /** 杩愯鏃舵淳鐢熻嚜瀹氫箟浠撳偍锛涗笉淇敼鍘熷璞°€?/ Derive a custom repository without mutating the original. */
  extend<Custom extends object>(customs: Custom): this & Custom {
    return Object.assign(Object.create(Object.getPrototypeOf(this)) as this, this, customs)
  }
}
