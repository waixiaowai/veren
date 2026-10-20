/**
 * The `data` capability port implemented over PostgreSQL.
 *
 * The port's reads are synchronous, so the adapter keeps a write-through
 * mirror: `loadAll()` seeds it once, every committed write updates it, and
 * `find`/`list`/`size` answer from memory. Writes reach PostgreSQL first; the
 * mirror changes only after the database accepted them, so a failed write or a
 * rolled-back transaction never leaves a record visible that the database does
 * not hold.
 *
 * Transactions run on one database connection and write into an overlay layer.
 * Work inside the transaction reads its own uncommitted writes through the
 * overlay, while readers outside it keep seeing the committed mirror; the
 * overlay is folded into the mirror only after `COMMIT`.
 *
 * 基于 PostgreSQL 的 `data` 能力端口。端口读取是同步的，因此适配器维护一份写穿镜像：
 * `loadAll()` 装载一次，每次提交的写入更新它，`find`/`list`/`size` 直接由内存作答。
 * 写入先到达 PostgreSQL，只有数据库接受后镜像才变化，因此失败的写入或回滚的事务绝不
 * 会让数据库里不存在的记录可见。
 *
 * 事务在一条数据库连接上执行并写入 overlay 层。事务内的工作通过 overlay 读到自己的
 * 未提交写入，事务外的读取仍看到已提交镜像；只有 `COMMIT` 之后 overlay 才并入镜像。
 *
 * @module @veren/admin-data-postgres/adapter
 */

import {
  AdminError,
  type AdminDatabase,
  type AdminEntity,
  type AdminTable,
  type AdminUnitOfWork,
  type DataFeatures,
  type HealthReport,
} from '@veren/admin-contract'
import type { RecordStore, RecordWriter } from './store.ts'

/**
 * Capabilities this engine provides. `secondaryIndexes` stays `false` because
 * the port exposes no ad-hoc query: the created indexes serve operators and
 * future SQL consumers, not a module-facing query surface.
 *
 * 本引擎提供的能力。`secondaryIndexes` 保持 `false`，因为端口没有暴露临时查询：已建
 * 索引服务运维人员与未来的 SQL 消费方，而不是面向模块的查询面。
 */
export const POSTGRES_FEATURES: DataFeatures = {
  transactions: true,
  secondaryIndexes: false,
  fullText: false,
}

/** One collection's committed records, keyed by id. 单个集合已提交的记录，按 id 索引。 */
type Mirror = Map<string, Map<string, AdminEntity>>

/** One transaction's pending changes; `null` marks a pending delete. 单个事务的待定变更；`null` 表示待删除。 */
type Overlay = Map<string, Map<string, AdminEntity | null>>

/** Options of {@link createPostgresDatabase}. {@link createPostgresDatabase} 的选项。 */
export interface CreatePostgresDatabaseOptions {
  /** The record store owning the connection and the durable schema. 拥有连接与持久 schema 的记录存储。 */
  readonly store: RecordStore
}

/**
 * Build the `data` capability over a record store, seeding the mirror first.
 *
 * @param options - the record store 记录存储
 * @returns the database façade over that store 该存储上的数据库 façade
 */
export async function createPostgresDatabase(options: CreatePostgresDatabaseOptions): Promise<AdminDatabase> {
  const { store } = options
  const mirror = toMirror(await store.loadAll())
  let queue: Promise<void> = Promise.resolve()
  const database: AdminDatabase = {
    features: POSTGRES_FEATURES,
    table: <T extends AdminEntity>(collection: string): AdminTable<T> => baseTable<T>(store, mirror, collection),
    // Transactions are serialized against each other: one connection and one
    // queue keep lock order deterministic and bound pool usage to one slot.
    // 事务之间串行：一条连接与一个队列让加锁顺序确定，并把连接池占用限制在一个槽位。
    transaction: <T>(work: (uow: AdminUnitOfWork) => Promise<T>): Promise<T> => {
      const run = queue.then(async () => {
        const overlay: Overlay = new Map()
        const value = await store.transaction(async (writer) => work({
          table: <U extends AdminEntity>(collection: string): AdminTable<U> =>
            transactionTable<U>(writer, mirror, overlay, collection),
        }))
        applyOverlay(mirror, overlay)
        return value
      })
      queue = run.then(noop, noop)
      return run
    },
    health: (): Promise<HealthReport> => store.health(),
  }
  return database
}

/** Read and write operations one table handle delegates to. 表句柄委派的读写操作。 */
interface TableOperations {
  readonly find: (id: string) => AdminEntity | undefined
  readonly list: () => readonly AdminEntity[]
  readonly size: () => number
  readonly save: (record: AdminEntity) => Promise<void>
  readonly remove: (id: string) => Promise<boolean>
}

/**
 * Build the ambient table of one collection.
 *
 * @param store - the record store 记录存储
 * @param mirror - the committed mirror 已提交镜像
 * @param collection - logical collection name 逻辑集合名
 * @returns the table handle 表句柄
 */
function baseTable<T extends AdminEntity>(store: RecordStore, mirror: Mirror, collection: string): AdminTable<T> {
  return createTable<T>(collection, {
    find: (id) => mirror.get(collection)?.get(id),
    list: () => [...(mirror.get(collection)?.values() ?? [])],
    size: () => mirror.get(collection)?.size ?? 0,
    save: async (record) => {
      await store.upsert(collection, record)
      ensureCollection(mirror, collection).set(record.id, record)
    },
    remove: async (id) => {
      const existed = await store.remove(collection, id)
      if (existed) mirror.get(collection)?.delete(id)
      return existed
    },
  })
}

/**
 * Build the transaction-bound table of one collection, reading through the
 * overlay so the work sees its own uncommitted writes.
 *
 * @param writer - writes bound to the transaction 绑定到事务的写入
 * @param mirror - the committed mirror 已提交镜像
 * @param overlay - the transaction's pending changes 事务的待定变更
 * @param collection - logical collection name 逻辑集合名
 * @returns the table handle 表句柄
 */
function transactionTable<T extends AdminEntity>(
  writer: RecordWriter,
  mirror: Mirror,
  overlay: Overlay,
  collection: string,
): AdminTable<T> {
  return createTable<T>(collection, {
    find: (id) => readThrough(mirror, overlay, collection, id),
    list: () => listThrough(mirror, overlay, collection),
    size: () => listThrough(mirror, overlay, collection).length,
    save: async (record) => {
      await writer.upsert(collection, record)
      ensureOverlay(overlay, collection).set(record.id, record)
    },
    remove: async (id) => {
      const existed = await writer.remove(collection, id)
      ensureOverlay(overlay, collection).set(id, null)
      return existed
    },
  })
}

/**
 * Wrap the operations in the typed table interface, validating identity once.
 *
 * @param collection - logical collection name 逻辑集合名
 * @param operations - the delegated operations 委派操作
 * @returns the table handle 表句柄
 */
function createTable<T extends AdminEntity>(collection: string, operations: TableOperations): AdminTable<T> {
  return {
    find: (id: string): T | undefined => operations.find(id) as T | undefined,
    list: (): readonly T[] => operations.list() as readonly T[],
    save: async (record: T): Promise<void> => {
      assertRecordId(record, collection)
      await operations.save(record)
    },
    remove: (id: string): Promise<boolean> => operations.remove(id),
    get size(): number {
      return operations.size()
    },
  }
}

/**
 * Read one record through the overlay.
 *
 * @param mirror - the committed mirror 已提交镜像
 * @param overlay - the transaction's pending changes 事务的待定变更
 * @param collection - logical collection name 逻辑集合名
 * @param id - record id 记录 id
 * @returns the record, or `undefined` when absent 记录；缺失为 `undefined`
 */
function readThrough(mirror: Mirror, overlay: Overlay, collection: string, id: string): AdminEntity | undefined {
  const changes = overlay.get(collection)
  if (changes?.has(id) === true) return changes.get(id) ?? undefined
  return mirror.get(collection)?.get(id)
}

/**
 * Materialize one collection through the overlay.
 *
 * Committed order is preserved; ids added by the transaction append at the end.
 *
 * 按 overlay 物化一个集合。已提交顺序保留；事务新增的 id 追加在末尾。
 *
 * @param mirror - the committed mirror 已提交镜像
 * @param overlay - the transaction's pending changes 事务的待定变更
 * @param collection - logical collection name 逻辑集合名
 * @returns the merged snapshot 合并后的快照
 */
function listThrough(mirror: Mirror, overlay: Overlay, collection: string): readonly AdminEntity[] {
  const merged = new Map<string, AdminEntity>(mirror.get(collection) ?? [])
  for (const [id, record] of overlay.get(collection) ?? []) {
    if (record === null) merged.delete(id)
    else merged.set(id, record)
  }
  return [...merged.values()]
}

/**
 * Fold a committed overlay into the mirror.
 *
 * @param mirror - the committed mirror 已提交镜像
 * @param overlay - the transaction's pending changes 事务的待定变更
 */
function applyOverlay(mirror: Mirror, overlay: Overlay): void {
  for (const [collection, changes] of overlay) {
    for (const [id, record] of changes) {
      const records = ensureCollection(mirror, collection)
      if (record === null) records.delete(id)
      else records.set(id, record)
    }
  }
}

/**
 * Resolve one collection map, creating it on first write.
 *
 * @param mirror - the committed mirror 已提交镜像
 * @param collection - logical collection name 逻辑集合名
 * @returns the mutable collection map 可变集合映射
 */
function ensureCollection(mirror: Mirror, collection: string): Map<string, AdminEntity> {
  let records = mirror.get(collection)
  if (records === undefined) {
    records = new Map()
    mirror.set(collection, records)
  }
  return records
}

/**
 * Resolve one overlay collection map, creating it on first change.
 *
 * @param overlay - the transaction's pending changes 事务的待定变更
 * @param collection - logical collection name 逻辑集合名
 * @returns the mutable overlay map 可变 overlay 映射
 */
function ensureOverlay(overlay: Overlay, collection: string): Map<string, AdminEntity | null> {
  let changes = overlay.get(collection)
  if (changes === undefined) {
    changes = new Map()
    overlay.set(collection, changes)
  }
  return changes
}

/**
 * Copy the loaded snapshot into a mutable mirror. 把已加载快照复制为可变镜像。
 * @param loaded - records grouped by collection 按集合分组的记录
 * @returns the mutable mirror 可变镜像
 */
function toMirror(loaded: ReadonlyMap<string, readonly AdminEntity[]>): Mirror {
  const mirror: Mirror = new Map()
  for (const [collection, records] of loaded) {
    mirror.set(collection, new Map(records.map((record) => [record.id, record])))
  }
  return mirror
}

/**
 * Reject a save whose record carries no string identity, as unparsed JSON can.
 *
 * @param record - the record handed to `save` 传给 `save` 的记录
 * @param collection - collection name used in the message 消息中使用的集合名
 * @throws AdminError `VALIDATION_FAILED` when `id` is missing or not a string
 */
function assertRecordId(record: AdminEntity, collection: string): void {
  const id: unknown = record.id
  if (typeof id !== 'string') {
    throw new AdminError('VALIDATION_FAILED', `record in collection '${collection}' must carry a string 'id'`, {
      collection,
    })
  }
}

/** Settle a chain link without forwarding its outcome. 结算链节且不转发其结果。 */
function noop(): void {}
