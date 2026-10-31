/**
 * The comment domain: parent resolution (two-level nesting) and the comment
 * tree builder. These are the forum's invariants, tested where they live.
 *
 * 评论域：父级解析（两层嵌套）与评论树构建。这些是论坛的不变量，在它们所在
 * 之处测试。
 */

import { describe, expect, it } from 'vitest'
import { LONG_BODY_CHARS } from '../src/domain.ts'
import { buildTree, resolveParent } from '../src/comments.ts'
import { ForumError } from '../src/types.ts'
import { commentRow, commentTables } from './helpers/domain-fixtures.ts'

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
