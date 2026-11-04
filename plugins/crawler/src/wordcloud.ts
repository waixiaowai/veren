/**
 * 词频与词云数据源：从 jsonl 评论文件生成词频表（design/modules/tools.md
 * 词云条目）。
 * Word frequencies and the wordcloud data source: builds the frequency
 * table from a jsonl comments file (the wordcloud entry in tools.md).
 *
 * 教学版边界：本模块产出**词频表**（词 → 次数）与停用词过滤；词云**图**
 * 的渲染交给外部工具消费词频表（如 echarts-wordcloud），插件内不引渲染
 * 依赖。中文按字二元分词（bigram），英文按词元，足够教学与研究用途。
 * Teaching-edition boundary: this module produces the **frequency table**
 * (word → count) with stopword filtering; rendering the wordcloud **image**
 * is left to external tools consuming the table (e.g. echarts-wordcloud) —
 * no rendering dependency inside the plugin. Chinese text uses character
 * bigrams, latin text uses word tokens — enough for study and research.
 *
 * @module @veren/crawler/wordcloud
 */
import { readFile } from 'node:fs/promises'

/** 一条词频 / one word-frequency entry */
export interface WordFrequency {
  word: string
  count: number
}

/** 默认停用词表（可被自定义表整体替换）/ the default stopword list (wholly replaceable) */
export const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看',
  '好', '这', '那', '啊', '吗', '呢', '吧', '呀', '哦', '哈', '嗯', '哈哈',
  'the', 'a', 'an', 'is', 'are', 'was', 'to', 'of', 'and', 'in', 'it', 'this',
])

/** 词频统计选项 / frequency options */
export interface WordFrequencyOptions {
  /** 自定义停用词表（整体替换默认表）/ a custom stopword list (wholly replaces the default) */
  stopwords?: ReadonlySet<string>
  /** 返回前 K 个高频词（按次数降序）/ returns the top-K words (count-descending) */
  topK?: number
}

/** 文本切词：中文按字二元，英文按词元 / tokenizes: chinese bigrams, latin word tokens */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const latin = text.toLowerCase().match(/[a-z][a-z']{1,}/g) ?? []
  for (const word of latin) tokens.push(word)
  const chineseRuns = text.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of chineseRuns) {
    for (let index = 0; index + 2 <= run.length; index += 1) {
      tokens.push(run.slice(index, index + 2))
    }
  }
  return tokens
}

/**
 * 从评论文本数组统计词频，过滤停用词，按次数降序。
 * Counts word frequencies over comment texts, filters stopwords, and
 * orders count-descending.
 */
export function wordFrequencies(comments: readonly string[], options: WordFrequencyOptions = {}): WordFrequency[] {
  const stopwords = options.stopwords ?? DEFAULT_STOPWORDS
  const counts = new Map<string, number>()
  for (const comment of comments) {
    for (const token of tokenize(comment)) {
      if (stopwords.has(token)) continue
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
  }
  const sorted = [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
  return options.topK === undefined ? sorted : sorted.slice(0, options.topK)
}

/**
 * 从 jsonl 评论文件读词频：文件每行一条评论对象，取 `content` 字段。
 * Reads frequencies from a jsonl comments file: one comment object per
 * line, keyed by the `content` field.
 */
export async function wordFrequenciesFromJsonl(file: string, options: WordFrequencyOptions = {}): Promise<WordFrequency[]> {
  const text = await readFile(file, 'utf8')
  const comments: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const record = JSON.parse(trimmed) as { content?: unknown }
      if (typeof record.content === 'string') comments.push(record.content)
    } catch {
      // 坏行跳过，不中断词频统计 / skip a broken line, never break the count
    }
  }
  return wordFrequencies(comments, options)
}
