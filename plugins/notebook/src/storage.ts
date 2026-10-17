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
import type { NoteRecord } from './types.ts'

const noteSchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

/**
 * Authoritative notebook storage.
 *
 * A row that fails its schema rejects opening the whole domain rather than
 * being dropped: a silently discarded note is a note the owner believes exists.
 * 权威记事本存储。某一行不合 schema 会让整个域打开失败，而不是被丢弃：悄悄消失的笔记，在
 * 主人看来仍然存在。
 */
export const notebookDomain = defineDomain({
  name: 'notebook',
  version: 1,
  tables: {
    notes: domainTable<string, NoteRecord>(noteSchema),
  },
})

/** Storage domain name, shared with diagnostics. */
export const NOTEBOOK_DOMAIN_NAME = notebookDomain.name

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
