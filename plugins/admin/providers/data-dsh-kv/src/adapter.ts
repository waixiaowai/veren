/**
 * The `data` capability port implemented over one DSH storage-domain table.
 *
 * Every capability record lives at key `${collection}:${id}` inside the single
 * `records` table; a repository is a collection prefix over that key space, so
 * adding a capability needs no schema change and no migration. Reads are
 * synchronous because the domain handle keeps validated state in memory;
 * writes resolve after the domain reports durability.
 *
 * 基于单个 DSH storage-domain 表实现的 `data` 能力端口。每条能力记录位于唯一
 * `records` 表中的 `${collection}:${id}` 键上；仓库就是该键空间上的一个集合前缀，
 * 因此新增能力既不需要 schema 变更，也不需要迁移。读取同步返回，因为 domain 句柄在
 * 内存中保留已校验状态；写入在 domain 报告持久化后 resolve。
 *
 * @module @veren/admin-data-dsh-kv/adapter
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
import type { RecordsTableName } from './domain.ts'

/** Separator between collection name and record id in one key. 键内集合名与记录 id 的分隔符。 */
export const KEY_SEPARATOR = ':'

/**
 * One table handle exactly as this adapter consumes it: the structural subset
 * of `KvTable` the domain runtime exposes. Keeping it minimal is what lets a
 * test pass a `Map`-backed double while the real domain handle is accepted
 * unchanged.
 *
 * 本适配器实际消费的表句柄：它是 domain 运行时 `KvTable` 的结构子集。保持最小面
 * 正是“测试可用 `Map` 支撑的替身、真实 domain 句柄可原样传入”的原因。
 */
export interface KvTableHandle {
  /**
   * Read one record.
   * @param key - composite record key 复合记录键
   * @returns the stored record, or `undefined` when absent 存储记录；缺失为 `undefined`
   */
  get(key: string): AdminEntity | undefined

  /**
   * Insert or replace one record.
   * @param key - composite record key 复合记录键
   * @param value - the complete record 完整记录
   * @returns resolution after durability 持久化后的 resolve
   */
  put(key: string, value: AdminEntity): Promise<void>

  /**
   * Delete one record.
   * @param key - composite record key 复合记录键
   * @returns whether the record existed 记录此前是否存在
   */
  delete(key: string): Promise<boolean>

  /**
   * Snapshot iterator over every key in the table. 表内全部键的快照迭代器。
   * @returns the key iterator 键迭代器
   */
  keys(): IterableIterator<string>

  /** Current record count across every collection. 跨全部集合的当前记录数。 */
  readonly size: number
}

/**
 * One domain handle exactly as this adapter consumes it. 本适配器实际消费的 domain 句柄。
 */
export interface KvDomainHandle {
  /**
   * Resolve the records table.
   * @param name - the only declared table name 唯一声明的表名
   * @returns its handle 表句柄
   */
  table(name: RecordsTableName): KvTableHandle
}

/** Options of {@link createKvDatabase}. {@link createKvDatabase} 的选项。 */
export interface CreateKvDatabaseOptions {
  /** The opened domain handle owning the `records` table. 拥有 `records` 表的已打开 domain 句柄。 */
  readonly domain: KvDomainHandle
}

/** Capabilities this engine does not provide. 本引擎不提供的能力。 */
export const DATA_FEATURES: DataFeatures = {
  transactions: false,
  secondaryIndexes: false,
  fullText: false,
}

/** Key of one record inside the records table. 记录在 records 表中的键。 */
export function recordKey(collection: string, id: string): string {
  return `${collection}${KEY_SEPARATOR}${id}`
}

/** Key prefix owning every record of one collection. 拥有单个集合全部记录的键前缀。 */
export function collectionPrefix(collection: string): string {
  return `${collection}${KEY_SEPARATOR}`
}

/**
 * Build the `data` capability over one storage-domain handle.
 *
 * @param options - the opened domain handle 已打开的 domain 句柄
 * @returns the database façade over that handle 该句柄上的数据库 façade
 */
export function createKvDatabase(options: CreateKvDatabaseOptions): AdminDatabase {
  const records = options.domain.table('records')
  let queue: Promise<void> = Promise.resolve()
  const database: AdminDatabase = {
    features: DATA_FEATURES,
    table: <T extends AdminEntity>(collection: string): AdminTable<T> => createTable<T>(records, collection),
    // Degraded transaction: the work is serialized against other transactions
    // but never rolled back — failures surface to the caller and already
    // written records stay written (KV reconciliation path, see README).
    // 降级事务：工作单元与其他事务串行，但绝不回滚——失败原样上报调用方，已写入的
    // 记录保持写入状态（KV 对账路径，见 README）。
    transaction: <T>(work: (uow: AdminUnitOfWork) => Promise<T>): Promise<T> => {
      const run = queue.then(() => work(database))
      queue = run.then(noop, noop)
      return run
    },
    health: async (): Promise<HealthReport> => probe(records),
  }
  return database
}

/**
 * Build one collection repository over the records table.
 *
 * @param records - the records table handle records 表句柄
 * @param collection - collection name owning the prefix 拥有该前缀的集合名
 * @returns the table handle 表句柄
 */
function createTable<T extends AdminEntity>(records: KvTableHandle, collection: string): AdminTable<T> {
  const prefix = collectionPrefix(collection)
  return {
    find: (id: string): T | undefined => readRecord<T>(records, recordKey(collection, id)),
    // A scan over the whole table: the KV has no secondary index, so every
    // list filters the full key space by prefix.
    // 全表扫描：KV 没有二级索引，因此每次 list 都按前缀过滤整个键空间。
    list: (): readonly T[] => scanRecords<T>(records, prefix),
    save: async (record: T): Promise<void> => {
      assertRecordId(record, collection)
      await records.put(recordKey(collection, record.id), record)
    },
    remove: async (id: string): Promise<boolean> => records.delete(recordKey(collection, id)),
    get size(): number {
      return countRecords(records, prefix)
    },
  }
}

/**
 * Read one record, narrowing the durable value to the requested entity.
 *
 * @param records - the records table handle records 表句柄
 * @param key - composite record key 复合记录键
 * @returns the record, or `undefined` when absent 记录；缺失为 `undefined`
 */
function readRecord<T extends AdminEntity>(records: KvTableHandle, key: string): T | undefined {
  const stored = records.get(key)
  return stored === undefined ? undefined : stored as T
}

/**
 * Collect every record of one collection, unordered.
 *
 * @param records - the records table handle records 表句柄
 * @param prefix - collection key prefix 集合键前缀
 * @returns the snapshot array 快照数组
 */
function scanRecords<T extends AdminEntity>(records: KvTableHandle, prefix: string): readonly T[] {
  const found: T[] = []
  for (const key of records.keys()) {
    if (!key.startsWith(prefix)) continue
    const stored = records.get(key)
    if (stored !== undefined) found.push(stored as T)
  }
  return found
}

/**
 * Count the records of one collection without materializing them.
 *
 * @param records - the records table handle records 表句柄
 * @param prefix - collection key prefix 集合键前缀
 * @returns the record count 记录数
 */
function countRecords(records: KvTableHandle, prefix: string): number {
  let total = 0
  for (const key of records.keys()) if (key.startsWith(prefix)) total += 1
  return total
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

/**
 * Probe the handle, turning a throwing handle into a `down` verdict.
 *
 * @param records - the records table handle records 表句柄
 * @returns the health verdict 健康结论
 */
async function probe(records: KvTableHandle): Promise<HealthReport> {
  try {
    void records.size
    return { status: 'ok' }
  } catch (error) {
    return { status: 'down', detail: error instanceof Error ? error.message : String(error) }
  }
}

/** Settle a chain link without forwarding its outcome. 结算链节且不转发其结果。 */
function noop(): void {}
