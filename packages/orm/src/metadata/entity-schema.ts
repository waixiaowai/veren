/**
 * EntitySchema：无装饰器场景的声明式实体载体。
 * 与装饰器共享同一条构建管线——构建器只消费归一后的参数，不区分来源。
 *
 * EntitySchema: the declarative entity carrier for decorator-free code. It
 * shares the single build pipeline with decorators — the builder consumes
 * normalized arguments and does not care where they came from.
 *
 * @module @veren/orm/metadata/entity-schema
 */

import type { ColumnOptions, ColumnType, EntityClass, RelationOptions } from '../types.ts'
import type { RelationType } from './args.ts'

/** 声明式列配置：类型必填，其余与装饰器选项一致。 / Declarative column options: type is required. */
export interface EntitySchemaColumnOptions extends ColumnOptions {
  type: ColumnType
}

/** 声明式关系配置。 / Declarative relation options. */
export interface EntitySchemaRelationOptions extends RelationOptions {
  /** 关系方向 / relation direction */
  type: RelationType
  /** 目标实体类、名字或惰性求值函数 / target class, name or lazy resolver */
  target: string | EntityClass | (() => EntityClass | string)
  /** 反向属性路径 / inverse property path */
  inverseSide?: string
  /** 拥有侧外键列名 / owning FK column name */
  joinColumn?: string
  /** 外键引用的目标列属性名 / referenced target property */
  referencedColumnName?: string
  /** 多对多中间表名 / many-to-many junction table name */
  joinTableName?: string
  /** 中间表的本侧列名 / junction column for this side */
  joinTableColumn?: string
  /** 中间表的对侧列名 / junction column for the other side */
  inverseJoinTableColumn?: string
}

/** 声明式索引或唯一约束。 / Declarative index or unique constraint. */
export interface EntitySchemaIndexOptions {
  name?: string
  columns: readonly string[]
  unique?: boolean
}

/** 实体模式配置。 / Entity schema configuration. */
export interface EntitySchemaOptions<Entity extends object = object> {
  /** 实体名（同时作为默认表名来源）/ entity name, also the default table-name source */
  name: string
  /** 显式表名 / explicit table name */
  tableName?: string
  /** 可选实体类，供 create() 与仓储返回类型使用 / optional runtime class */
  target?: EntityClass<Entity>
  /** 列声明：每个属性一个选项 / column declarations, one option per property */
  columns: { [P in keyof Entity]?: EntitySchemaColumnOptions }
  /** 关系声明 / relation declarations */
  relations?: { [P in keyof Entity]?: EntitySchemaRelationOptions }
  /** 索引 / indices */
  indices?: readonly EntitySchemaIndexOptions[]
  /** 唯一约束 / unique constraints */
  uniques?: readonly EntitySchemaIndexOptions[]
}

/**
 * 声明式实体；构造即冻结配置，运行期只读。
 * A declarative entity; the configuration is frozen at construction and read
 * only afterwards.
 */
export class EntitySchema<Entity extends object = object> {
  readonly options: EntitySchemaOptions<Entity>

  constructor(options: EntitySchemaOptions<Entity>) {
    this.options = options
  }

  /** 实体名 / entity name */
  get name(): string {
    return this.options.name
  }

  /** 可选运行时类 / optional runtime class */
  get target(): EntityClass<Entity> | undefined {
    return this.options.target
  }

  /** 最终表名（未应用命名策略前缀）/ declared table name before prefixing */
  get tableName(): string | undefined {
    return this.options.tableName
  }
}

/** 判断一个值是否为 EntitySchema。 / Whether a value is an EntitySchema. */
export function isEntitySchema(value: unknown): value is EntitySchema<object> {
  return value instanceof EntitySchema
}
