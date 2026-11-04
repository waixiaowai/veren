import { describe, expect, it, vi } from 'vitest'
import { parseTiebaComments, tiebaCommentsHasMore, tiebaCommentsUrl, collectTiebaComments } from '../src/platform/tieba/comments.ts'
import type { RawComment } from '../src/crawler/contract.ts'

// 贴吧评论解析（§5 渲染页路线）：data-info 字段、去标签正文、分页与上限。
// Tieba comment parsing (the rendered-page route): data-info fields, the
// tag-stripped body, pagination and the count cap.
/** 一层楼的渲染页片段 / one rendered floor fragment */
function floor(pid: number, user: string, text: string): string {
  const info = JSON.stringify({ pid, un: user, name_show: user })
    .replaceAll('"', '&quot;')
  return `<li tid="111" data-tid="111" data-info="${info}"><div>${text}</div></li>`
}

const htmlOf = (floors: string[]) => `<ul>${floors.join('')}</ul>`

describe('parseTiebaComments', () => {
  it('extracts pid, user and tag-stripped content from floor blocks', () => {
    const comments: RawComment[] = parseTiebaComments('111', htmlOf([floor(1, '张三', '说得好 <b>真的</b> &amp; 清晰')]))
    expect(comments).toHaveLength(1)
    expect(comments[0]).toMatchObject({ id: '1', contentId: '111', creatorId: '张三', nickname: '张三' })
    expect(comments[0].content).toBe('说得好 真的 & 清晰')
  })

  it('skips floors without data-info or pid', () => {
    expect(parseTiebaComments('111', htmlOf(['<li tid="x">broken</li>']))).toEqual([])
  })

  it('reports more pages while floors exist', () => {
    expect(tiebaCommentsHasMore(htmlOf([floor(1, 'a', 'x')]))).toBe(true)
    expect(tiebaCommentsHasMore('<ul></ul>')).toBe(false)
    expect(tiebaCommentsUrl('111', 2)).toContain('kz=111&pn=2')
  })
})

describe('collectTiebaComments', () => {
  it('paginates until the count cap across pages', async () => {
    const collected: string[] = []
    const sink = { comment: async (c: RawComment) => void collected.push(c.id) }
    const fetchText = vi.fn(async (url: string) => {
      if (url.includes('pn=1')) return htmlOf([floor(1, 'a', 'x'), floor(2, 'b', 'y')])
      return htmlOf([floor(3, 'c', 'z')])
    })
    const count = await collectTiebaComments({ contentId: '111', fetchText, sink, maxCount: 3 })
    expect(collected).toEqual(['1', '2', '3'])
    expect(count).toBe(3)
  })

  it('stops early when a page has no floors', async () => {
    const sink = { comment: async () => {} }
    const fetchText = vi.fn(async () => '<ul></ul>')
    expect(await collectTiebaComments({ contentId: '111', fetchText, sink, maxCount: 10 })).toBe(0)
    expect(fetchText).toHaveBeenCalledTimes(1)
  })
})
