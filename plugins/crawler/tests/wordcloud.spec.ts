import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tokenize, wordFrequencies, wordFrequenciesFromJsonl, writeWordFrequencyTable, DEFAULT_STOPWORDS } from '../src/wordcloud.ts'

// 词频数据源验收（design/modules/tools.md 词云条目）：切词、停用词过滤、
// jsonl 读取、坏行容错。
// Wordcloud acceptance (design tools.md wordcloud entry): tokenization,
// stopword filtering, jsonl reading, broken-line tolerance.
describe('tokenize', () => {
  it('extracts chinese bigrams and latin word tokens', () => {
    expect(tokenize('美食推荐 food')).toContain('美食')
    expect(tokenize('美食推荐 food')).toContain('食推')
    expect(tokenize('美食推荐 food')).toContain('food')
  })
})

describe('wordFrequencies', () => {
  it('counts, filters stopwords and orders count-descending', () => {
    const freq = wordFrequencies(['美食 美食 好吃', '美食 好吃', 'the food food'], { topK: 3 })
    expect(freq[0]).toEqual({ word: '美食', count: 3 })
    expect(freq.map((entry) => entry.word)).not.toContain('的')
    expect(freq.map((entry) => entry.word)).not.toContain('the')
    expect(freq[1]?.count).toBeGreaterThanOrEqual(freq[2]?.count ?? 0)
  })

  it('supports a custom stopword list', () => {
    const freq = wordFrequencies(['美食 美食 好吃'], { stopwords: new Set(['美食']) })
    expect(freq.map((entry) => entry.word)).not.toContain('美食')
  })
})

describe('wordFrequenciesFromJsonl', () => {
  it('reads the content field per line and skips broken lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawler-wordcloud-'))
    const file = join(dir, 'search_comments.jsonl')
    try {
      await writeFile(file, '{"content":"美食 美食"}\nnot-json\n{"content":"好吃"}\n{"other":1}\n')
      const freq = await wordFrequenciesFromJsonl(file, { topK: 5, stopwords: DEFAULT_STOPWORDS })
      expect(freq[0]?.word).toBe('美食')
      expect(freq[0]?.count).toBe(2)
      expect(freq.some((entry) => entry.word === '好吃')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('writeWordFrequencyTable', () => {
  it('writes the frequency table under the design naming', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crawler-wc-file-'))
    try {
      const comments = join(root, 'wb', 'jsonl', 'search_comments_2026-11-04.jsonl')
      await mkdir(join(root, 'wb', 'jsonl'), { recursive: true })
      await writeFile(comments, '{"content":"美食 美食"}\n{"content":"好吃"}\n')
      const target = await writeWordFrequencyTable({
        dataRoot: root, platform: 'wb', crawlerType: 'search', day: '2026-11-04', topK: 10,
      })
      expect(target).toBe(join(root, 'wb', 'words', 'search_comments_2026-11-04.json'))
      const table = JSON.parse(await readFile(target!, 'utf8')) as Array<{ word: string; count: number }>
      expect(table[0]).toMatchObject({ word: '美食', count: 2 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('skips silently when the comments file is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crawler-wc-skip-'))
    try {
      const target = await writeWordFrequencyTable({
        dataRoot: root, platform: 'wb', crawlerType: 'search', day: '2026-11-04',
      })
      expect(target).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
