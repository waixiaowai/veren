import { describe, expect, it } from 'vitest'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStoreFactory } from '../src/store/factory.ts'
import { shapeComment, shapeContent } from '../src/store/shape.ts'

// 存储矩阵（design/modules/store.md §5）：文件介质写入语义与未知介质拒绝。
// Storage matrix (design store.md §5): file medium write semantics and the
// unknown-medium rejection.
const ctx = { sourceKeyword: '美食', now: () => 1_000 }

async function makeRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'crawler-store-'))
}

describe('store factory', () => {
  it('rejects unknown media with INVALID_SAVE_OPTION before writing', async () => {
    const root = await makeRoot()
    try {
      const factory = createStoreFactory({ dataRoot: root, platform: 'xhs', crawlerType: 'search', day: '2026-11-04' })
      expect(() => factory('db')).toThrowError(/INVALID_SAVE_OPTION|不支持/)
      expect(() => factory('excel' as never)).toThrowError()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('jsonl store', () => {
  it('appends one json object per line', async () => {
    const root = await makeRoot()
    try {
      const factory = createStoreFactory({ dataRoot: root, platform: 'xhs', crawlerType: 'search', day: '2026-11-04' })
      const store = factory('jsonl')
      await store.storeContent(shapeContent({ id: 'n1', url: 'u', creatorId: 'a', nickname: '张三' }, ctx))
      await store.storeContent(shapeContent({ id: 'n2', url: 'u', creatorId: 'b', nickname: '李四' }, ctx))
      const file = join(root, 'xhs', 'jsonl', 'search_contents_2026-11-04.jsonl')
      const lines = (await readFile(file, 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0]!)).toMatchObject({ id: 'n1' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('json store', () => {
  it('rewrites a single indented array file', async () => {
    const root = await makeRoot()
    try {
      const factory = createStoreFactory({ dataRoot: root, platform: 'zhihu', crawlerType: 'detail', day: '2026-11-04' })
      const store = factory('json')
      await store.storeComment(shapeComment({ id: 'c1', contentId: 'n1', content: 'x', creatorId: 'a', nickname: '王' }, ctx))
      await store.storeComment(shapeComment({ id: 'c2', contentId: 'n1', content: 'y', creatorId: 'b', nickname: '赵' }, ctx))
      const file = join(root, 'zhihu', 'json', 'detail_comments_2026-11-04.json')
      const rows = JSON.parse(await readFile(file, 'utf8')) as unknown[]
      expect(rows).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('csv store', () => {
  it('writes header once then appends escaped rows', async () => {
    const root = await makeRoot()
    try {
      const factory = createStoreFactory({ dataRoot: root, platform: 'wb', crawlerType: 'search', day: '2026-11-04' })
      const store = factory('csv')
      await store.storeContent(shapeContent({ id: 'n1', title: '说"你好"', url: 'u', creatorId: 'a', nickname: '张三' }, ctx))
      await store.storeContent(shapeContent({ id: 'n2', url: 'u', creatorId: 'b', nickname: '李四' }, ctx))
      const file = join(root, 'wb', 'csv', 'search_contents_2026-11-04.csv')
      const lines = (await readFile(file, 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(3)
      expect(lines[0]).toContain('id')
      expect(lines[1]).toContain('""你好""')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
