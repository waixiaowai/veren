import { describe, expect, it } from 'vitest'
import { bindToolPort, createCrawlerTools } from '../src/tools.ts'
import type { CrawlerManager } from '../src/control/manager.ts'
import type { CrawlerStore } from '../src/store/domain.ts'

// 工具面（意见 4）：五工具齐备、全名注册口径、数据汇总读存储域。
// The tool face (directive 4): five tools, the full-name registration
// convention, and the data summary reading the storage domain.
describe('crawler tools', () => {
  it('exposes the five tools under local names', () => {
    const names = createCrawlerTools().map((tool) => tool.name)
    expect(names).toEqual(['start', 'stop', 'status', 'logs', 'data'])
  })

  it('summarizes stored data per platform from the domain', async () => {
    const rows = new Map<string, unknown>()
    rows.set('wb::n1', {})
    rows.set('wb::n2', {})
    rows.set('xhs::n3', {})
    const domain = {
      table: (name: string) => ({
        put: async () => {},
        entries: () => (name === 'contents' ? rows.entries() : new Map().entries()),
      }),
    } as unknown as CrawlerStore
    bindToolPort({ manager: {} as CrawlerManager, domain: () => domain })
    const data = createCrawlerTools().find((tool) => tool.name === 'data')
    expect(data).toBeDefined()
    const rendered = await data!.execute({}, {} as never)
    expect(JSON.stringify(rendered)).toContain('contents 3')
    expect(JSON.stringify(rendered)).toContain('wb: 2 contents')
  })

  it('folds illegal enums into error canonical values on start', async () => {
    bindToolPort({ manager: {} as CrawlerManager, domain: () => undefined })
    const start = createCrawlerTools().find((tool) => tool.name === 'start')
    const rendered = await start!.execute({ platform: 'twitter', crawlerType: 'search' }, {} as never)
    expect(JSON.stringify(rendered)).toContain('INVALID_PLATFORM')
  })
})
