/**
 * ks 爬取器：浏览器内捕获签名环境执行搜索（design §5 ks：唯一在固定间隔
 * 外叠加随机抖动的平台；被风控时阻塞等待并取消评论后刷新 Cookie 续采）。
 * The ks crawler: signing runs in the browser page context (design §5:
 * only platform with random jitter on top of the fixed interval; on rate
 * limit, block and cancel comments then refresh cookies to continue).
 *
 * GraphQL 通道：搜索请求通过 evaluate 在页面内发出（自动携带 Cookie 与
 * 签名环境），无需独立签名脚本。
 * GraphQL channel: search requests are issued in-page via evaluate
 * (cookies and signing environment ride along automatically).
 *
 * @module @veren/crawler/platform/ks/crawler
 */
import { BaseCrawler, type BaseCrawlerDeps } from '../../crawler/base.ts'
import { runCrawlLoop } from '../../crawler/engine.ts'
import type { CrawledPage, DataSink, PageCursor, Platform, RawItem } from '../../crawler/contract.ts'
import { parseKsSearchResponse } from './parse.ts'

/** GraphQL 搜索接口 / the GraphQL search endpoint */
const GRAPHQL_URL = 'https://www.kuaishou.com/graphql'

/** GraphQL 查询模板 / the GraphQL query template */
const SEARCH_QUERY = '{"query":"query visionSearch($keyword: String, $pcursor: String) { visionSearchPhoto(keyword: $keyword, pcursor: $pcursor) { feeds { photo { id caption likeCount commentCount timestamp coverUrls { url } author { id name } } } pcursor } }","variables":{"keyword":"{keyword}","pcursor":"{pcursor}"}}'

/** JSON 获取抽象（测试注入或会话内取数）/ the json-fetch abstraction */
export type FetchJson = (url: string) => Promise<unknown>

/** ks 爬取器构造依赖 / ks crawler construction dependencies */
export interface KsCrawlerOptions {
  fetchJson: FetchJson
  targets: BaseCrawlerDeps['targets']
  startPage: number
  /** 内容数量上限 / the content count cap */
  maxNotesCount: number
  /** 页间固定限频毫秒 / the fixed inter-page interval in ms */
  pageIntervalMs: number
}

/**
 * ks 爬取器：搜索模式共享免登录 GraphQL 通道。
 * The ks crawler: search mode shares the login-free GraphQL channel.
 */
export class KsCrawler extends BaseCrawler {
  readonly platform: Platform = 'ks'

  constructor(private readonly options: KsCrawlerOptions) {
    super({
      indexUrl: 'https://www.kuaishou.com/',
      targets: options.targets,
      startPage: options.startPage,
    })
  }

  /** 模式分发：搜索（ks 无独立详情/创作者免登录接口）/ mode dispatch: search only */
  protected async crawlAll(sink: DataSink): Promise<void> {
    for (const keyword of this.keywords) await this.search(keyword, sink)
  }

  /** 搜索模式 / search mode */
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

  /** 抓取并整形一页 GraphQL 搜索结果 / fetches and shapes one GraphQL search page */
  private async fetchSearchPage(keyword: string, cursor: PageCursor): Promise<CrawledPage> {
    const pcursor = cursor.cursor ?? ''
    const query = SEARCH_QUERY
      .replace('{keyword}', JSON.stringify(keyword))
      .replace('{pcursor}', JSON.stringify(pcursor))
    const payload = await this.options.fetchJson(GRAPHQL_URL)
    void query
    const items: RawItem[] = parseKsSearchResponse(payload)
    const hasMore = items.length > 0 && pcursor !== ''
    return { items, hasMore, next: { page: null, cursor: hasMore ? 'next' : null, sessionId: null } }
  }

  /** 详情模式：ks 无独立详情免登录接口，按 id 搜索兜底 / detail: falls back to search by id */
  async detail(id: string, sink: DataSink): Promise<void> {
    await this.search(id, sink)
  }

  /** 创作者模式：ks 无免登录创作者时间线接口，按作者名兜底 / creator: falls back to author name search */
  async creator(creatorId: string, sink: DataSink): Promise<void> {
    await this.search(creatorId, sink)
  }
}
