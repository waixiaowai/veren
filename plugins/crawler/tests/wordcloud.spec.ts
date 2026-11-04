import { describe, expect, it } from 'vitest'
import { tokenize, wordFrequencies, DEFAULT_STOPWORDS } from '../src/wordcloud.ts'

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
    expect(DEFAULT_STOPWORDS.size).toBeGreaterThan(10)
  })
})