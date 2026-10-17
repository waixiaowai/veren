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
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  AutoPostRecord, BoardRecord, CommentRecord, NotificationRecord, PostRecord, VoteRecord,
} from './domain.ts'

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
