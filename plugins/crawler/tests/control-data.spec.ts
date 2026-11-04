import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDataFiles, previewDataFile, readDataFile, resolveWithinRoot } from '../src/control/data.ts'
import { CrawlerError } from '../src/errors.ts'

// 数据服务验收（design/modules/api.md §4.5）：列出、预览、越界拒绝、缺失拒绝。
// Data-service acceptance (design api.md §4.5): list, preview, escape
// rejection, missing rejection.
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'crawler-data-'))
  await mkdir(join(root, 'xhs', 'jsonl'), { recursive: true })
  await writeFile(join(root, 'xhs', 'jsonl', 'search_contents.jsonl'), '{"id":"n1"}\n{"id":"n2"}\n')
  await writeFile(join(root, 'xhs', 'notes.txt'), 'hello\nworld')
  return root
}

describe('resolveWithinRoot', () => {
  it('rejects escape attempts outside the data root', () => {
    const root = join('C:', 'data')
    expect(() => resolveWithinRoot(root, '..\\secret.txt')).toThrowError(CrawlerError)
    try {
      resolveWithinRoot(root, '..\\secret.txt')
    } catch (error) {
      expect((error as CrawlerError).code).toBe('DATA_PATH_OUT_OF_ROOT')
    }
  })

  it('accepts paths inside the root', () => {
    expect(resolveWithinRoot(join('C:', 'data'), 'xhs\\a.jsonl').startsWith(join('C:', 'data'))).toBe(true)
  })
})

describe('listDataFiles', () => {
  it('lists files recursively with relative paths and types', async () => {
    const root = await makeRoot()
    try {
      const files = await listDataFiles(root)
      expect(files.map((file) => file.path)).toEqual(['xhs\\jsonl\\search_contents.jsonl', 'xhs\\notes.txt'])
      expect(files[0].fileType).toBe('jsonl')
      expect(files[0].size).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('previewDataFile', () => {
  it('previews jsonl per line and caps at the limit', async () => {
    const root = await makeRoot()
    try {
      const preview = await previewDataFile(root, 'xhs\\jsonl\\search_contents.jsonl', 1)
      expect(preview.total).toBe(1)
      expect(preview.data[0]).toEqual({ id: 'n1' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('falls back to text lines for non-json files', async () => {
    const root = await makeRoot()
    try {
      const preview = await previewDataFile(root, 'xhs\\notes.txt', 10)
      expect(preview.data).toEqual([{ text: 'hello' }, { text: 'world' }])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects missing files with DATA_FILE_NOT_FOUND', async () => {
    const root = await makeRoot()
    try {
      try {
        await previewDataFile(root, 'xhs\\missing.json', 10)
        expect.unreachable()
      } catch (error) {
        expect((error as CrawlerError).code).toBe('DATA_FILE_NOT_FOUND')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('readDataFile', () => {
  it('reads bytes for download and rejects escapes', async () => {
    const root = await makeRoot()
    try {
      const bytes = await readDataFile(root, 'xhs\\notes.txt')
      expect(bytes.toString()).toContain('hello')
      expect(() => resolveWithinRoot(root, '..\\x')).toThrowError(CrawlerError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
