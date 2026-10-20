/**
 * In-memory stand-in for the PostgreSQL record store.
 *
 * The adapter only consumes {@link RecordStore}, so this double keeps the whole
 * port testable without a database. Transactions snapshot and restore the maps,
 * mimicking a real rollback; a switchable write failure exercises the
 * write-through ordering (database first, mirror second).
 *
 * PostgreSQL 记录存储的内存替身。适配器只消费 {@link RecordStore}，因此该替身让整个
 * 端口无需数据库即可测试。事务通过快照与恢复模拟真实回滚；可切换的写入失败用于检验
 * 写穿顺序（先数据库、后镜像）。
 *
 * @module @veren/admin-data-postgres/tests/fake-store
 */

import type { AdminEntity, HealthReport } from '@veren/admin-contract'
import type { RecordStore, RecordWriter } from '../src/store.ts'

/** One fake store with seeded collections and controllable failures. 带预置集合与可控失败的假存储。 */
export class FakeRecordStore implements RecordStore {
  /** Stored records, keyed by collection then id. 存储记录，先按集合再按 id 索引。 */
  readonly collections = new Map<string, Map<string, AdminEntity>>()

  /** Failure message used by the next writes, when set. 设置后用于后续写入的失败消息。 */
  failWrites: string | undefined

  /** Health detail reported while set; `ok` otherwise. 设置时报告的健康细节；否则为 `ok`。 */
  healthDetail: string | undefined

  /** How many transactions started. 已启动的事务数。 */
  transactions = 0

  /** How many times the pool was closed. 连接池关闭次数。 */
  closes = 0

  /**
   * Seed one collection before the database is built.
   * @param collection - logical collection name 逻辑集合名
   * @param records - records to store 要存储的记录
   */
  seed(collection: string, records: readonly (AdminEntity & Record<string, unknown>)[]): void {
    this.collections.set(collection, new Map(records.map((record) => [record.id, record])))
  }

  /** @returns a copy of every collection 全部集合的副本 */
  async loadAll(): Promise<ReadonlyMap<string, readonly AdminEntity[]>> {
    const loaded = new Map<string, readonly AdminEntity[]>()
    for (const [collection, records] of this.collections) loaded.set(collection, [...records.values()])
    return loaded
  }

  /**
   * @param collection - logical collection name 逻辑集合名
   * @param record - the record to store 要存储的记录
   */
  async upsert(collection: string, record: AdminEntity): Promise<void> {
    this.assertWritable()
    this.collection(collection).set(record.id, record)
  }

  /**
   * @param collection - logical collection name 逻辑集合名
   * @param id - record id 记录 id
   * @returns whether the record existed 记录此前是否存在
   */
  async remove(collection: string, id: string): Promise<boolean> {
    this.assertWritable()
    return this.collections.get(collection)?.delete(id) ?? false
  }

  /**
   * Run work, restoring the pre-transaction state on failure.
   * @param work - writes bound to the transaction 绑定到事务的写入
   * @returns the work's value 工作单元的返回值
   */
  async transaction<T>(work: (writer: RecordWriter) => Promise<T>): Promise<T> {
    this.transactions += 1
    const snapshot = this.snapshot()
    try {
      return await work(this)
    } catch (error) {
      this.restore(snapshot)
      throw error
    }
  }

  /** @returns the health verdict 健康结论 */
  async health(): Promise<HealthReport> {
    return this.healthDetail === undefined ? { status: 'ok' } : { status: 'down', detail: this.healthDetail }
  }

  /** Close the fake pool. 关闭假连接池。 */
  async close(): Promise<void> {
    this.closes += 1
  }

  /** Resolve one collection map, creating it on first write. 解析集合映射，首次写入时创建。 */
  private collection(collection: string): Map<string, AdminEntity> {
    let records = this.collections.get(collection)
    if (records === undefined) {
      records = new Map()
      this.collections.set(collection, records)
    }
    return records
  }

  /** Throw when writes are switched into the failing state. 写入被切换到失败状态时抛出。 */
  private assertWritable(): void {
    if (this.failWrites !== undefined) throw new Error(this.failWrites)
  }

  /** @returns a deep-enough copy of every collection 每个集合的足够深副本 */
  private snapshot(): Map<string, Map<string, AdminEntity>> {
    return new Map([...this.collections].map(([collection, records]) => [collection, new Map(records)]))
  }

  /**
   * Restore a snapshot in place.
   * @param snapshot - the state to restore 要恢复的状态
   */
  private restore(snapshot: Map<string, Map<string, AdminEntity>>): void {
    this.collections.clear()
    for (const [collection, records] of snapshot) this.collections.set(collection, records)
  }
}
