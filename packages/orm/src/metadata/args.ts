/**
 * 装饰器参数存储：import 时把声明推进全局数组，构建期统一读取。
 * 全局挂载让「同一进程里的两份库副本」共享同一份声明（CLI 与业务代码共存
 * 的关键），构建器不区分声明来自装饰器还是 EntitySchema。
 *
 * Decorator argument storage: declarations land in global arrays at import time
 * and are read once at build time. The global mount lets two copies of the
 * library inside one process share the same declarations (the key to a CLI and
 * business code coexisting); the builder does not care whether a declaration
 * came from a decorator or an EntitySchema.
 *
 * @module @veren/orm/metadata/args
 */

import type { ColumnOptions, EntityClass, RelationOptions } from '../types.ts'

/** 关系方向。 / Relation direction. */
export type RelationType = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'

/** 特殊列角色。 / Special column roles. */
export type SpecialColumn = 'createDate' | 'updateDate' | 'deleteDate' | 'version'

/** 主键生成策略。 / Primary key generation strategy. */
export type GenerationStrategy = 'increment' | 'uuid'

/** 表声明。 / Table declaration. */
export interface TableArgs {
  target: Function
  name?: string
  schema?: string
  database?: string
}

/** 列声明。 / Column declaration. */
export interface ColumnArgs {
  target: Function
  propertyName: string
  options: ColumnOptions
  primary: boolean
  generation?: GenerationStrategy
  special?: SpecialColumn
}

/** 关系声明。 / Relation declaration. */
export interface RelationArgs {
  target: Function
  propertyName: string
  relationType: RelationType
  type: () => EntityClass | string
  inverseSide?: string
  options: RelationOptions
}

/** 连接列声明。 / Join column declaration. */
export interface JoinColumnArgs {
  target: Function
  propertyName: string
  name?: string
  referencedColumnName?: string
}

/** 中间表声明。 / Junction table declaration. */
export interface JoinTableArgs {
  target: Function
  propertyName: string
  name?: string
  joinColumn?: string
  inverseJoinColumn?: string
}

/** 索引或唯一约束声明。 / Index or unique constraint declaration. */
export interface IndexArgs {
  target: Function
  propertyName?: string
  name?: string
  columns?: readonly string[]
  unique: boolean
}

/** 全局参数存储；一次构建只读，不在构建期回写。 / Global argument storage; read-only during one build. */
export class MetadataArgsStorage {
  readonly tables: TableArgs[] = []
  readonly columns: ColumnArgs[] = []
  readonly relations: RelationArgs[] = []
  readonly joinColumns: JoinColumnArgs[] = []
  readonly joinTables: JoinTableArgs[] = []
  readonly indices: IndexArgs[] = []
  readonly uniques: IndexArgs[] = []

  /** 清空全部声明（测试隔离用）。 / Clears every declaration (test isolation). */
  clear(): void {
    this.tables.length = 0
    this.columns.length = 0
    this.relations.length = 0
    this.joinColumns.length = 0
    this.joinTables.length = 0
    this.indices.length = 0
    this.uniques.length = 0
  }
}

/** 全局作用域上的存储位；用固定字符串键做跨副本共享。 / The global slot; a fixed string key shares across copies. */
type GlobalWithStorage = typeof globalThis & { __verenOrmMetadataArgs__?: MetadataArgsStorage }

/**
 * 取得进程级唯一的参数存储（幂等挂载）。
 * Returns the process-wide argument storage, mounting it idempotently.
 */
export function getMetadataArgsStorage(): MetadataArgsStorage {
  const scope = globalThis as GlobalWithStorage
  scope.__verenOrmMetadataArgs__ ??= new MetadataArgsStorage()
  return scope.__verenOrmMetadataArgs__
}
