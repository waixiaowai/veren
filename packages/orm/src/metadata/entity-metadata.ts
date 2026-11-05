/**
 * 构建后的元数据对象图：实体 → 列 / 关系 / 索引，运行期只读快照。
 * 查询、持久化与模式同步都只消费这份图，不再回看声明来源。
 *
 * The built metadata graph: entity → columns / relations / indices, a read-only
 * snapshot at runtime. Query, persistence and schema sync consume only this
 * graph and never look back at the declaration source.
 *
 * @module @veren/orm/metadata/entity-metadata
 */

import type { ColumnOptions, ColumnType, EntityValues, RelationOptions, ValueTransformer } from '../types.ts'
import type { GenerationStrategy } from './args.ts'

/** 一列的完整定义与实体值读写。 / One column's full definition plus entity value access. */
export class ColumnMetadata {
  readonly entityMetadata: EntityMetadata
  readonly propertyName: string
  readonly databaseName: string
  readonly type: ColumnType
  readonly options: ColumnOptions
  readonly isPrimary: boolean
  readonly isGenerated: boolean
  readonly generationStrategy: GenerationStrategy | undefined
  readonly isNullable: boolean
  readonly isCreateDate: boolean
  readonly isUpdateDate: boolean
  readonly isDeleteDate: boolean
  readonly isVersion: boolean
  readonly transformers: readonly ValueTransformer[]

  constructor(entityMetadata: EntityMetadata, input: {
    propertyName: string
    databaseName: string
    type: ColumnType
    options: ColumnOptions
    isPrimary: boolean
    isGenerated?: boolean
    generationStrategy?: GenerationStrategy
    isCreateDate?: boolean
    isUpdateDate?: boolean
    isDeleteDate?: boolean
    isVersion?: boolean
  }) {
    this.entityMetadata = entityMetadata
    this.propertyName = input.propertyName
    this.databaseName = input.databaseName
    this.type = input.type
    this.options = input.options
    this.isPrimary = input.isPrimary
    this.isGenerated = input.isGenerated ?? false
    this.generationStrategy = input.generationStrategy
    this.isNullable = input.options.nullable ?? !input.isPrimary
    this.isCreateDate = input.isCreateDate ?? false
    this.isUpdateDate = input.isUpdateDate ?? false
    this.isDeleteDate = input.isDeleteDate ?? false
    this.isVersion = input.isVersion ?? false
    this.transformers = toTransformerList(input.options.transformer)
  }

  /** 读取实体上的原始值 / read the raw entity value */
  getEntityValue(entity: object): unknown {
    return (entity as EntityValues)[this.propertyName]
  }

  /** 写回实体上的原始值 / write the raw entity value */
  setEntityValue(entity: object, value: unknown): void {
    ;(entity as EntityValues)[this.propertyName] = value
  }

  /** 写入数据库前的值转换 / transform a value on its way into the database */
  preparePersistentValue(value: unknown): unknown {
    return this.transformers.reduce((current, transformer) => transformer.to(current), value)
  }

  /** 读出数据库后的值转换，逆序执行 / transform a value after reading, in reverse */
  prepareHydratedValue(value: unknown): unknown {
    return [...this.transformers].reverse().reduce((current, transformer) => transformer.from(current), value)
  }
}

/** 关系元数据：方向、拥有侧、级联与连接列。 / Relation metadata: direction, owning side, cascade and join columns. */
export class RelationMetadata {
  readonly entityMetadata: EntityMetadata
  readonly relationType: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'
  readonly propertyName: string
  readonly type: () => object | string
  readonly inverseSidePropertyPath: string | undefined
  readonly options: RelationOptions
  readonly hasJoinTable: boolean
  inverseRelation: RelationMetadata | undefined
  /** 构建期解析出的目标元数据 / target metadata resolved during the build */
  targetMetadata: EntityMetadata | undefined
  joinColumns: ColumnMetadata[] = []
  junctionEntityMetadata: EntityMetadata | undefined

  constructor(entityMetadata: EntityMetadata, input: {
    relationType: RelationMetadata['relationType']
    propertyName: string
    type: () => object | string
    inverseSide?: string
    options: RelationOptions
    hasJoinTable?: boolean
  }) {
    this.entityMetadata = entityMetadata
    this.relationType = input.relationType
    this.propertyName = input.propertyName
    this.type = input.type
    this.inverseSidePropertyPath = input.inverseSide
    this.options = input.options
    this.hasJoinTable = input.hasJoinTable ?? false
  }

  /** 外键归属裁决：只有拥有侧产生库内连接列 / foreign-key ownership: only the owning side materializes join columns */
  get isOwning(): boolean {
    if (this.relationType === 'many-to-one') return true
    if (this.relationType === 'one-to-many') return false
    if (this.relationType === 'many-to-many') return this.hasJoinTable || this.inverseSidePropertyPath === undefined
    return this.joinColumns.length > 0 || this.hasJoinTable
  }

  /** 该关系是否登记了某级联动作 / whether a cascade action is registered */
  cascades(action: 'insert' | 'update' | 'remove' | 'soft-remove' | 'recover'): boolean {
    const { cascade } = this.options
    if (cascade === true) return true
    if (cascade === false || cascade === undefined) return false
    return cascade.includes(action)
  }

  /** 关系是否 eager 装载 / whether the relation is eager-loaded */
  get isEager(): boolean {
    return this.options.eager === true
  }
}

/** 索引或唯一约束元数据（存放属性名，执行期映射为列名）。 / Index/unique metadata stores property names and maps to columns at execution time. */
export interface IndexMetadata {
  readonly name: string
  readonly properties: readonly string[]
  readonly unique: boolean
}

/** 单实体的全部静态描述。 / The complete static description of one entity. */
export class EntityMetadata {
  readonly target: Function | undefined
  readonly targetName: string
  readonly tableName: string
  readonly schema: string | undefined
  /** 本体列；构建期填充 / own columns, filled during the build */
  readonly columns: ColumnMetadata[] = []
  /** 主键列；构建期填充 / primary columns, filled during the build */
  readonly primaryColumns: ColumnMetadata[] = []
  /** 本体关系；构建期填充 / own relations, filled during the build */
  readonly relations: RelationMetadata[] = []
  /** 索引与唯一约束；构建期填充 / indices and uniques, filled during the build */
  readonly indices: IndexMetadata[] = []
  readonly uniques: IndexMetadata[] = []

  private columnIndex: ReadonlyMap<string, ColumnMetadata> | undefined
  private relationIndex: ReadonlyMap<string, RelationMetadata> | undefined

  constructor(input: {
    target?: Function
    targetName: string
    tableName: string
    schema?: string
  }) {
    this.target = input.target
    this.targetName = input.targetName
    this.tableName = input.tableName
    this.schema = input.schema
  }

  /** 属性名 → 列（懒建索引，构建完成后即稳定）。 / property → column, indexed lazily and stable after the build. */
  get columnsMap(): ReadonlyMap<string, ColumnMetadata> {
    this.columnIndex ??= new Map(this.columns.map((column) => [column.propertyName, column]))
    return this.columnIndex
  }

  /** 属性名 → 关系（懒建索引）。 / property → relation, indexed lazily. */
  get relationsMap(): ReadonlyMap<string, RelationMetadata> {
    this.relationIndex ??= new Map(this.relations.map((relation) => [relation.propertyName, relation]))
    return this.relationIndex
  }

  /** 主键列（构建期已保证存在）/ the primary column (validated at build time) */
  get primaryColumn(): ColumnMetadata {
    return this.primaryColumns[0]!
  }

  /** 创建时间列 / creation timestamp column */
  get createDateColumn(): ColumnMetadata | undefined {
    return this.columns.find((column) => column.isCreateDate)
  }

  /** 更新时间列 / update timestamp column */
  get updateDateColumn(): ColumnMetadata | undefined {
    return this.columns.find((column) => column.isUpdateDate)
  }

  /** 软删时间列 / soft-delete timestamp column */
  get deleteDateColumn(): ColumnMetadata | undefined {
    return this.columns.find((column) => column.isDeleteDate)
  }

  /** 乐观锁版本列 / optimistic-lock version column */
  get versionColumn(): ColumnMetadata | undefined {
    return this.columns.find((column) => column.isVersion)
  }

  /** 按属性名找列 / find a column by property name */
  findColumn(propertyName: string): ColumnMetadata | undefined {
    return this.columnsMap.get(propertyName)
  }

  /** 按属性名找关系 / find a relation by property name */
  findRelation(propertyName: string): RelationMetadata | undefined {
    return this.relationsMap.get(propertyName)
  }

  /** 按库内列名反查列 / find a column by database name */
  findColumnByDatabaseName(databaseName: string): ColumnMetadata | undefined {
    return this.columns.find((column) => column.databaseName === databaseName)
  }

  /** 由普通对象或类实例创建实体；不写库。 / Create an entity instance without touching the database. */
  create(plain: object = {}): EntityValues {
    const instance: EntityValues = this.target === undefined
      ? {}
      : new (this.target as new () => EntityValues)()
    return Object.assign(instance, plain)
  }
}

/** 把单个或数组转换器统一为只读数组。 / Normalize one transformer or an array into a readonly list. */
function toTransformerList(transformer: ColumnOptions['transformer']): readonly ValueTransformer[] {
  if (transformer === undefined) return []
  return Array.isArray(transformer) ? transformer : [transformer as ValueTransformer]
}
