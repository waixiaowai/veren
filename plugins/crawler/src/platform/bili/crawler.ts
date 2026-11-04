/**
 * B 站爬取器：纯算法 WBI 签名（搜索免登录），按日期区间逐日构造搜索窗口
 * 的能力留待后续（design/modules/crawler.md §5 bili 差异条目）。
 * The bilibili crawler: pure-algorithm WBI signing (login-free search); the
 * per-day search-window capability lands later (crawler.md §5 bili).
 *
 * 每次搜索先取 nav 密钥 → 签名查询 → 引擎循环。会话生命周期归管线。
 * Each search fetches the nav keys first → signs the query → engine loop.
 * The session lifecycle belongs to the pipeline.
 *
 * @module @veren/crawler/platform/bili/crawler
 */
import { BaseCrawler, type BaseCrawlerDeps } from '../../crawler/base.ts'
import { runCrawlLoop } from '../../crawler/engine.ts'
import type { CrawledPage, DataSink, PageCursor, Platform, RawItem } from '../../crawler/contract.ts'
import { mixinKeyOf, signWbiQuery, wbiKeysFromNav, type WbiKeys } from './wbi.ts'
import { parseBiliSearchResponse, biliHasMore, biliErrorCode } from './parse.ts'
import { CrawlerError } from '../../errors.ts'

/** 搜索接口地址 / the search endpoint */
const SEARCH_URL = 'https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword={keyword}&page={page}&wts={wts}&w_rid={w_rid}'
/** 密钥接口地址 / the nav endpoint */
const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav'
/** Cookie 预热接口（激活 buvid3/buvid4）/ the cookie warm-up endpoint (activates buvid3/buvid4) */
const SPI_URL = 'https://api.bilibili.com/x/frontend/finger/spi'

/** JSON 获取抽象（测试注入或会话内取数）/ the json-fetch abstraction (injected in tests or the in-session request) */
export type FetchJson = (url: string) => Promise<unknown>

/** 贴吧/B 站公共构造依赖 / shared crawler construction dependencies */
export interface BiliCrawlerOptions {
  fetchJson: FetchJson
  targets: BaseCrawlerDeps['targets']
  startPage: number
  /** 内容数量上限 / the content count cap */
  maxNotesCount: number
  /** 页间固定限频毫秒 / the fixed inter-page interval in ms */
  pageIntervalMs: number
}

/**
 * B 站爬取器：搜索/详情/创作者三模式共享 WBI 签名通道。
 * The bilibili crawler: the three modes share the WBI-signed channel.
 */
export class BiliCrawler extends BaseCrawler {
  readonly platform: Platform = 'bili'

  constructor(private readonly options: BiliCrawlerOptions) {
    super({
      indexUrl: 'https://www.bilibili.com/',
      targets: options.targets,
      startPage: options.startPage,
    })
  }

  /** 模式分发：详情 id（bvid）优先 → 创作者 → 关键词搜索 / mode dispatch: bvid ids first, then creators, else search */
  protected async crawlAll(sink: DataSink): Promise<void> {
    if (this.deps.targets.specifiedId.length > 0) {
      for (const id of this.deps.targets.specifiedId) await this.detail(id, sink)
      return
    }
    if (this.deps.targets.creatorId.length > 0) {
      for (const creatorId of this.deps.targets.creatorId) await this.creator(creatorId, sink)
      return
    }
    for (const keyword of this.keywords) await this.search(keyword, sink)
  }

  /** 搜索模式：Cookie 预热（spi 激活 buvid）→ 密钥 → 签名 → 引擎循环 / search mode: cookie warm-up (spi activates buvid) → keys → sign → engine loop */
  async search(keyword: string, sink: DataSink): Promise<void> {
    await this.warmUpCookies()
    const keys = await this.fetchKeys()
    await runCrawlLoop(
      async (_target, cursor) => await this.fetchSearchPage(keyword, cursor, keys),
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

  /** Cookie 预热：spi 激活 buvid（Set-Cookie 落进会话上下文，搜索才不空手而归）/ cookie warm-up: spi activates buvid (the set-cookies land in the session context; without it search returns empty) */
  private async warmUpCookies(): Promise<void> {
    try {
      await this.options.fetchJson(SPI_URL)
    } catch {
      // 预热失败不终止：搜索仍会尝试，失败码会在业务码检查处显式上抛 / a warm-up failure never aborts: search still tries, and failures surface at the business-code check
    }
  }

  /** 取 WBI 密钥（nav 免登录）/ fetches the wbi keys (nav is login-free) */
  private async fetchKeys(): Promise<WbiKeys> {
    const payload = await this.options.fetchJson(NAV_URL)
    const keys = wbiKeysFromNav(payload)
    if (keys === null) {
      const { CrawlerError } = await import('../../errors.ts')
      throw new CrawlerError('PLATFORM_ACCESS_DENIED', 'B 站 nav 接口未返回 WBI 密钥', { url: NAV_URL })
    }
    return keys
  }

  /** 抓取并整形一页签名搜索结果；业务码非零按限频折错（重试语义归引擎）/ fetches and shapes one signed page; a nonzero business code folds into a rate-limit error (retry semantics belong to the engine) */
  private async fetchSearchPage(keyword: string, cursor: PageCursor, keys: WbiKeys): Promise<CrawledPage> {
    const page = cursor.page ?? 1
    const signed = signWbiQuery({ keyword, page: String(page) }, mixinKeyOf(keys), Math.floor(Date.now() / 1000))
    const url = SEARCH_URL
      .replace('{keyword}', encodeURIComponent(keyword))
      .replace('{page}', String(page))
      .replace('{wts}', String(signed.wts))
      .replace('{w_rid}', signed.wRid)
    const payload = await this.options.fetchJson(url)
    const bizCode = biliErrorCode(payload)
    if (bizCode !== null) {
      // -412 = 风控/限频（重试退避）；其余码同样折成 RATE_LIMITED 上抛归引擎 / -412 is risk-control (backoff retry); other codes fold into RATE_LIMITED for the engine
      throw new CrawlerError('RATE_LIMITED', `B 站搜索业务码 ${bizCode}`, { code: String(bizCode) })
    }
    const items: RawItem[] = parseBiliSearchResponse(payload)
    return { items, hasMore: biliHasMore(payload), next: { page: page + 1, cursor: null, sessionId: null } }
  }

  /** 详情模式：单视频（bvid）/ detail mode: one video (bvid) */
  async detail(id: string, sink: DataSink): Promise<void> {
    const payload = await this.options.fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${id}`)
    const items: RawItem[] = parseBiliSearchResponse({ data: { result: [payload as never] } })
    for (const raw of items) await sink.content(raw)
  }

  /** 创作者模式：按 UP 主搜索兜底 / creator mode: falls back to an author keyword search */
  async creator(creatorId: string, sink: DataSink): Promise<void> {
    await this.search(creatorId, sink)
  }
}
