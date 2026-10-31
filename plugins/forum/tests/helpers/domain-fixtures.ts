/**
 * Shared fixtures of the forum domain specs: in-memory storage-table stand-ins
 * and seeded comment/post rows, so the domain rules run alone without a Host.
 *
 * 论坛领域用例的共享夹具：内存存储表替身与预置的评论/主题行，让领域规则在
 * 没有宿主的情况下独立运行。
 *
 * @module @veren/forum/tests/helpers/domain-fixtures
 */

import type { CommentTables } from '../../src/comments.ts'
import type { CommentRecord } from '../../src/domain.ts'
import type { PostView } from '../../src/types.ts'

/** An in-memory stand-in for one storage table, so the domain rules run alone. */
export function memoryTable<T>() {
  const rows = new Map<string, T>()
  return {
    table: {
      get: (key: string) => rows.get(key),
      put: async (key: string, value: T) => { rows.set(key, value) },
      del: async (key: string) => rows.delete(key),
      all: () => [...rows.values()],
    },
    rows,
  }
}

/** A comment table seeded with the given rows, plus one post so parents resolve. */
export function commentTables(comments: readonly CommentRecord[], postId = 'p1') {
  const stored = memoryTable<CommentRecord>()
  for (const comment of comments) stored.rows.set(comment.id, comment)
  const posts = memoryTable<{ id: string }>()
  posts.rows.set(postId, { id: postId })
  return {
    boards: memoryTable<never>().table,
    posts: posts.table,
    comments: stored.table,
  } as unknown as CommentTables
}

/** One comment row with sensible defaults. */
export function commentRow(over: Partial<CommentRecord> & Pick<CommentRecord, 'id' | 'depth' | 'parentKind' | 'parentId'>): CommentRecord {
  return {
    boardId: 'b1',
    postId: 'p1',
    author: 'standard',
    body: 'hello',
    mentions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** One post view with sensible defaults, for ordering tests. */
export function postRow(over: Partial<PostView> & Pick<PostView, 'id'>): PostView {
  return {
    boardId: 'b1',
    author: 'standard',
    title: 't',
    excerpt: 'e',
    tags: [],
    mentions: [],
    pinned: false,
    views: 0,
    up: 0,
    down: 0,
    commentCount: 0,
    heat: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}
