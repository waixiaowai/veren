import { describe, expect, it } from 'vitest'
import { creatorHash, maskNickname } from '../src/store/mask.ts'
import { shapeComment, shapeContent } from '../src/store/shape.ts'
import type { RawContentItem } from '../src/store/shape.ts'

// 脱敏铁律：人物标识哈希化、昵称遮蔽，明文不得出现在整形结果中。
// Masking invariant: hashed identifiers, masked nicknames; plain fields
// never appear in shaped records.
describe('mask', () => {
  it('hashes creator identifiers to 16 hex chars deterministically', () => {
    expect(creatorHash('user-abc')).toMatch(/^[0-9a-f]{16}$/)
    expect(creatorHash('user-abc')).toBe(creatorHash('user-abc'))
    expect(creatorHash('user-abc')).not.toBe(creatorHash('user-xyz'))
  })

  it('masks nicknames keeping first and last chars only', () => {
    expect(maskNickname('张三丰')).toBe('张*丰')
    expect(maskNickname('李四')).toBe('李*')
    expect(maskNickname('王')).toBe('王*')
    expect(maskNickname('')).toBe('')
  })

  it('shapes content with anonymized person fields and context', () => {
    const raw: RawContentItem = {
      id: 'n1',
      title: '标题',
      url: 'https://example.com/n1',
      imageList: ['a.png', 'b.png'],
      creatorId: 'user-abc',
      nickname: '张三丰',
    }
    const record = shapeContent(raw, { sourceKeyword: '美食', now: () => 1_000 })
    expect(record.creatorHash).toMatch(/^[0-9a-f]{16}$/)
    expect(record.nickname).toBe('张*丰')
    expect(JSON.stringify(record)).not.toContain('user-abc')
    expect(record.imageList).toBe('a.png,b.png')
    expect(record.sourceKeyword).toBe('美食')
    expect(record.addTs).toBe(1_000)
  })

  it('shapes comments inheriting masking and defaults', () => {
    const record = shapeComment(
      { id: 'c1', contentId: 'n1', content: '好文', creatorId: 'u', nickname: '李四' },
      { sourceKeyword: null, now: () => 2_000 },
    )
    expect(record.parentCommentId).toBeNull()
    expect(record.nickname).toBe('李*')
    expect(record.lastModifyTs).toBe(2_000)
  })
})
