/**
 * xhs 爬取器：搜索/详情模式，xsec_token 随内容入库供详情复用
 * （design/modules/crawler.md §5：xhs 本地纯算法库签名——签名头四件套）。
 * The xhs crawler: search/detail modes; xsec_token persisted with contents
 * for detail reuse (crawler.md §5: local pure-algo signing — the
 * four-piece signature headers).
 *
 * 签名脚本通过 evaluate 通道在页面内运行（`getXhsHeaders(keyword)` 从页面
 * 环境产出签名头四件套）；签名脚本内容由数据工作填充，本爬取器只预留
 * 通道并处理签名失败的失败分支。
 * The signing script runs in-page via the evaluate channel (`getXhsHeaders`
 * produces the four-piece headers from the page environment); the script
 * content is data work — this crawler reserves the channel and handles
 * signing failure.
 *
 * @module @veren/crawler/platform/xhs/crawler
 */
import { BaseCrawler, type BaseCrawlerDeps } from '../../crawler/base.ts'
import { runCrawlLoop } from '../../crawler/engine.ts'

import type { CrawledPage, DataSink, Platform, RawItem } from '../../crawler/contract.ts'
import { CrawlerError } from '../../errors.ts'
import { parseXhsSearchResponse, xhsHasMore } from './parse.ts'

/** 搜索接口地址 / the search endpoint */
const SEARCH_URL = 'https://edith.xiaohongshu.com/api/sns/web/v1/search/notes?keyword={keyword}&page={page}&page_size=20'

/** JSON 获取抽象（测试注入或会话内取数）/ the json-fetch abstraction (injected in tests or the in-session request) */
export type FetchJson = (url: string) => Promise<unknown>

/** 签名头四件套（时间戳、签名、公共头、追踪 id）/ the four-piece signature headers */
export interface XhsSignHeaders {
  timestamp: string
  sign: string
  common: string
  traceId: string
}

/** 签名头产出函数：页面内 evaluate 运行签名脚本 / the header factory: runs the signing script in-page via evaluate */
export type XhsSignProducer = (keyword: string) => Promise<XhsSignHeaders>

/** xhs 爬取器构造依赖 / xhs crawler construction dependencies */
export interface XhsCrawlerOptions {
  fetchJson: (url: string, headers: XhsSignHeaders) => Promise<unknown>
  /** 签名头产出（evaluate 通道注入；未注入则搜索报错）/ the header producer (injected via evaluate; throws when absent) */
  signProducer: XhsSignProducer
  targets: BaseCrawlerDeps['targets']
  startPage: number
  /** 内容数量上限 / the content count cap */
  maxNotesCount: number
  /** 页间固定限频毫秒 / the fixed inter-page interval in ms */
  pageIntervalMs: number
}

/**
 * xhs 爬取器：搜索/详情模式，签名头四件套由 evaluate 通道在页面内产出。
 * The xhs crawler: search/detail modes; the four-piece signature headers
 * are produced in-page via the evaluate channel.
 */
export class XhsCrawler extends BaseCrawler {
  readonly platform: Platform = 'xhs'

  constructor(private readonly options: XhsCrawlerOptions) {
    super({
      indexUrl: 'https://www.xiaohongshu.com/',
      targets: options.targets,
      startPage: options.startPage,
    })
  }

  /** 模式分发：详情 id（note_id + xsec_token）优先 → 关键词搜索 / mode dispatch: detail ids first, else search */
  protected async crawlAll(sink: DataSink): Promise<void> {
    if (this.deps.targets.specifiedId.length > 0) {
      for (const id of this.deps.targets.specifiedId) await this.detail(id, sink)
      return
    }
    for (const keyword of this.keywords) await this.search(keyword, sink)
  }

  /** 搜索模式：签名 → 引擎循环 / search mode: sign → engine loop */
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

  /** 抓取并整形一页签名搜索结果 / fetches and shapes one signed search page */
  private async fetchSearchPage(keyword: string, cursor: { page: number | null }): Promise<CrawledPage> {
    const page = cursor.page ?? 1
    const headers = await this.produceSignHeaders(keyword)
    const url = SEARCH_URL
      .replace('{keyword}', encodeURIComponent(keyword))
      .replace('{page}', String(page))
    const payload = await this.options.fetchJson(url, headers)
    const items: RawItem[] = parseXhsSearchResponse(payload)
    return { items, hasMore: xhsHasMore(payload), next: { page: page + 1, cursor: null, sessionId: null } }
  }

  /** 签名头产出（未注入则 fail loud）/ produces the sign headers (fails loud when absent) */
  private async produceSignHeaders(keyword: string): Promise<XhsSignHeaders> {
    if (this.options.signProducer === undefined) {
      throw new Error('xhs 签名脚本未注入（evaluate 通道可产出）')
    }
    return await this.options.signProducer(keyword)
  }

  /** 详情模式：依赖搜索结果带出的 xsec_token（§5 平台差异）/ detail mode: depends on xsec_token from search (§5) */
  async detail(id: string, sink: DataSink): Promise<void> {
    throw new CrawlerError('CONTENT_NOT_FOUND', 'xhs 详情依赖搜索带出的 xsec_token，请通过搜索模式采集', { id })
  }

  /** 创作者模式：按创作者关键词兜底 / creator mode: falls back to keyword search */
  async creator(creatorId: string, sink: DataSink): Promise<void> {
    await this.search(creatorId, sink)
  }
}
