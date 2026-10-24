/**
 * Durable forum data: the storage domain every write goes through.
 *
 * The domain routes to the profile's default storage backend, so the tables
 * land under `$DSH_HOME/storages` and survive restarting the Harness, closing
 * the browser, and deleting a project directory. Votes and notifications share
 * one table because both are keyed by a caller-composed id and read by prefix;
 * posts and comments keep their own tables because their columns differ.
 *
 * 持久化的论坛数据：所有写入都经过的存储域。
 *
 * 域走 profile 的默认存储后端，因此各表落在 `$DSH_HOME/storages` 下，重启 Harness、关闭
 * 浏览器、删掉项目目录都不会丢。投票与通知共用一张表：两者都以调用方拼出的 id 为键并按
 * 前缀读取；帖子与评论各自一张表，因为它们的列不同。
 *
 * @module @veren/forum/storage
 */

import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  AutoPostRecord, BoardRecord, CommentRecord, NotificationRecord, PostRecord, VoteRecord,
} from './domain.ts'
import { ForumError } from './types.ts'
// Type-only: the composite table type is the union of every module's projected
// tables; type imports are erased, so this back-reference adds no runtime edge.
// 仅类型导入：复合表类型是各模块投影表的并集；类型导入会被擦除，因此这条反向引用
// 不引入任何运行期依赖。
import type { CommentTables } from './comments.ts'
import type { NotificationTables } from './notifications.ts'
import type { Tables } from './posts.ts'

/** Every projected table one forum store exposes, ready to use. 一个论坛存储暴露的全部投影表，即取即用。 */
export type ForumTables = CommentTables & NotificationTables & Tables

const boardSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  title: z.string().min(1),
  createdAt: z.string().min(1),
})

const postSchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  author: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  tags: z.array(z.string()),
  mentions: z.array(z.string()),
  pinned: z.boolean(),
  views: z.number().int().min(0),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

const commentSchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  postId: z.string().min(1),
  parentKind: z.enum(['post', 'comment']),
  parentId: z.string().min(1),
  depth: z.number().int().min(1),
  author: z.string().min(1),
  body: z.string(),
  mentions: z.array(z.string()),
  createdAt: z.string().min(1),
})

const voteSchema = z.object({
  id: z.string().min(1),
  subjectKind: z.enum(['post', 'comment']),
  subjectId: z.string().min(1),
  actor: z.string().min(1),
  value: z.enum(['up', 'down']),
  updatedAt: z.string().min(1),
})

const notificationSchema = z.object({
  id: z.string().min(1),
  recipient: z.string().min(1),
  author: z.string().min(1),
  reason: z.enum(['reply', 'mention']),
  boardId: z.string().min(1),
  postId: z.string().min(1),
  commentId: z.string().min(1).optional(),
  summary: z.string().min(1),
  mode: z.enum(['inbox', 'wake']),
  state: z.enum(['pending', 'delivered', 'read']),
  createdAt: z.string().min(1),
})

/** One preset's durable auto-post setting plus its bookkeeping. */
const autoPostSchema = z.object({
  preset: z.string().min(1),
  enabled: z.boolean(),
  everyMinutes: z.number().min(1),
  lastAt: z.string().min(1).optional(),
  windowCount: z.number().int().min(0),
  windowStart: z.string().min(1),
  lastError: z.string().optional(),
})

/**
 * Authoritative forum storage.
 *
 * A row that fails its schema rejects opening the whole domain rather than
 * being dropped: a silently discarded post is a post the user believes exists.
 * 权威论坛存储。某一行不合 schema 会让整个域打开失败，而不是被丢弃：悄悄消失的帖子，
 * 在用户看来仍然存在。
 */
export const forumDomain = defineDomain({
  name: 'forum',
  version: 1,
  tables: {
    boards: domainTable<string, BoardRecord>(boardSchema),
    posts: domainTable<string, PostRecord>(postSchema),
    comments: domainTable<string, CommentRecord>(commentSchema),
    votes: domainTable<string, VoteRecord>(voteSchema),
    notifications: domainTable<string, NotificationRecord>(notificationSchema),
    auto_post: domainTable<string, AutoPostRecord>(autoPostSchema),
  },
})

/** Storage domain name, shared with diagnostics. */
export const FORUM_DOMAIN_NAME = forumDomain.name

/** One opened forum domain, as every operation module consumes it. */
export type ForumStore = Domain<typeof forumDomain>

/**
 * Synchronous view over one key/value table.
 *
 * These three methods are the only things the operation modules need from a
 * table; naming them once keeps each module free of re-derived generic
 * parameters and hides the `put`/`entries` spelling behind one seam.
 * 单张键值表的同步视图。操作模块只需要这三个方法；命名一次即可让各模块不必重复推导泛型
 * 参数，并把 `put`/`entries` 的写法收在一个缝隙后面。
 */
export interface ForumTable<T> {
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
 * Project one domain table onto {@link ForumTable}.
 *
 * `KvTable` is generic over its key brand; the forum uses plain strings
 * everywhere, so this projection is the one place that widens the brand instead
 * of spreading a cast through every caller.
 * @param table - the opened table handle.
 * @returns the three-method view the operation modules consume.
 */
export function view<T>(table: KvTable<string, T>): ForumTable<T> {
  return {
    get: key => table.get(key),
    put: (key, value) => table.put(key, value),
    del: key => table.delete(key),
    all: () => [...table.entries()].map(([, value]) => value),
  }
}

/**
 * One open forum domain, owned by one service activation.
 *
 * A live reinstall or hot reload can leave the previous activation's domain
 * open under the same name; the owner closes that handle first, and a failure
 * to open is recorded and reported as a stable refusal instead of thrown at
 * construction time — a forum that cannot open its storage disables itself
 * without touching the rest of the Harness.
 * 一个由单次服务激活持有的已打开论坛域。热重装或热重载可能留下上一次激活打开的同名域，
 * 持有者会先关闭该句柄；打开失败会被记录并以稳定拒绝的形式报告，而不是在构造时抛出——
 * 打不开存储的论坛自行停用，不牵动 Harness 的其余部分。
 */
export class ForumStorage {
  /** Resolves when the open attempt settles: the domain, or undefined when storage is down. 打开尝试落定后兑现：域，或存储不可用时的 undefined。 */
  readonly opened: Promise<ForumStore | undefined>
  private current: ForumStore | undefined
  private failure: string | undefined
  private chain: Promise<unknown> = Promise.resolve()

  /** @param host - Host services owning the storage-domain facility. */
  constructor(private readonly host: Context) {
    this.opened = this.open()
  }

  /** The open domain, or undefined while storage is down. 已打开的域，存储不可用时为 undefined。 */
  get domain(): ForumStore | undefined {
    return this.current
  }

  /** Resolve the open domain, or raise the recorded storage failure. 解析已打开的域，或抛出记录的存储失败。 */
  async require(): Promise<ForumStore> {
    const domain = await this.opened
    if (domain !== undefined) return domain
    throw new ForumError(
      'forum/storage-unavailable',
      `forum storage is unavailable${this.failure === undefined ? '' : `: ${this.failure}`}`,
    )
  }

  /** Run one read against the open domain. 对已打开的域执行一次读取。 */
  async read<T>(work: (domain: ForumStore) => T): Promise<T> {
    return work(await this.require())
  }

  /** Run one mutation at a time against the open domain, preserving FIFO order. 对已打开的域一次只跑一个写入，保持 FIFO 顺序。 */
  mutate<T>(work: (domain: ForumStore) => Promise<T>): Promise<T> {
    const pending = this.chain.then(async () => work(await this.require()))
    this.chain = pending.catch(() => undefined)
    return pending
  }

  /** Open the storage domain, reporting rather than throwing on failure. 打开存储域，失败时报告而不抛出。 */
  private async open(): Promise<ForumStore | undefined> {
    // A live reinstall or hot reload can leave the previous activation's domain
    // open under the same name. Close that handle first, which frees the name for
    // a fresh open; a real restart finds nothing here and takes the same path.
    // 热重装或热重载可能留下上一次激活打开的同一个域。先关闭该句柄，为新的打开释放名称；
    // 真正的重启在这里什么也找不到，走同一条打开路径。
    const stale = this.host.storageDomain.get(FORUM_DOMAIN_NAME)
    if (stale !== undefined) {
      try {
        await stale.close()
        this.host.logger.warn('forum: closed the storage domain left open by a previous activation')
      } catch (error: unknown) {
        this.host.logger.warn(`forum: the previous storage domain could not close: ${String(error)}`)
      }
    }
    try {
      const domain = await this.host.storageDomain.open(forumDomain)
      this.current = domain
      // The caller owns the handle: close it when this plugin unloads so the
      // next activation starts from a free name.
      // 调用方持有句柄：插件卸载时关闭，让下一次激活从空闲的名称开始。
      this.host.effect(() => () => {
        this.current = undefined
        return domain.close()
      }, 'forum:storage')
      return domain
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : String(error)
      this.host.logger.error(
        `forum: storage domain "${FORUM_DOMAIN_NAME}" could not open, so the forum is disabled: ${this.failure}`,
      )
      return undefined
    }
  }
}
