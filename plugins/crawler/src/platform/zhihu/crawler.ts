/**
 * zhihu 爬取器：搜索模式（evaluate 签名通道产出 x-zse-96），依赖登录 Cookie
 * 中的会话键；登录后须先进入搜索页取得搜索 Cookie（design §5 zhihu 条目）。
 * The zhihu crawler: search mode with evaluate signing (x-zse-96), depends
 * on session cookies; must visit the search page first to acquire search
 * cookies (design §5 zhihu entry).
 *
 * @module @veren/crawler/platform/zhihu/crawler
 */
import { BaseCrawler, type BaseCrawlerDeps } from '../../crawler/base.ts'
import { runCrawlLoop } from '../../crawler/engine.ts'
import { CrawlerError } from '../../errors.ts'
import type { CrawledPage, DataSink, Platform, RawItem } from '../../crawler/contract.ts'
import { parseZhihuSearchResponse, zhihuHasMore } from './parse.ts'

/** 搜索接口地址 / the search endpoint */
const SEARCH_URL = 'https://www.zhihu.com/api/v4/search_v3?t=general&q={keyword}&correction=1&offset={offset}&limit=20'

/** JSON 获取抽象 / the json-fetch abstraction */
export type FetchJson = (url: string) => Promise<unknown>

/** zhihu 爬取器构造依赖 / zhihu crawler construction dependencies */
export interface ZhihuCrawlerOptions {
  fetchJson: FetchJson
  targets: BaseCrawlerDeps['targets']
  startPage: number
  /** 内容数量上限 / the content count cap */
  maxNotesCount: number
  /** 页间固定限频毫秒 / the fixed inter-page interval in ms */
  pageIntervalMs: number
}

/**
 * zhihu 爬取器：搜索模式共享免登录 JSON 通道（需搜索 Cookie 预热）。
 * The zhihu crawler: search mode shares the login-free json channel
 * (search cookie warm-up required).
 */
export class ZhihuCrawler extends BaseCrawler {
  readonly platform: Platform = 'zhihu'

  constructor(private readonly options: ZhihuCrawlerOptions) {
    super({
      indexUrl: 'https://www.zhihu.com/',
      targets: options.targets,
      startPage: options.startPage,
    })
  }

  /** 模式分发：搜索（zhihu 无独立创作者/详情免登录接口）/ mode dispatch: search only (zhihu has no login-free detail/creator endpoints) */
  protected async crawlAll(sink: DataSink): Promise<void> {
    for (const keyword of this.keywords) await this.search(keyword, sink)
  }

  /** 搜索模式：引擎循环（offset 分页）/ search mode: engine loop with offset pagination */
  async search(keyword: string, sink: DataSink): Promise<void> {
    await runCrawlLoop(
      async (_target, cursor) => await this.fetchSearchPage(keyword, cursor),
      sink,
      {
        target: keyword,
        startPage: this.startPage,
        maxNotesCount: this.options.maxNotesCount,
        pageIntervalMs: this.options.pageIntervalMs,
        maxConcurrencyNum: 1,
      },
    )
  }

  /** 抓取并整形一页搜索结果（offset = (page-1)*20）/ fetches and shapes one page (offset = (page-1)*20) */
  private async fetchSearchPage(keyword: string, cursor: { page: number | null }): Promise<CrawledPage> {
    const page = cursor.page ?? 1
    const offset = (page - 1) * 20
    const url = SEARCH_URL
      .replace('{keyword}', encodeURIComponent(keyword))
      .replace('{offset}', String(offset))
    const payload = await this.options.fetchJson(url)
    const items: RawItem[] = parseZhihuSearchResponse(payload)
    return { items, hasMore: zhihuHasMore(payload), next: { page: page + 1, cursor: null, sessionId: null } }
  }

  /** 详情模式：知乎 web 详情需 x-zse-96 签名（evaluate 通道产出），暂返回占位 / detail: needs x-zse-96 signing via evaluate, placeholder */
  async detail(_id: string, _sink: DataSink): Promise<void> {
    throw new CrawlerError('PLATFORM_ACCESS_DENIED', 'zhihu 详情需 x-zse-96 签名（evaluate 通道待接入签名脚本）', {})
  }

  /** 创作者模式：知乎 web 无免登录创作者时间线接口，按关键词兜底 / creator: falls back to keyword search */
  async creator(creatorId: string, sink: DataSink): Promise<void> {
    await this.search(creatorId, sink)
  }
}

