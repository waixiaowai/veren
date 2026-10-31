/**
 * Domain rules around a post's text and ranking: mentions, tags, validation,
 * heat, ordering, and search matching. These are the forum's invariants, so
 * they are tested where they live rather than through a running Loader.
 *
 * 主题文本与排序周边的领域规则：@提及、标签、校验、热度、排序与搜索匹配。
 * 这些是论坛的不变量，因此在它们所在之处测试，而不是通过运行中的 Loader。
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_TAGS, MAX_TAG_CHARS, MAX_TITLE_CHARS,
  extractMentions, normalizeTag, normalizeTags,
} from '../src/domain.ts'
import { ForumError } from '../src/types.ts'
import { buildPost, heatOf, matches, orderPosts, postView, validatePost } from '../src/posts.ts'
import type { PostCounters, SubjectCounters } from '../src/types.ts'
import { postRow } from './helpers/domain-fixtures.ts'

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
