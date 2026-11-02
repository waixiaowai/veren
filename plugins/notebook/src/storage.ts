/**
 * Durable notebook data: the one storage domain every write goes through.
 *
 * The domain routes to the profile's default storage backend, so notes land
 * under `$DSH_HOME/storages` and survive restarting the Harness, closing the
 * browser, and deleting a project directory. There is exactly one table: a note
 * is a self-contained record keyed by owner plus note id.
 *
 * 持久化的记事本数据：所有写入都经过的唯一存储域。
 *
 * 域走 profile 的默认存储后端，因此笔记落在 `$DSH_HOME/storages` 下，重启 Harness、关闭浏览器、
 * 删掉项目目录都不会丢。只有一张表：一条笔记就是一条自包含记录，键由归属与笔记 id 组成。
 *
 * @module @veren/notebook/storage
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { LinkRecord, NoteRecord } from './types.ts'

const noteSchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

const linkSchema = z.object({
  owner: z.string().min(1),
  sourceId: z.string().min(1),
  targetTitle: z.string().min(1),
})

/**
 * The domain's global slot: when the links cache was last rebuilt from bodies.
 * A v1 medium has none stored, so the initial `0` triggers the one-time rebuild
 * on the first v2 open; later opens skip it. 槽值记录链接缓存最近一次从正文重建的域版本。v1 介质没有存储过，初始 `0` 让首次 v2 打开
 * 触发一次性重建；之后的打开直接跳过。
 */
const globalSchema = z.object({ linksSyncedAt: z.number() })

/**
 * Authoritative notebook storage: the same version-1 medium the 2.x plugin
 * wrote, extended in place.
 *
 * The notes table keeps its exact v1 shape and keys (a v1 row is already a
 * valid card, and a v1 medium opens natively — no medium migration exists or
 * is needed). The derived `links` cache joins as a second table and the
 * global `linksSyncedAt` marker joins as the singleton slot; the single
 * layout stays because the owner-embedding key (`owner/id`) is the privacy
 * contract, and the per-record layout demands path-safe file names no owner
 * id can promise.
 *
 * A row that fails its schema rejects opening the whole domain rather than
 * being dropped: a silently discarded note is a note the owner believes
 * exists.
 *
 * 权威记事本存储：与 2.x 插件所写相同的 version-1 介质，原位扩展。
 *
 * notes 表保持 v1 的精确形状与键（一行 v1 记录本就是合法卡片，v1 介质原生打开——不存在
 * 也不需要介质迁移）。派生的 `links` 缓存作为第二张表加入，全局 `linksSyncedAt` 标记作为
 * 单例槽加入；单布局保持不变，因为内嵌归属的键（`owner/id`）就是隐私契约本身，而按记录
 * 布局要求路径安全的文件名，任何归属 id 都无法承诺这一点。
 *
 * 某一行不合 schema 会让整个域打开失败，而不是被丢弃：悄悄消失的笔记，在主人看来仍然存在。
 */
export const notebookDomain = defineDomain({
  name: 'notebook',
  version: 1,
  global: { schema: globalSchema, initial: { linksSyncedAt: 0 } },
  tables: {
    notes: domainTable<string, NoteRecord>(noteSchema),
    links: domainTable<string, LinkRecord>(linkSchema),
  },
})

/** Storage domain name, shared with diagnostics. */
export const NOTEBOOK_DOMAIN_NAME = notebookDomain.name

/** Current domain version; the global `linksSyncedAt` marker is compared against it. 当前域版本；全局 `linksSyncedAt` 标记与它比较。 */
export const NOTEBOOK_DOMAIN_VERSION = notebookDomain.version

/** One opened notebook domain. */
export type NotebookStore = Domain<typeof notebookDomain>

/**
 * Synchronous view over the notes table.
 *
 * These four methods are the only things the operation helpers need, which
 * keeps them free of re-derived generic parameters.
 * 笔记表的同步视图。操作辅助函数只需要这四个方法，因此不必重复推导泛型参数。
 */
export interface NotebookTable<T> {
  /** Read one row by key. */
  readonly get: (key: string) => T | undefined
  /** Insert or overwrite one row and wait for backend durability. */
  readonly put: (key: string, value: T) => Promise<void>
  /** Remove one row; resolves to whether it existed. */
  readonly del: (key: string) => Promise<boolean>
  /** Read every row of the table as a stable snapshot. */
  readonly all: () => T[]
}

/**
 * Project one domain table onto {@link NotebookTable}.
 * @param table - the opened table handle.
 * @returns the four-method view the operation helpers consume.
 */
export function view<T>(table: KvTable<string, T>): NotebookTable<T> {
  return {
    get: key => table.get(key),
    put: (key, value) => table.put(key, value),
    del: key => table.delete(key),
    all: () => [...table.entries()].map(([, value]) => value),
  }
}
