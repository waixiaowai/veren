/**
 * @veren/orm 适配器：把统一适配契约落到 DataSource/EntityManager 上。
 * 一致性语义在此生效——update 空条件或零命中返回 null（决策 1）；
 * consumeOne/incrementOne 走快照守卫原语（决策 2/3）；事务内回调绑定
 * 事务专属执行器。存储域不解释字段业务含义（决策 5）。
 *
 * The @veren/orm adapter: lands the unified adapter contract on
 * DataSource/EntityManager. Consistency semantics live here — update returns
 * null on empty where or zero match (decision 1); consumeOne/incrementOne go
 * through the snapshot-guard primitives (decisions 2/3); transaction
 * callbacks bind the transactional manager. No business interpretation
 * (decision 5).
 *
 * @module @veren/auth-core/storage/orm-adapter
 */

import { randomUUID } from 'node:crypto'
import type { DataSource, EntityManager } from '@veren/orm'
import type { DBAdapter, DBSchema, Where } from './adapter.ts'
import { atomicConsumeOne, atomicIncrementOne } from './orm-atomic.ts'
import { toCriteria } from './orm-where.ts'

/** 判定条件集为空（拒绝执行的空谓词）。 / Whether the clause set is empty (a refused empty predicate). */
function isEmptyWhere(where: readonly Where[] | undefined): boolean {
  return where === undefined || where.length === 0
}

/** 生成的行 id：调用方未指定时由适配器生成。 / The generated row id, minted when the caller omits it. */
function newId(): string {
  return randomUUID()
}

/** 适配器实现：一个管理器一个实例，事务内换管理器。 / The adapter body: one instance per manager, swapped inside transactions. */
class OrmAdapterBody {
  constructor(
    private readonly manager: EntityManager,
    private readonly tables: DBSchema,
  ) {}

  async create<R = Record<string, unknown>>(data: {
    model: string
    data: Record<string, unknown>
    forceAllowId?: boolean
  }): Promise<R> {
    const row: Record<string, unknown> = { ...(data.data as Record<string, unknown>) }
    this.applyDefaults(data.model, row)
    // 未声明 forceAllowId 时调用方给定的 id 被忽略，适配器自行生成（决策 1 的镜像语义）。
    // Without forceAllowId the caller-supplied id is ignored; the adapter mints one.
    if (data.forceAllowId !== true || row.id === undefined) row.id = newId()
    await this.manager.insert(data.model, row)
    const saved = await this.manager.findOne(data.model, { where: { id: row.id as string } })
    return saved as R
  }

  async findOne<T>(data: { model: string, where: Where[] }): Promise<T | null> {
    const row = await this.manager.findOne(data.model, { where: toCriteria(data.where) as never })
    return (row ?? null) as T | null
  }

  async findMany<T>(data: {
    model: string
    where?: Where[]
    limit?: number
    offset?: number
    sortBy?: { field: string, direction: 'asc' | 'desc' }
  }): Promise<T[]> {
    const rows = await this.manager.find(data.model, {
      where: toCriteria(data.where) as never,
      take: data.limit,
      skip: data.offset,
      order: data.sortBy === undefined ? undefined : { [data.sortBy.field]: data.sortBy.direction === 'desc' ? 'DESC' : 'ASC' },
    })
    return rows as T[]
  }

  async count(data: { model: string, where?: Where[] }): Promise<number> {
    return this.manager.count(data.model, { where: toCriteria(data.where) as never })
  }

  async update<T>(data: { model: string, where: Where[], update: Record<string, unknown> }): Promise<T | null> {
    const affected = await this.updateRows(data.model, data.where, data.update)
    if (affected === 0) return null
    return this.findOne<T>({ model: data.model, where: data.where })
  }

  async updateMany(data: { model: string, where: Where[], update: Record<string, unknown> }): Promise<number> {
    return this.updateRows(data.model, data.where, data.update)
  }

  async delete(data: { model: string, where: Where[] }): Promise<void> {
    if (isEmptyWhere(data.where)) return
    await this.manager.delete(data.model, toCriteria(data.where) as never)
  }

  async deleteMany(data: { model: string, where: Where[] }): Promise<number> {
    if (isEmptyWhere(data.where)) return 0
    const result = await this.manager.delete(data.model, toCriteria(data.where) as never)
    return result.affected ?? 0
  }

  async consumeOne<T>(data: { model: string, where: Where[] }): Promise<T | null> {
    return atomicConsumeOne<T>(this, data)
  }

  async incrementOne<T>(data: {
    model: string
    where: Where[]
    increment: Record<string, number>
    set?: Record<string, unknown>
  }): Promise<T | null> {
    return atomicIncrementOne<T>(this, data)
  }

  async transaction<R>(callback: (trx: DBAdapter) => Promise<R>): Promise<R> {
    return this.manager.transaction(async (transactional) => callback(asAdapter(new OrmAdapterBody(transactional, this.tables))))
  }

  /** 写入前补默认值：模型 defaultValue 惰性求值（§8.2 字段变换）。 / Fill defaults before insert: lazy model defaultValues (§8.2 field transform). */
  private applyDefaults(model: string, row: Record<string, unknown>): void {
    const fields = this.tables[model]?.fields ?? {}
    for (const [field, attribute] of Object.entries(fields)) {
      if (row[field] !== undefined) continue
      const value = attribute.defaultValue
      if (value === undefined) continue
      row[field] = typeof value === 'function' ? value() : value
    }
  }

  /** 更新执行：空谓词拒绝执行（决策 1）；onUpdate 字段重算。 / Run the update: refuse empty predicates (decision 1); onUpdate fields recompute. */
  private async updateRows(model: string, where: readonly Where[], update: Record<string, unknown>): Promise<number> {
    if (isEmptyWhere(where)) return 0
    const fields = this.tables[model]?.fields ?? {}
    for (const [field, attribute] of Object.entries(fields)) {
      if (attribute.onUpdate !== undefined && update[field] === undefined) update[field] = attribute.onUpdate()
    }
    const result = await this.manager.update(model, toCriteria(where) as never, update)
    return result.affected ?? 0
  }
}

/**
 * 创建 ORM 适配器。`dataSource` 须已 `initialize()` 且实体集由
 * {@link createAuthEntities} 注册，模型名即实体名。
 * / Create the ORM adapter. `dataSource` must be `initialize()`d with the
 * entities from {@link createAuthEntities}; model names are entity names.
 */
export function createOrmAdapter(dataSource: DataSource, tables: DBSchema): DBAdapter {
  return asAdapter(new OrmAdapterBody(dataSource.manager, tables))
}


/** 把适配器实现包装为契约面。 / Wrap the adapter body as the contract face. */
function asAdapter(body: OrmAdapterBody): DBAdapter {
  return {
    id: 'orm',
    create: (data) => body.create(data),
    findOne: (data) => body.findOne(data),
    findMany: (data) => body.findMany(data),
    count: (data) => body.count(data),
    update: (data) => body.update(data),
    updateMany: (data) => body.updateMany(data),
    delete: (data) => body.delete(data),
    deleteMany: (data) => body.deleteMany(data),
    consumeOne: (data) => body.consumeOne(data),
    incrementOne: (data) => body.incrementOne(data),
    transaction: (callback) => body.transaction(callback),
  }
}
