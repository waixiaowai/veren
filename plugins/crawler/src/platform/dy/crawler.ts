/**
 * dy 爬取器骨架：本地引擎执行签名脚本，搜索需成套风控参数
 * （design/modules/crawler.md §5：dy 本地引擎执行签名脚本；设备指纹 Cookie
 * 与验证参数；评论请求需回传来源关键词上下文）。
 * The douyin crawler skeleton: local engine executes signing scripts; search
 * requires device fingerprint cookies and verification params; comment
 * requests need source keyword context (crawler.md §5).
 *
 * 签名脚本通过 evaluate 通道在页面内运行；签名脚本内容待从真实页面捕获。
 * Signing scripts run in-page via the evaluate channel; script content
 * pending capture from real pages.
 *
 * @module @veren/crawler/platform/dy/crawler
 */
import { BaseCrawler, type BaseCrawlerDeps } from '../../crawler/base.ts'
import { runCrawlLoop } from '../../crawler/engine.ts'
import { CrawlerError } from '../../errors.ts'
import type { CrawledPage, DataSink, Platform, PageCursor, RawItem } from '../../crawler/contract.ts'
import { parseDySearchResponse, dyHasMore } from './parse.ts'

/** 搜索接口地址 / the search endpoint */
const SEARCH_URL = 'https://www.douyin.com/aweme/v1/web/general/search/single/?keyword={keyword}&offset={offset}&count=20'

/** JSON 获取抽象 / the json-fetch abstraction */
export type FetchJson = (url: string) => Promise<unknown>

/** 签名结果：查询参数追加签名字段 / the sign result: query params with signature fields */
export interface DySignResult {
  msToken: string
  aBogus: string
}

/** 签名产出函数：evaluate 通道运行签名脚本 / the sign producer: runs signing script via evaluate */
export type DySignProducer = (keyword: string) => Promise<DySignResult>

/** dy 爬取器构造依赖 / dy crawler construction dependencies */
export interface DyCrawlerOptions {
  fetchJson: FetchJson
  signProducer: DySignProducer
  targets: BaseCrawlerDeps['targets']
  startPage: number
  maxNotesCount: number
  pageIntervalMs: number
}

/**
 * dy 爬取器骨架：搜索模式（签名产出 → 引擎循环）。
 * The douyin crawler skeleton: search mode (sign → engine loop).
 */
export class DyCrawler extends BaseCrawler {
  readonly platform: Platform = 'dy'

  constructor(private readonly options: DyCrawlerOptions) {
    super({
      indexUrl: 'https://www.douyin.com/',
      targets: options.targets,
      startPage: options.startPage,
    })
  }

  /** 模式分发：搜索（dy 无独立详情/创作者免登录接口）/ mode dispatch: search only */
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

  /** 抓取一页签名搜索结果 / fetches one signed search page */
  private async fetchSearchPage(keyword: string, cursor: PageCursor): Promise<CrawledPage> {
    const page = cursor.page ?? 1
    const offset = (page - 1) * 20
    const sign = await this.options.signProducer(keyword)
    const url = SEARCH_URL
      .replace('{keyword}', encodeURIComponent(keyword))
      .replace('{offset}', String(offset))
    const fullUrl = `${url}&msToken=${encodeURIComponent(sign.msToken)}&a_bogus=${encodeURIComponent(sign.aBogus)}`
    const payload = await this.options.fetchJson(fullUrl) as { status_code?: unknown } | null
    const bizCode = typeof payload === 'object' && payload !== null && payload.status_code !== undefined ? payload.status_code : null
    if (bizCode !== null && bizCode !== 0) {
      // 业务码非零上抛归引擎（风控/限频，重试退避接管）/ nonzero business code surfaces to the engine (backoff retry)
      throw new CrawlerError('RATE_LIMITED', `dy 搜索业务码 ${String(bizCode)}`, { code: String(bizCode) })
    }
    const items: RawItem[] = parseDySearchResponse(payload)
    return { items, hasMore: dyHasMoreOf(payload), next: { page: page + 1, cursor: null, sessionId: null } }
  }

  /** 详情模式：需成套风控参数（待实现）/ detail: needs device fingerprint params (pending) */
  async detail(_id: string, _sink: DataSink): Promise<void> {
    throw new CrawlerError('PLATFORM_ACCESS_DENIED', 'dy 详情需设备指纹 Cookie 与验证参数', {})
  }

  /** 创作者模式：需登录态（待实现）/ creator: needs login (pending) */
  async creator(_creatorId: string, _sink: DataSink): Promise<void> {
    throw new CrawlerError('PLATFORM_ACCESS_DENIED', 'dy 创作者采集需登录态', {})
  }
}

/** 提取响应 has_more / extracts has_more from response */
function dyHasMoreOf(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') return false
  const response = payload as { status_code?: number; data?: unknown[] }
  return response.status_code === 0 && (response.data?.length ?? 0) > 0
}
