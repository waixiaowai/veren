/**
 * 声明式实体装饰器：全部是「登记参数」的薄壳，不做任何构建期工作。
 * 采用 TypeScript 传统装饰器（`experimentalDecorators`），刻意不依赖
 * reflect-metadata——列类型必须显式声明，环境因此零污染。
 *
 * Declarative entity decorators: thin shells that only register arguments and
 * do no build-time work. They use TypeScript legacy decorators
 * (`experimentalDecorators`) and deliberately avoid reflect-metadata, so column
 * types must be explicit and the environment stays clean.
 *
 * @module @veren/orm/metadata/decorators
 */

import type { ColumnOptions, EntityClass, RelationOptions } from '../types.ts'
import type { GenerationStrategy, RelationType, SpecialColumn } from './args.ts'
import { getMetadataArgsStorage } from './args.ts'

/** 同时兼容类装饰器与属性装饰器的函数形状。 / A shape usable as both a class and a property decorator. */
export type AnyDecorator = (target: object, propertyKey?: string | symbol) => void

/** 实体类装饰器配置。 / Entity class decorator options. */
export interface EntityOptions {
  name?: string
  schema?: string
  database?: string
}

/** 索引装饰器配置。 / Index decorator options. */
export interface IndexDecoratorOptions {
  name?: string
  unique?: boolean
}

/** 反向属性解析器；按属性名读取，任何「取某属性」的箭头函数都可直接传入。 / Inverse-side resolver; reads a property name, so any property-reading arrow works. */
export type InverseSideResolver = (object: { readonly [key: string]: unknown }) => unknown

/** 关系选项中的反向侧。 / The inverse side of a relation option. */
export type InverseSideInput = string | InverseSideResolver

/**
 * `@Entity()` / `@Entity('table')` / `@Entity({ name: 'table' })`。
 * Registers a table declaration; the builder resolves its final name.
 */
export function Entity(nameOrOptions?: string | EntityOptions): (target: Function) => void {
  return (target) => {
    const options = typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions ?? {}
    getMetadataArgsStorage().tables.push({ target, ...options })
  }
}

/** 普通列 / a regular column */
export function Column(options: ColumnOptions = {}): AnyDecorator {
  return (target, propertyKey) => registerColumn(target, propertyKey, options, { primary: false })
}

/** 显式主键列 / an explicit primary column */
export function PrimaryColumn(options: ColumnOptions = {}): AnyDecorator {
  return (target, propertyKey) => registerColumn(target, propertyKey, options, { primary: true })
}

/**
 * 生成主键：缺省自增整数；传 `'uuid'` 或 `{ type: 'uuid' }` 时由库生成 UUID。
 * Generated primary key: increment by default; `'uuid'` or `{ type: 'uuid' }`
 * makes the library generate a UUID.
 */
export function PrimaryGeneratedColumn(
  strategyOrOptions: GenerationStrategy | ColumnOptions = 'increment',
  maybeOptions: ColumnOptions = {},
): AnyDecorator {
  const strategy: GenerationStrategy = typeof strategyOrOptions === 'string' ? strategyOrOptions : 'increment'
  const options = typeof strategyOrOptions === 'string' ? maybeOptions : strategyOrOptions
  const type = options.type ?? (strategy === 'uuid' ? 'uuid' : 'integer')
  return (target, propertyKey) => registerColumn(target, propertyKey, { ...options, type }, {
    primary: true,
    generation: strategy,
  })
}

/** 创建时间列 / creation timestamp column */
export function CreateDateColumn(options: ColumnOptions = {}): AnyDecorator {
  return (target, propertyKey) => registerColumn(target, propertyKey, { type: 'datetime', ...options }, {
    primary: false,
    special: 'createDate',
  })
}

/** 更新时间列 / update timestamp column */
export function UpdateDateColumn(options: ColumnOptions = {}): AnyDecorator {
  return (target, propertyKey) => registerColumn(target, propertyKey, { type: 'datetime', ...options }, {
    primary: false,
    special: 'updateDate',
  })
}

/** 软删时间列 / soft-delete timestamp column */
export function DeleteDateColumn(options: ColumnOptions = {}): AnyDecorator {
  return (target, propertyKey) => registerColumn(target, propertyKey, { type: 'datetime', ...options }, {
    primary: false,
    special: 'deleteDate',
  })
}

/** 乐观锁版本列 / optimistic-lock version column */
export function VersionColumn(options: ColumnOptions = {}): AnyDecorator {
  return (target, propertyKey) => registerColumn(target, propertyKey, { type: 'integer', ...options }, {
    primary: false,
    special: 'version',
  })
}

/** 一对多（非拥有侧）/ one-to-many (inverse side) */
export function OneToMany(
  type: () => EntityClass | string,
  inverseSide?: InverseSideInput,
  options: RelationOptions = {},
): AnyDecorator {
  return relationDecorator('one-to-many', type, inverseSide, options)
}

/** 多对一（拥有侧，落外键列）/ many-to-one (owning side, materializes a foreign key) */
export function ManyToOne(
  type: () => EntityClass | string,
  inverseSide?: InverseSideInput,
  options: RelationOptions = {},
): AnyDecorator {
  return relationDecorator('many-to-one', type, inverseSide, options)
}

/** 一对一 / one-to-one */
export function OneToOne(
  type: () => EntityClass | string,
  inverseSide?: InverseSideInput,
  options: RelationOptions = {},
): AnyDecorator {
  return relationDecorator('one-to-one', type, inverseSide, options)
}

/** 多对多（拥有侧建中间表）/ many-to-many (the owning side creates the junction table) */
export function ManyToMany(
  type: () => EntityClass | string,
  inverseSide?: InverseSideInput,
  options: RelationOptions = {},
): AnyDecorator {
  return relationDecorator('many-to-many', type, inverseSide, options)
}

/** 连接列名与引用列名覆写 / override the join column and referenced column */
export function JoinColumn(options: { name?: string; referencedColumnName?: string } = {}): AnyDecorator {
  return (target, propertyKey) => {
    if (propertyKey === undefined) return
    getMetadataArgsStorage().joinColumns.push({ target: target.constructor, propertyName: String(propertyKey), ...options })
  }
}

/** 多对多中间表覆写 / override the many-to-many junction table */
export function JoinTable(options: { name?: string; joinColumn?: string; inverseJoinColumn?: string } = {}): AnyDecorator {
  return (target, propertyKey) => {
    if (propertyKey === undefined) return
    getMetadataArgsStorage().joinTables.push({ target: target.constructor, propertyName: String(propertyKey), ...options })
  }
}

/** 普通索引；可放在属性上，也可放在类上并给出列清单。 / A regular index on a property or on a class with a column list. */
export function Index(nameOrColumns?: string | readonly string[], options: IndexDecoratorOptions = {}): AnyDecorator {
  return (target, propertyKey) => registerIndex(target, propertyKey, nameOrColumns, { ...options, unique: false })
}

/** 唯一约束 / a unique constraint */
export function Unique(nameOrColumns?: string | readonly string[], options: IndexDecoratorOptions = {}): AnyDecorator {
  return (target, propertyKey) => registerIndex(target, propertyKey, nameOrColumns, { ...options, unique: true })
}

/** 列登记的共享实现。 / Shared column registration. */
function registerColumn(
  target: object,
  propertyKey: string | symbol | undefined,
  options: ColumnOptions,
  extra: { primary: boolean; generation?: GenerationStrategy; special?: SpecialColumn },
): void {
  if (propertyKey === undefined) return
  getMetadataArgsStorage().columns.push({
    target: target.constructor,
    propertyName: String(propertyKey),
    options,
    ...extra,
  })
}

/** 关系登记的共享实现。 / Shared relation registration. */
function relationDecorator(
  relationType: RelationType,
  type: () => EntityClass | string,
  inverseSide: InverseSideInput | undefined,
  options: RelationOptions,
): AnyDecorator {
  return (target, propertyKey) => {
    if (propertyKey === undefined) return
    getMetadataArgsStorage().relations.push({
      target: target.constructor,
      propertyName: String(propertyKey),
      relationType,
      type,
      inverseSide: readInverseSide(inverseSide),
      options,
    })
  }
}

/** 把字符串或「取属性」箭头函数归一为属性名；箭头函数用 Proxy 捕获属性访问。 / Normalize a string or a property-reading arrow into a property name; a Proxy captures the access. */
function readInverseSide(inverseSide: InverseSideInput | undefined): string | undefined {
  if (inverseSide === undefined) return undefined
  if (typeof inverseSide === 'string') return inverseSide
  let accessed: string | undefined
  const probe = new Proxy({}, {
    get: (_target, property) => {
      if (typeof property === 'string') accessed = property
      return undefined
    },
  })
  try {
    inverseSide(probe)
  } catch {
    // 读属性之外的写法无法静态解析；交给构建期报错 / shapes other than a property read stay unresolvable and fail at build time
  }
  return accessed
}

/** 索引与唯一约束的共享实现。 / Shared index/unique registration. */
function registerIndex(
  target: object,
  propertyKey: string | symbol | undefined,
  nameOrColumns: string | readonly string[] | undefined,
  options: IndexDecoratorOptions,
): void {
  const storage = getMetadataArgsStorage()
  const name = typeof nameOrColumns === 'string' ? nameOrColumns : options.name
  if (propertyKey !== undefined) {
    storage.indices.push({ target: target.constructor, propertyName: String(propertyKey), name, unique: options.unique ?? false })
    return
  }
  const columns = Array.isArray(nameOrColumns) ? nameOrColumns : []
  storage.indices.push({ target: target as Function, columns, name, unique: options.unique ?? false })
}
