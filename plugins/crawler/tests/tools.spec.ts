import { describe, expect, it } from 'vitest'
import { bindToolPort, createCrawlerTools } from '../src/tools.ts'
import type { CrawlerManager } from '../src/control/manager.ts'
import type { CrawlerStore } from '../src/store/domain.ts'

// 工具面（意见 4）：六工具齐备、全名注册口径、数据汇总与词频读存储域。
// The tool face (directive 4): six tools, the full-name registration
// convention, and the data summary plus word frequencies reading the
// storage domain.
describe('crawler tools', () => {
  it('exposes the six tools under local names', () => {
    const names = createCrawlerTools().map((tool) => tool.name)
    expect(names).toEqual(['start', 'stop', 'status', 'logs', 'data', 'wordcloud'])
  })

  /** 假域：contents 三行（两平台）+ comments 两行 / a fake domain: 3 contents (2 platforms) + 2 comments */
  function fakeDomain(): CrawlerStore {
    const contents = new Map<string, unknown>([
      ['wb::n1', { id: 'n1' }],
      ['wb::n2', { id: 'n2' }],
      ['xhs::n3', { id: 'n3' }],
    ])
    const comments = new Map<string, unknown>([
      ['wb::n1::c1', { content: '美食 美食 好吃' }],
      ['wb::n1::c2', { content: '美食 好吃' }],
    ])
    const table = (name: string) => ({
      put: async () => {},
      entries: () => (name === 'contents' ? contents.entries() : comments.entries()),
    })
    return { table } as unknown as CrawlerStore
  }

  it('summarizes stored data per platform from the domain', async () => {
    bindToolPort({ manager: {} as CrawlerManager, domain: () => fakeDomain() })
    const data = createCrawlerTools().find((tool) => tool.name === 'data')
    expect(data).toBeDefined()
    const rendered = await data!.execute({}, {} as never)
    expect(JSON.stringify(rendered)).toContain('contents 3, comments 2')
    expect(JSON.stringify(rendered)).toContain('wb: 2c/2m')
  })

  it('computes the word-frequency table from stored comments', async () => {
    bindToolPort({ manager: {} as CrawlerManager, domain: () => fakeDomain() })
    const wordcloud = createCrawlerTools().find((tool) => tool.name === 'wordcloud')
    expect(wordcloud).toBeDefined()
    const rendered = await wordcloud!.execute({}, {} as never)
    expect(JSON.stringify(rendered)).toContain('美食: 3')
    expect(JSON.stringify(rendered)).toContain('好吃: 2')
  })

  it('reports an empty table when comments are absent', async () => {
    bindToolPort({ manager: {} as CrawlerManager, domain: () => fakeDomain() })
    // comments 空表路径：用不含 comments 的域 / an empty-comments path: use a domain without comments
    const empty = { table: () => ({ put: async () => {}, entries: () => new Map().entries() }) } as unknown as CrawlerStore
    bindToolPort({ manager: {} as CrawlerManager, domain: () => empty })
    const rendered = await wordcloudToolOf()
    expect(JSON.stringify(rendered)).toContain('no comments')
  })

  it('folds illegal enums into error canonical values on start', async () => {
    bindToolPort({ manager: {} as CrawlerManager, domain: () => undefined })
    const start = createCrawlerTools().find((tool) => tool.name === 'start')
    const rendered = await start!.execute({ platform: 'twitter', crawlerType: 'search' }, {} as never)
    expect(JSON.stringify(rendered)).toContain('INVALID_PLATFORM')
  })
})

/** 取 wordcloud 工具的便捷封装 / a convenience accessor for the wordcloud tool */
function wordcloudToolOf(): Promise<unknown> {
  const tool = createCrawlerTools().find((t) => t.name === 'wordcloud')
  return tool!.execute({}, {} as never)
}
