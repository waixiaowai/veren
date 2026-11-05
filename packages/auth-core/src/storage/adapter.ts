/**
 * 存储域统一适配契约（设计文档 modules/08-storage.md §8.3）。
 * 存储域只认「模型名 + 字段名 + 条件」，保证三类操作的一致性语义：
 * 单行更新命中零行返回 null（决策 1）、一次性凭据原子消费（决策 2）、
 * 带守卫的原子增量（决策 3）。它不解释任何字段的业务含义（决策 5）。
 *
 * The storage adapter contract (design modules/08-storage.md §8.3). The
 * storage domain only knows "model + field + where" and owns three
 * consistency semantics: single-row update returns null on zero match
 * (decision 1), atomic consume of one-time credentials (decision 2), and
 * guarded atomic increment (decision 3). It never interprets business field
 * meaning (decision 5).
 *
 * @module @veren/auth-core/storage/adapter
 */

/** 条件操作符全集（11 项）。 / The full where-operator set (11 items). */
export const whereOperators = [
  'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'not_in',
  'contains', 'starts_with', 'ends_with',
] as const

/** 条件操作符类型。 / The where operator union. */
export type WhereOperator = (typeof whereOperators)[number]

/** 条件子句。 / One where clause. */
export interface Where {
  /** 操作符，默认 eq。 / Operator, default `eq`. */
  operator?: WhereOperator
  /** 比较值。 / The comparison value. */
  value: string | number | boolean | string[] | number[] | Date | null
  /** 逻辑字段名。 / The logical field name. */
  field: string
  /** 连接符，默认 AND。 / Connector, default `AND`. */
  connector?: 'AND' | 'OR'
  /** 字符串比较模式，默认 sensitive。 / String comparison mode, default `sensitive`. */
  mode?: 'sensitive' | 'insensitive'
}

/** 条件规范化后的形态（操作符与连接符已补全）。 / A normalized where clause (operator and connector filled). */
export interface CleanedWhere {
  operator: WhereOperator
  value: Where['value']
  field: string
  connector: 'AND' | 'OR'
  mode: 'sensitive' | 'insensitive'
}

/** 字段类型全集。 / The field type union. */
export type DBFieldType =
  | 'string' | 'number' | 'boolean' | 'date'

/** 字段属性：存储域唯一认识的字段元数据面。 / Field attributes: the only field metadata the storage domain knows. */
export interface DBFieldAttribute {
  /** 逻辑类型。 / The logical type. */
  type: DBFieldType
  /** 写入时必填，默认 true。 / Required on write, default true. */
  required?: boolean
  /** 可出现在响应，默认 true；false 为永不外泄。 / Returned in responses, default true. */
  returned?: boolean
  /** 外部可写入，默认 true；false 为服务端专属。 / Writable from input, default true. */
  input?: boolean
  /** 默认值或惰性求值。 / Default value or lazy producer. */
  defaultValue?: string | number | boolean | null | (() => string | number | boolean | Date | null)
  /** 更新时重算（如 updatedAt）。 / Recomputed on update (e.g. `updatedAt`). */
  onUpdate?: () => string | number | boolean | Date | null
  /** 外键引用。 / Foreign-key reference. */
  references?: { model: string, field: string, onDelete?: 'cascade' | 'set null' | 'restrict' }
  /** 唯一约束。 / Unique constraint. */
  unique?: boolean
  /** 建索引。 / Index the column. */
  index?: boolean
  /** 物理列名覆盖。 / Physical column-name override. */
  fieldName?: string
  /** 可排序。 / Sortable. */
  sortable?: boolean
}

/** 表级索引。 / A table-level index. */
export interface DBTableIndex {
  /** 1–16 个逻辑字段，按索引顺序。 / 1–16 logical fields in index order. */
  fields: readonly [string, ...string[]]
  /** 索引名（至多 63 字节）。 / Index name (63 bytes at most). */
  name?: string
  /** 唯一索引。 / Unique index. */
  unique?: boolean
}

/** 表模型：模型名 → 物理表名 + 字段属性 + 索引。 / A table model: model name → physical table + fields + indexes. */
export interface DBTableModel {
  /** 物理表名。 / The physical table name. */
  modelName: string
  /** 字段属性面。 / The field-attribute map. */
  fields: Record<string, DBFieldAttribute>
  /** 表级索引。 / Table-level indexes. */
  indexes?: readonly DBTableIndex[]
  /** 不参与迁移。 / Exclude from migrations. */
  disableMigrations?: boolean
  /** 装配顺序。 / Assembly order. */
  order?: number
}

/** 表模型全集。 / The whole table-model map. */
export type DBSchema = Record<string, DBTableModel>

/** 排序方向。 / Sort direction. */
export type SortDirection = 'asc' | 'desc'

/**
 * 统一适配契约。`update` 命中零行返回 null；空条件返回 null；
 * `consumeOne` 原子消费恰一行；`incrementOne` 以 where 兼作守卫。
 * / The unified adapter contract. `update` returns null on zero match;
 * empty where returns null; `consumeOne` atomically consumes exactly one
 * row; `incrementOne` guards with its own where.
 */
export interface DBAdapter {
  /** 适配器标识。 / The adapter id. */
  readonly id: string
  /** 写入一行；data.id 默认忽略，forceAllowId 强制采用。 / Create a row; data.id is ignored unless forceAllowId. */
  create<R = Record<string, unknown>>(data: {
    model: string
    data: Record<string, unknown>
    forceAllowId?: boolean
  }): Promise<R>
  /** 读单行。 / Read one row. */
  findOne<T>(data: { model: string, where: Where[] }): Promise<T | null>
  /** 读多行。 / Read many rows. */
  findMany<T>(data: {
    model: string
    where?: Where[]
    limit?: number
    offset?: number
    sortBy?: { field: string, direction: SortDirection }
  }): Promise<T[]>
  /** 计数。 / Count rows. */
  count(data: { model: string, where?: Where[] }): Promise<number>
  /** 单行更新；命中零行或空条件返回 null（决策 1）。 / Update one row; null on zero match or empty where (decision 1). */
  update<T>(data: { model: string, where: Where[], update: Record<string, unknown> }): Promise<T | null>
  /** 批量更新；返回受影响行数。 / Update many; returns the affected count. */
  updateMany(data: { model: string, where: Where[], update: Record<string, unknown> }): Promise<number>
  /** 删除。 / Delete rows. */
  delete(data: { model: string, where: Where[] }): Promise<void>
  /** 批量删除并返回受影响行数。 / Delete many; returns the affected count. */
  deleteMany(data: { model: string, where: Where[] }): Promise<number>
  /** 原子消费单行；并发下只有一方拿到行（决策 2）。 / Atomically consume one row; concurrency yields one winner (decision 2). */
  consumeOne<T>(data: { model: string, where: Where[] }): Promise<T | null>
  /** 原子带守卫增量；守卫未命中返回 null，竞争耗尽抛错（决策 3）。 / Guarded atomic increment; null on guard miss, throws on contention (decision 3). */
  incrementOne<T>(data: {
    model: string
    where: Where[]
    increment: Record<string, number>
    set?: Record<string, unknown>
  }): Promise<T | null>
  /** 事务入口。 / The transaction entry. */
  transaction<R>(callback: (trx: DBAdapter) => Promise<R>): Promise<R>
}
