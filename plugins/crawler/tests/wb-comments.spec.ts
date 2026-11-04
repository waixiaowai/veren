import { describe, expect, it, vi } from 'vitest'
import { collectWbComments, INITIAL_COMMENT_CURSOR, nextCommentCursor, parseWbComments } from '../src/platform/wb/comments.ts'
import type { RawComment } from '../src/crawler/contract.ts'

// 评论伴随采集验收（crawler.md）：解析、游标推进、数量上限、耗尽终止。
// Companion-comment acceptance (crawler.md): parsing, cursor progression,
// the count cap, and cursor exhaustion.
function commentsPayload(ids: string[], maxId: number | null): unknown {
  return {
    ok: 1,
    max_id: maxId ?? 0,
    max_id_type: 0,
    data: ids.map((id) => ({
      id,
      text: `评论${id}`,
      like_count: 1,
      total_number: 0,
      user: { idstr: `u-${id}`, screen_name: '李四' },
    })),
  }
}

describe('parseWbComments', () => {
  it('maps comment entries onto raw comments with masking inputs', () => {
    const comments: RawComment[] = parseWbComments('n1', commentsPayload(['c1', 'c2'], null))
    expect(comments).toHaveLength(2)
    expect(comments[0]).toMatchObject({
      id: 'c1', contentId: 'n1', content: '评论c1',
      likeCount: 1, creatorId: 'u-c1', nickname: '李四', parentCommentId: null,
    })
  })

  it('tolerates malformed payloads', () => {
    expect(parseWbComments('n1', null)).toEqual([])
    expect(parseWbComments('n1', { ok: 0 })).toEqual([])
  })
})

describe('nextCommentCursor', () => {
  it('advances on max_id and stops at zero or failure', () => {
    expect(nextCommentCursor(commentsPayload([], 42))).toEqual({ maxId: 42, maxIdType: 0 })
    expect(nextCommentCursor(commentsPayload([], 0))).toBeNull()
    expect(nextCommentCursor(null)).toBeNull()
  })
})

describe('collectWbComments', () => {
  it('paginates until the count cap across pages', async () => {
    const collected: string[] = []
    const sink = { comment: async (c: RawComment) => void collected.push(c.id) }
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('max_id=0')) return commentsPayload(['c1', 'c2'], 42)
      return commentsPayload(['c3', 'c4'], 0)
    })
    const count = await collectWbComments({ contentId: 'n1', fetchJson, sink, maxCount: 3 })
    expect(collected).toEqual(['c1', 'c2', 'c3'])
    expect(count).toBe(3)
  })

  it('stops early when the cursor exhausts before the cap', async () => {
    const collected: string[] = []
    const sink = { comment: async (c: RawComment) => void collected.push(c.id) }
    const fetchJson = vi.fn(async () => commentsPayload(['c1'], 0))
    expect(await collectWbComments({ contentId: 'n1', fetchJson, sink, maxCount: 10 })).toBe(1)
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(INITIAL_COMMENT_CURSOR.maxId).toBe(0)
  })
})
