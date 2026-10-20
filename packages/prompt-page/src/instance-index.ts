/**
 * PageInstanceIndex 的持久化实现 / persistent implementation of PageInstanceIndex
 *
 * 索引本体在这里，与存储介质解耦：构造时注入一个最小 KV 端口
 * （get/put/del/all，语义与仓库既有 storageDomain 的 `KvTable` 一致）。
 * 插件侧（page-registry）用 `app-pages` 存储域提供该端口；测试用内存 map。
 * 行是自包含 JSON 记录，进程重启后原样读回：URL 仍指向最新的活会话，废弃
 * 历史行保留可查（§3.5.4）。
 *
 * The index lives here, decoupled from the medium: a minimal kv port is
 * injected (get/put/del/all, the same shape as the repo's storageDomain
 * `KvTable`). The page-registry plugin backs it with the `app-pages` storage
 * domain; tests use an in-memory map. Rows survive restarts: a url still
 * points at its latest live session, and deprecated history rows stay
 * readable (§3.5.4).
 *
 * @module @veren/prompt-page/instance-index
 */
import { PageError, PageErrorCode } from './contract.ts'
import type { InstanceSnapshot, PageInstanceIndex, PageInstanceKey, PageInstanceRecord } from './contract.ts'

/** 最小 KV 端口（与 storageDomain 的 KvTable 同形）/ minimal kv port (same shape as KvTable) */
export interface InstanceKvPort {
  /** 按键读一行 / read one row by key */
  readonly get: (key: string) => PageInstanceRecord | undefined
  /** 写一行并等待介质落盘 / upsert one row and await durability */
  readonly put: (key: string, value: PageInstanceRecord) => Promise<void>
  /** 删一行；返回是否存在 / remove one row; resolves to whether it existed */
  readonly del: (key: string) => Promise<boolean>
  /** 全表快照 / a stable snapshot of every row */
  readonly all: () => PageInstanceRecord[]
}

/** 索引可选项 / index options */
export interface KvPageInstanceIndexOptions {
  /** 时钟（测试注入）/ clock, injectable for tests */
  readonly now?: () => string
  /**
   * 会话存活探测：索引行指向的会话被删除时，行失效并按缺失处理（§3.5.4）。
   * 缺省不做探测（纯存储行为）。/ liveness probe; when it returns false for a
   * live row, the row is forgotten and the url reads as a miss.
   */
  readonly sessionExists?: (sessionId: string) => boolean | Promise<boolean>
}

/** 用快照 + 键拼一条 reserved 行 / build a reserved row from a snapshot */
function reservedRow(
  url: PageInstanceKey,
  sessionId: string,
  snapshot: InstanceSnapshot,
  now: string,
): PageInstanceRecord {
  return {
    url,
    state: 'reserved',
    appId: snapshot.appId,
    page: snapshot.page,
    sessionId,
    instanceTitle: snapshot.instanceTitle,
    pageRevision: snapshot.pageRevision,
    params: snapshot.params,
    appVersion: snapshot.appVersion,
    createdAt: now,
    lastOpenedAt: now,
  }
}

/** 废弃历史行的键：`deprecated:<sessionId>`（规范 URL 以 `/` 开头，不相交）
 * / history key of a deprecated row: `deprecated:<sessionId>` (canonical urls start with `/`) */
export function deprecatedRowKey(sessionId: string): string {
  return `deprecated:${sessionId}`
}

/**
 * KV 背书的页面实例索引。所有写操作串行（FIFO），避免并发 reserve 双写；
 * 唯一约束：url 唯一、sessionId 唯一（§3.5.2）。
 * 行存放：URL 键只有一行（当前指针，reserved/live）；废弃行挪到
 * `deprecated:<sessionId>` 历史键（规范 URL 以 `/` 开头，键空间不相交）。
 * The kv-backed instance index. Writes are serialized FIFO; url and sessionId
 * are both unique. Row placement: one url-keyed row (the current pointer,
 * reserved/live); deprecated rows move to the `deprecated:<sessionId>` history
 * key (canonical urls start with `/`, so the key spaces never collide).
 */
export class KvPageInstanceIndex implements PageInstanceIndex {
  private readonly now: () => string
  private readonly sessionExists?: (sessionId: string) => boolean | Promise<boolean>
  private chain: Promise<unknown> = Promise.resolve()

  /**
   * @param table - 持久 KV 端口 / the durable kv port
   * @param options - 时钟与会话探测 / clock and liveness probe
   */
  constructor(private readonly table: InstanceKvPort, options: KvPageInstanceIndexOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.sessionExists = options.sessionExists
  }

  async lookup(url: PageInstanceKey): Promise<PageInstanceRecord | undefined> {
    const row = this.table.get(url)
    if (row === undefined) return undefined
    // 只有 live 行做存活探测；reserved 行的会话可能还没建成，不算失效
    if (row.state !== 'live' || this.sessionExists === undefined) return row
    const alive = await this.sessionExists(row.sessionId)
    if (alive) return row
    await this.forget(url) // 会话已被删除：忘掉这一行，下次打开重建
    return undefined
  }

  async reserve(url: PageInstanceKey, sessionId: string, snapshot: InstanceSnapshot): Promise<PageInstanceRecord> {
    return this.write(async () => {
      if (this.table.get(url) !== undefined) {
        throw new PageError(PageErrorCode.IndexConflict, `instance index already has a row for ${url}`)
      }
      if (this.table.all().some((row) => row.sessionId === sessionId)) {
        throw new PageError(PageErrorCode.IndexConflict, `instance index: session ${sessionId} is already bound to another url`)
      }
      const row = reservedRow(url, sessionId, snapshot, this.now())
      await this.table.put(url, row)
      return row
    })
  }

  async commit(url: PageInstanceKey, sessionId: string): Promise<PageInstanceRecord> {
    return this.write(async () => {
      const row = this.table.get(url)
      if (row === undefined || row.state !== 'reserved' || row.sessionId !== sessionId) {
        throw new PageError(PageErrorCode.IndexConflict, `cannot commit ${url}: no reserved row for session ${sessionId}`)
      }
      const live: PageInstanceRecord = { ...row, state: 'live', lastOpenedAt: this.now() }
      await this.table.put(url, live)
      return live
    })
  }

/**
 * 把当前行标废弃并挪进历史键，腾出 URL（§3.5.3 的"写废弃标记"一步）。
 * 写链内执行：与 reserve/commit 串行，腾出 URL 后 reserve 不会再撞
 * `page/index-conflict`。无行（含已被 forget）时返回 undefined。
 * Deprecate the current row into its history key, freeing the url (the
 * "write the deprecated marker" step of §3.5.3). Runs on the write chain, so
 * a following reserve cannot hit `page/index-conflict`. Returns undefined
 * when there is no row (including after a forget).
 */
  async deprecate(url: PageInstanceKey, _reason: string): Promise<PageInstanceRecord | undefined> {
    return this.write(async () => {
      const row = this.table.get(url)
      if (row === undefined) return undefined
      const deprecated: PageInstanceRecord = { ...row, state: 'deprecated', deprecatedAt: this.now() }
      await this.table.put(deprecatedRowKey(row.sessionId), deprecated)
      await this.table.del(url)
      return deprecated
    })
  }

  async fail(url: PageInstanceKey, reason: string): Promise<void> {
    await this.write(async () => {
      const row = this.table.get(url)
      // 只清 reserved 行；live 行不是创建失败的产物，不动
      if (row === undefined || row.state !== 'reserved') return
      const existed = await this.table.del(url)
      if (!existed) throw new PageError(PageErrorCode.IndexUnavailable, `fail(${url}, ${reason}): row vanished mid-flight`)
    })
  }

  async forget(url: PageInstanceKey): Promise<void> {
    await this.write(() => this.table.del(url).then(() => undefined))
  }

  async listByApp(appId: string): Promise<readonly PageInstanceRecord[]> {
    return this.table.all().filter((row) => row.appId === appId)
  }

  /**
   * 启动清扫（§3.5.3/§7.5）：reserved 行是两阶段创建的崩溃遗迹。配了会话
   * 存活探测时，探测为假的 reserved 行直接删除；没配探测就不动任何行——
   * "确认没有对应会话后删除"里的确认做不了，就不假装做了。
   * Startup sweep: drop reserved rows whose backing session is gone, but only
   * when a liveness probe is configured — without one we cannot confirm, so we
   * refuse to pretend.
   */
  async sweepReserved(): Promise<readonly PageInstanceKey[]> {
    return this.write(async () => {
      if (this.sessionExists === undefined) return []
      const dropped: PageInstanceKey[] = []
      for (const row of this.table.all()) {
        if (row.state !== 'reserved') continue
        if (await this.sessionExists(row.sessionId)) continue
        await this.table.del(row.url)
        dropped.push(row.url)
      }
      return dropped
    })
  }

  /** 逐个写串行，保持 FIFO（与 notebook 的写链同型）/ serialize writes FIFO */
  private write<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.chain.then(work)
    this.chain = pending.catch(() => undefined)
    return pending
  }
}
