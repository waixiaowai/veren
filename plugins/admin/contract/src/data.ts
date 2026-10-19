/**
 * The `data` capability port: records, repositories, unit of work, migration.
 *
 * Providers persist through this port only. An adapter may back it with a SQL
 * engine, a document store, or the embedded DSH storage KV; consumers never see
 * which, and never build a query language into business code.
 *
 * `data` 能力端口：记录、仓库、工作单元与迁移。provider 只通过该端口持久化。适配器
 * 背后可以是 SQL 引擎、文档库或内嵌 DSH storage KV；消费方既看不到区别，也不把查询
 * 语言写进业务代码。
 *
 * @module @veren/admin-contract/data
 */

import type { HealthReport } from './index.ts'

/**
 * Minimum identity every stored record carries.
 *
 * IDs are time-ordered strings (UUIDv7/ULID) chosen by the owning provider;
 * records are immutable values and callers must not mutate them in place.
 *
 * 每条存储记录都具备的最小身份。ID 是由所属 provider 选择的时间有序字符串
 * （UUIDv7/ULID）；记录是不可变值，调用方不得就地修改。
 */
export interface AdminEntity {
  /** Stable record id. 稳定的记录 id。 */
  readonly id: string
}

/**
 * Optional capabilities of the selected data engine. The kernel publishes these
 * in the capability catalog so modules can refuse to run on an engine that
 * cannot satisfy them, instead of failing later mid-transaction.
 *
 * 所选数据引擎的可选能力。内核把它们发布到能力目录，模块因此可以拒绝在无法满足的
 * 引擎上运行，而不是等到事务中途才失败。
 */
export interface DataFeatures {
  /** Multi-record atomic transactions. 多记录原子事务。 */
  readonly transactions: boolean
  /** Secondary indexes / queryable non-key fields. 二级索引 / 可查询的非键字段。 */
  readonly secondaryIndexes: boolean
  /** Full-text search. 全文检索。 */
  readonly fullText: boolean
}

/**
 * One typed collection. Reads are synchronous because the adapter keeps
 * validated state in memory; writes resolve after durability.
 *
 * 单个带类型的集合。读取同步返回，因为适配器在内存中保留已校验状态；写入在持久化后
 * 才 resolve。
 */
export interface AdminRepository<T extends AdminEntity> {
  /**
   * Read one record.
   * @param id - record id 记录 id
   * @returns the record, or `undefined` when absent 记录，缺失时为 `undefined`
   */
  find(id: string): T | undefined

  /**
   * Read every record in the collection, unordered.
   * @returns a snapshot array 快照数组
   */
  list(): readonly T[]

  /**
   * Insert or replace one record.
   * @param record - the complete record 完整记录
   * @returns resolution after durability 持久化后的 resolve
   */
  save(record: T): Promise<void>

  /**
   * Delete one record.
   * @param id - record id 记录 id
   * @returns whether the record existed 记录此前是否存在
   */
  remove(id: string): Promise<boolean>
}

/**
 * A collection plus its size. The size is exposed separately because adapters
 * can answer it without materializing the records.
 *
 * 集合及其规模。规模单独暴露，因为适配器无需展开记录即可回答。
 */
export interface AdminTable<T extends AdminEntity> extends AdminRepository<T> {
  /** Current record count. 当前记录数。 */
  readonly size: number
}

/**
 * The transaction boundary handed to `tracked` work. Resolving a table inside a
 * transaction returns the transaction-bound handle rather than the ambient one.
 *
 * 交给事务工作单元的事务边界。事务内解析表返回事务绑定句柄，而非环境句柄。
 */
export interface AdminUnitOfWork {
  /**
   * Resolve one collection by its namespaced name.
   * @param name - collection name such as `admin_users` 形如 `admin_users` 的集合名
   * @returns the collection handle 集合句柄
   */
  table<T extends AdminEntity>(name: string): AdminTable<T>
}

/**
 * The database façade. One deployment selects one primary engine; an adapter
 * that cannot provide an operation reports it in {@link DataFeatures} instead
 * of pretending.
 *
 * 数据库 façade。一个部署只选一个主引擎；无法提供的操作必须记录在
 * {@link DataFeatures} 中，不得假装支持。
 */
export interface AdminDatabase extends AdminUnitOfWork {
  /** Engine capabilities for this deployment. 本部署的引擎能力。 */
  readonly features: DataFeatures

  /**
   * Run work inside one transaction boundary. Adapters without atomic
   * transactions run the work with a documented degraded guarantee and still
   * surface failures to the caller.
   *
   * @param work - the transactional unit of work 事务性工作单元
   * @returns the work's value 工作单元的返回值
   */
  transaction<T>(work: (uow: AdminUnitOfWork) => Promise<T>): Promise<T>

  /**
   * Probe the engine.
   * @returns the health verdict 健康结论
   */
  health(): Promise<HealthReport>
}
