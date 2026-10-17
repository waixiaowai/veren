/**
 * Domain rules that carry no Host: mentions, tags, heat, the comment tree, and
 * the one-attitude vote key.
 *
 * These are the forum's invariants, so they are tested where they live rather
 * than through a running Loader: a mention the parser misses is a preset that is
 * never told, and a vote key that is not unique is a counter that doubles.
 *
 * 不依赖宿主的领域规则：@提及、标签、热度、评论树，以及「一种态度」的投票键。
 *
 * 这些是论坛的不变量，因此在它们所在之处测试，而不是通过运行中的 Loader：解析漏掉的提及就是
 * 一个永远收不到通知的预设，而不再唯一的投票键就是会重复叠加的计数。
 */

import { describe, expect, it } from 'vitest'
import {
  LONG_BODY_CHARS, MAX_TAGS, MAX_TAG_CHARS, MAX_TITLE_CHARS,
  extractMentions, normalizeTag, normalizeTags,
} from '../src/domain.ts'
import { buildTree, resolveParent } from '../src/comments.ts'
import type { CommentTables } from '../src/comments.ts'
import { ForumError } from '../src/types.ts'
import { buildPost, heatOf, matches, orderPosts, postView, validatePost } from '../src/posts.ts'
import type { PostCounters, PostView, SubjectCounters } from '../src/types.ts'
import { castVote, counterLookup, totalsFor } from '../src/votes.ts'
import { notificationKey, splitNotificationKey, voteKey } from '../src/ids.ts'
import type { CommentRecord, VoteRecord } from '../src/domain.ts'
import { view } from '../src/storage.ts'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'

/** An in-memory stand-in for one storage table, so the domain rules run alone. */
function memoryTable<T>() {
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
function commentTables(comments: readonly CommentRecord[], postId = 'p1') {
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
function commentRow(over: Partial<CommentRecord> & Pick<CommentRecord, 'id' | 'depth' | 'parentKind' | 'parentId'>): CommentRecord {
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
function postRow(over: Partial<PostView> & Pick<PostView, 'id'>): PostView {
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

describe('mentions', () => {
  it('reads a name, stops at punctuation, and drops the author', () => {
    expect(extractMentions('@ptc 你好，@standard 和你。', 'standard')).toEqual(['ptc'])
  })

  it('de-duplicates while keeping first-seen order', () => {
    expect(extractMentions('@b @a @b @a', 'x')).toEqual(['b', 'a'])
  })

  it('accepts dots, dashes, and underscores inside a name', () => {
    expect(extractMentions('@person-agent @a.b @c_d', 'x')).toEqual(['person-agent', 'a.b', 'c_d'])
  })

  it('ignores a bare @ and a leading punctuation mark', () => {
    expect(extractMentions('mail me @ home, or @-bad', 'x')).toEqual([])
  })

  it('treats the author naming itself as no mention at all', () => {
    expect(extractMentions('@me again', 'me')).toEqual([])
  })
})

describe('tags', () => {
  it('lowercases, trims, and turns inner spaces into hyphens', () => {
    expect(normalizeTag('  Hello World ')).toBe('hello-world')
  })

  it('splits on commas, drops empties, and de-duplicates', () => {
    expect(normalizeTags(['a, b', 'A', '', ' ,c'])).toEqual(['a', 'b', 'c'])
  })
})

describe('post validation', () => {
  it('refuses an empty title', () => {
    expect(() => validatePost({ title: '   ', body: 'x' })).toThrow(ForumError)
  })

  it('refuses an over-long title', () => {
    expect(() => validatePost({ title: 'x'.repeat(MAX_TITLE_CHARS + 1), body: '' })).toThrow(ForumError)
  })

  it('refuses too many tags and an over-long tag', () => {
    const many = Array.from({ length: MAX_TAGS + 1 }, (_, index) => `t${String(index)}`)
    expect(() => validatePost({ title: 't', body: 'b', tags: many })).toThrow(ForumError)
    expect(() => validatePost({ title: 't', body: 'b', tags: ['x'.repeat(MAX_TAG_CHARS + 1)] })).toThrow(ForumError)
  })

  it('records the mentions it parsed and starts unpinned with no views', () => {
    const post = buildPost({ boardId: 'b1', author: 'standard', title: 't', body: 'hi @ptc', tags: [] }, '2026-01-01T00:00:00.000Z')
    expect(post.mentions).toEqual(['ptc'])
    expect(post.pinned).toBe(false)
    expect(post.views).toBe(0)
  })
})

describe('heat and ordering', () => {
  const counters: SubjectCounters = { up: 3, down: 1 }
  const createdAt = '2026-01-01T00:00:00.000Z'

  it('rates the same engagement higher the sooner after posting it is read', () => {
    const post = { ...buildPost({ boardId: 'b1', author: 'a', title: 't', body: 'b', tags: [] }, createdAt), views: 10 }
    const total: PostCounters = { ...counters, commentCount: 2 }
    const soon = heatOf(post, total, Date.parse('2026-01-02T00:00:00.000Z'))
    const later = heatOf(post, total, Date.parse('2026-01-10T00:00:00.000Z'))
    expect(soon).toBeGreaterThan(later)
    // The view's heat is evaluated at the instant it is handed.
    expect(postView(post, total, Date.parse('2026-01-02T00:00:00.000Z')).heat).toBe(soon)
  })

  it('rates more engagement above less at the same instant', () => {
    const post = { ...buildPost({ boardId: 'b1', author: 'a', title: 't', body: 'b', tags: [] }, createdAt), views: 10 }
    const at = Date.parse('2026-01-02T00:00:00.000Z')
    const quiet = heatOf(post, { up: 0, down: 0, commentCount: 0 }, at)
    const busy = heatOf(post, { up: 5, down: 0, commentCount: 3 }, at)
    expect(busy).toBeGreaterThan(quiet)
  })

  it('always leads with pinned posts, whatever the sort', () => {
    const rows = [
      postRow({ id: 'a', heat: 100 }),
      postRow({ id: 'b', pinned: true, heat: 1 }),
    ]
    expect(orderPosts(rows, 'heat').map(post => post.id)).toEqual(['b', 'a'])
    expect(orderPosts(rows, 'views').map(post => post.id)).toEqual(['b', 'a'])
  })

  it('orders by views and by recency when asked', () => {
    const rows = [
      postRow({ id: 'a', views: 1, createdAt: '2026-01-02T00:00:00.000Z' }),
      postRow({ id: 'b', views: 9, createdAt: '2026-01-01T00:00:00.000Z' }),
    ]
    expect(orderPosts(rows, 'views').map(post => post.id)).toEqual(['b', 'a'])
    expect(orderPosts(rows, 'new').map(post => post.id)).toEqual(['a', 'b'])
  })
})

describe('search matching', () => {
  const post = buildPost({ boardId: 'b1', author: 'ptc', title: 'Hello World', body: 'about caching', tags: ['perf'] }, '2026-01-01T00:00:00.000Z')

  it('matches title, body, author, and tag substrings', () => {
    expect(matches(post, 'hello', '')).toBe(true)
    expect(matches(post, 'caching', '')).toBe(true)
    expect(matches(post, 'ptc', '')).toBe(true)
    expect(matches(post, 'perf', '')).toBe(true)
  })

  it('rejects a keyword nothing carries', () => {
    expect(matches(post, 'kubernetes', '')).toBe(false)
  })

  it('applies the tag filter before the keyword', () => {
    expect(matches(post, '', 'perf')).toBe(true)
    expect(matches(post, '', 'other')).toBe(false)
  })
})

describe('comment depth', () => {
  const root = commentRow({ id: 'c1', depth: 1, parentKind: 'post', parentId: 'p1' })
  const reply = commentRow({ id: 'c2', depth: 2, parentKind: 'comment', parentId: 'c1' })
  const tables = commentTables([root, reply])

  it('answers the post at depth 1 and a comment at depth 2', () => {
    expect(resolveParent(tables, 'p1', undefined).depth).toBe(1)
    expect(resolveParent(tables, 'p1', 'c1').depth).toBe(2)
  })

  it('refuses nesting past the second level', () => {
    try {
      resolveParent(tables, 'p1', 'c2')
      expect.unreachable('a third level must be refused')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ForumError)
      expect((error as ForumError).code).toBe('forum/comment-too-deep')
    }
  })

  it('refuses a parent that belongs to another post', () => {
    const foreign = commentRow({ id: 'c9', depth: 1, parentKind: 'post', parentId: 'p9', postId: 'p9' })
    expect(() => resolveParent(commentTables([foreign]), 'p1', 'c9')).toThrow(ForumError)
  })

  it('refuses a post that does not exist', () => {
    expect(() => resolveParent(tables, 'missing', undefined)).toThrow(ForumError)
  })
})

describe('comment tree', () => {
  const root = commentRow({ id: 'c1', depth: 1, parentKind: 'post', parentId: 'p1' })
  const reply = commentRow({ id: 'c2', depth: 2, parentKind: 'comment', parentId: 'c1' })
  const orphan = commentRow({ id: 'c3', depth: 2, parentKind: 'comment', parentId: 'gone' })

  it('hangs replies under their parent and drops one whose parent is missing', () => {
    const tree = buildTree([root, reply, orphan], () => ({ up: 0, down: 0 }))
    expect(tree.map(node => node.id)).toEqual(['c1'])
    expect(tree[0]?.replies.map(node => node.id)).toEqual(['c2'])
  })

  it('marks a long body foldable and a short one not', () => {
    const long = commentRow({
      id: 'c4', depth: 1, parentKind: 'post', parentId: 'p1', body: 'x'.repeat(LONG_BODY_CHARS + 1),
    })
    const tree = buildTree([root, long], () => ({ up: 0, down: 0 }))
    expect(tree.find(node => node.id === 'c4')?.foldable).toBe(true)
    expect(tree.find(node => node.id === 'c1')?.foldable).toBe(false)
  })
})

describe('votes', () => {
  const tables = () => {
    const stored = memoryTable<VoteRecord>()
    return { votes: stored.table, rows: stored.rows }
  }

  it('keeps one attitude per preset and switches it in place', async () => {
    const store = tables()
    const votes = { votes: store.votes }
    await castVote(votes, 'post', 'p1', 'standard', 'up', '2026-01-01T00:00:00.000Z')
    await castVote(votes, 'post', 'p1', 'standard', 'down', '2026-01-01T00:01:00.000Z')
    const totals = totalsFor(votes, 'post', 'p1', 'standard')
    expect(totals).toEqual({ up: 0, down: 1, myVote: 'down' })
    // One row only: the key, not a check, is what makes that true.
    expect(store.rows.size).toBe(1)
  })

  it('clears the attitude when the same button is pressed twice', async () => {
    const store = tables()
    const votes = { votes: store.votes }
    await castVote(votes, 'post', 'p1', 'standard', 'up', '2026-01-01T00:00:00.000Z')
    const cleared = await castVote(votes, 'post', 'p1', 'standard', 'up', '2026-01-01T00:01:00.000Z')
    expect(cleared.cleared).toBe(true)
    expect(cleared.totals).toEqual({ up: 0, down: 0 })
    expect(store.rows.size).toBe(0)
  })

  it('counts one vote per preset separately', async () => {
    const store = tables()
    const votes = { votes: store.votes }
    await castVote(votes, 'post', 'p1', 'standard', 'up', '2026-01-01T00:00:00.000Z')
    await castVote(votes, 'post', 'p1', 'ptc', 'up', '2026-01-01T00:00:00.000Z')
    expect(totalsFor(votes, 'post', 'p1').up).toBe(2)
  })

  it('reports a reader that never voted without an attitude', async () => {
    const store = tables()
    const votes = { votes: store.votes }
    await castVote(votes, 'comment', 'c1', 'ptc', 'down', '2026-01-01T00:00:00.000Z')
    expect(totalsFor(votes, 'comment', 'c1', 'standard')).toEqual({ up: 0, down: 1 })
  })

  it('builds the same key for the same triple and no other', () => {
    expect(voteKey('post', 'p1', 'standard')).toBe(voteKey('post', 'p1', 'standard'))
    expect(voteKey('post', 'p1', 'standard')).not.toBe(voteKey('comment', 'p1', 'standard'))
    expect(voteKey('post', 'p1', 'standard')).not.toBe(voteKey('post', 'p2', 'standard'))
    expect(voteKey('post', 'p1', 'standard')).not.toBe(voteKey('post', 'p1', 'ptc'))
  })
})

describe('notification keys', () => {
  it('round-trips a recipient and an id', () => {
    const key = notificationKey('standard', 'notification-abc')
    expect(splitNotificationKey(key)).toEqual({ recipient: 'standard', id: 'notification-abc' })
  })

  it('keeps two recipients that share an id apart', () => {
    expect(notificationKey('a', 'x')).not.toBe(notificationKey('b', 'x'))
  })
})

describe('table projection', () => {
  it('exposes get, put, del, and all over the real table handle', async () => {
    const table: KvTable<string, { id: string }> = {
      get: key => ({ id: key }),
      entries: () => [['a', { id: 'a' }] as [string, { id: string }]][Symbol.iterator](),
      keys: () => ['a'][Symbol.iterator](),
      size: 1,
      put: async () => undefined,
      delete: async () => true,
      update: async () => ({ id: 'a' }),
    }
    const projected = view(table)
    expect(projected.get('a')).toEqual({ id: 'a' })
    expect(projected.all()).toEqual([{ id: 'a' }])
    await expect(projected.put('b', { id: 'b' })).resolves.toBeUndefined()
    await expect(projected.del('a')).resolves.toBe(true)
  })
})

describe('counter lookup', () => {
  it('reports totals and the reader attitude for posts and comments alike', () => {
    const rows = new Map<string, VoteRecord>()
    const lookup = counterLookup({
      votes: {
        get: key => rows.get(key),
        put: async (key, value) => { rows.set(key, value) },
        del: async key => rows.delete(key),
        all: () => [...rows.values()],
      },
    }, 'standard')
    expect(lookup('post', 'p1')).toEqual({ up: 0, down: 0 })
  })
})
