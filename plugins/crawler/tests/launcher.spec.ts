import { describe, expect, it } from 'vitest'
import { resolveCommandArgs, type RawCommandArgs } from '../src/launcher/args.ts'
import { createCrawlerFactory } from '../src/crawler/registry.ts'
import type { AbstractCrawler, DataSink } from '../src/crawler/contract.ts'
import type { BrowserSession } from '../src/browser/contract.ts'
import { CrawlerError } from '../src/errors.ts'
import { fakeSession } from './helpers/session.ts'

// 启动器验收（design/modules/launcher.md）：未知平台在创建爬取器前报错；
// 模式专属必填项与 cookie 凭证缺失拒绝；正整数守卫生效。
// Launcher acceptance (design launcher.md): unknown platforms fail before
// crawler creation; mode fields and cookie credentials are required;
// positive-int guards hold.
const base: RawCommandArgs = {
  platform: 'xhs',
  loginType: 'qrcode',
  crawlerType: 'search',
  keywords: ['美食'],
  getComment: true,
  getSubComment: false,
  getMedia: false,
  cookies: null,
  headless: false,
}

const defaults = { loginType: 'qrcode', crawlerType: 'search', platform: 'xhs' } as const

describe('resolveCommandArgs', () => {
  it('fills defaults and positive-int guards', () => {
    const args = resolveCommandArgs({ ...base, startPage: undefined, crawlerMaxNotesCount: undefined }, defaults)
    expect(args.startPage).toBe(1)
    expect(args.crawlerMaxNotesCount).toBe(1)
    expect(args.maxConcurrencyNum).toBe(1)
  })

  it('rejects unknown platform', () => {
    expect(() => resolveCommandArgs({ ...base, platform: 'twitter' }, defaults)).toThrowError(CrawlerError)
    try {
      resolveCommandArgs({ ...base, platform: 'twitter' }, defaults)
    } catch (error) {
      expect((error as CrawlerError).code).toBe('INVALID_PLATFORM')
    }
  })

  it('requires keywords for search mode', () => {
    expect(() => resolveCommandArgs({ ...base, keywords: [] }, defaults)).toThrowError(/keywords/)
  })

  it('requires specifiedId for detail mode and creatorId for creator mode', () => {
    expect(() => resolveCommandArgs({ ...base, crawlerType: 'detail' }, defaults)).toThrowError(/specifiedId/)
    expect(() => resolveCommandArgs({ ...base, crawlerType: 'creator' }, defaults)).toThrowError(/creatorId/)
  })

  it('requires cookies for cookie login', () => {
    expect(() => resolveCommandArgs({ ...base, loginType: 'cookie', cookies: null }, defaults)).toThrowError(/cookies/)
    expect(() => resolveCommandArgs({ ...base, loginType: 'cookie', cookies: 'web_session=1' }, defaults)).not.toThrow()
  })

  it('rejects non-positive integers', () => {
    expect(() => resolveCommandArgs({ ...base, startPage: 0 }, defaults)).toThrowError(/startPage/)
  })
})

describe('crawler registry', () => {
  it('throws INVALID_PLATFORM for unregistered platforms before any data is produced', () => {
    const factory = createCrawlerFactory({})
    try {
      factory('wb')
      expect.unreachable()
    } catch (error) {
      const err = error as CrawlerError
      expect(err.code).toBe('INVALID_PLATFORM')
      expect(err.message).toContain('wb')
      expect(err.fields.supported).toContain('zhihu')
    }
  })

  it('returns the registered crawler', () => {
    const stub: AbstractCrawler = {
      platform: 'zhihu',
      run: async () => {},
      search: async () => {},
      detail: async () => {},
      creator: async () => {},
    }
    const factory = createCrawlerFactory({ zhihu: stub })
    expect(factory('zhihu')).toBe(stub)
  })
})

describe('data sink isolation', () => {
  it('crawlers hand data over through the sink only', async () => {
    const handed: string[] = []
    const sink: DataSink = {
      content: async (item) => {
        handed.push(item.id)
      },
      comment: async () => {},
    }
    const stub: AbstractCrawler = {
      platform: 'wb',
      run: async (_session, s) => {
        await s.content({ id: 'n1', creatorId: 'u', nickname: '张三' })
      },
      search: async () => {},
      detail: async () => {},
      creator: async () => {},
    }
    await stub.run(fakeSession(), sink)
    expect(handed).toEqual(['n1'])
  })
})
