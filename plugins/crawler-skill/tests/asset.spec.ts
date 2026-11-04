import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 技能资产不变量：正文存在且覆盖关键使用面（工具名、互斥、介质、合规）。
// Skill-asset invariants: the body exists and covers the key usage surface
// (tool names, the mutex, the media, compliance).
const body = readFileSync(fileURLToPath(new URL('../assets/crawler.md', import.meta.url)), 'utf8')

describe('crawler skill asset', () => {
  it('exists and is substantial', () => {
    expect(body.length).toBeGreaterThan(500)
  })

  it('covers the five tools, the mutex, the storage medium and compliance', () => {
    for (const term of ['crawler__start', 'crawler__status', '单任务互斥', '宿主存储域', '只读', '匿名化']) {
      expect(body).toContain(term)
    }
  })
})
