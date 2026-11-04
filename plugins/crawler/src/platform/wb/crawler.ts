/**
 * 微博爬取器：无加密签名、双站 Cookie、长文补全文（design/modules/crawler.md §5）。
 * The weibo crawler: no encrypted signature, dual-site cookies, long-post
 * full-text completion (crawler.md §5).
 *
 * 签名路线：Cookie 会话即可；详情长文通过移动端接口补齐；搜索页推进
 * 走统一引擎循环。
 * Signature route: a cookie session suffices; long posts complete through
 * the mobile endpoint; search paging rides the unified engine loop.
 *
 * @module @veren/crawler/platform/wb/crawler
 */
import { BaseCrawler, type BaseCrawlerDeps } from '../../crawler/base.ts'
import { runCrawlLoop } from '../../crawler/engine.ts'
import type { CrawledPage, DataSink, Platform, PageCursor, RawItem } from '../../crawler/contract.ts'
import { parseWbSearchResponse, wbHasMore } from './parse.ts'
import { collectWbComments } from './comments.ts'

/** 搜索接口地址模板 / the search endpoint template */
const SEARCH_URL = 'https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D1%26q%3D{query}&page_type=searchall&page={page}'

/** 详情接口地址模板 / the detail endpoint template */
const DETAIL_URL = 'https://m.weibo.cn/statuses/show?id={id}'

/** JSON 获取抽象（测试注入或浏览器内执行）/ the json-fetch abstraction (injected in tests or run in-browser) */
export type FetchJson = (url: string) => Promise<unknown>

/** 微博爬取器构造依赖 / weibo crawler construction dependencies */
export interface WbCrawlerOptions {
  fetchJson: FetchJson
  launchSession: BaseCrawlerDeps['launchSession']
  probeLoggedIn: BaseCrawlerDeps['probeLoggedIn']
  login: BaseCrawlerDeps['login']
  targets: BaseCrawlerDeps['targets']
  startPage: number
  /** 内容数量上限 / the content count cap */
  maxNotesCount: number
  /** 页间固定限频毫秒 / the fixed inter-page interval in ms */
  pageIntervalMs: number
  /** 长文补全文地址构造 / the long-post full-text url builder */
  fullTextUrl?: (id: string) => string
  /** 评论伴随采集开关（默认关）/ the companion-comment switch (off by default) */
  enableComments?: boolean
  /** 单条内容评论上限 / the comment cap per content */
  maxCommentsCount?: number
}

/** 长文补全文（isLongText 时取完整正文，§5 平台差异）/ completes a long post's full text (§5 platform difference) */
async function completeLongText(fetchJson: FetchJson, item: RawItem, fullTextUrl?: (id: string) => string): Promise<RawItem> {
  if (fullTextUrl === undefined) return item
  const payload = (await fetchJson(fullTextUrl(item.id))) as { data?: { longTextContent?: string; isLongText?: boolean } }
  const full = payload.data?.longTextContent
  if (payload.data?.isLongText === true && typeof full === 'string') return { ...item, desc: full }
  return item
}

/**
 * 微博爬取器：搜索/详情/创作者三模式共享 Cookie 会话。
 * The weibo crawler: the three modes share the cookie session.
 */
export class WbCrawler extends BaseCrawler {
  readonly platform: Platform = 'wb'

  constructor(private readonly options: WbCrawlerOptions) {
    super({
      launchSession: options.launchSession,
      indexUrl: 'https://m.weibo.cn/',
      probeLoggedIn: options.probeLoggedIn,
      login: options.login,
      targets: options.targets,
      startPage: options.startPage,
    })
  }

  /** 模式分发：有详情目标走详情，有创作者走创作者，否则搜索 / mode dispatch: detail ids first, then creators, else search */
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

  /** 搜索模式：接口分页 → 解析 → 长文补全 → 引擎循环 / search mode: paged endpoint → parse → full text → engine loop */
  async search(keyword: string, sink: DataSink): Promise<void> {
    await runCrawlLoop(
      async (_target, cursor) => await this.fetchSearchPage(keyword, cursor, sink, this.options),
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

  /** 抓取并整形一页搜索结果（评论伴随采集）/ fetch and shape one page of search results (companion comments) */
  private async fetchSearchPage(keyword: string, cursor: PageCursor, sink: DataSink, options: WbCrawlerOptions): Promise<CrawledPage> {
    const page = cursor.page ?? 1
    const payload = await options.fetchJson(SEARCH_URL.replace('{query}', encodeURIComponent(keyword)).replace('{page}', String(page)))
    const raw = parseWbSearchResponse(payload)
    const items: RawItem[] = []
    for (const item of raw) {
      items.push(await completeLongText(options.fetchJson, item, options.fullTextUrl))
    }
    // 评论伴随采集：开关控制，失败只影响该条的评论不中断内容（验收 4）。
    // Companion comments: switch-gated; a failure costs only this item's
    // comments, never the contents (acceptance 4).
    if (options.enableComments === true) {
      for (const item of items) {
        await collectWbComments({
          contentId: item.id,
          fetchJson: options.fetchJson,
          sink,
          maxCount: options.maxCommentsCount ?? 10,
        }).catch(() => undefined)
      }
    }
    return { items, hasMore: wbHasMore(payload), next: { page: page + 1, cursor: null, sessionId: null } }
  }

  /** 详情模式：单条正文（评论开关由上层控制）/ detail mode: one post (comments gated upstream) */
  async detail(id: string, sink: DataSink): Promise<void> {
    const payload = await this.options.fetchJson(DETAIL_URL.replace('{id}', id))
    const items = parseWbSearchResponse({ data: { cards: [{ mblog: payload as never }] } })
    for (const raw of items) await sink.content(raw)
  }

  /** 创作者模式：作者主页时间线分页（接口与搜索同容器族）/ creator mode: the author timeline pages */
  async creator(creatorId: string, sink: DataSink): Promise<void> {
    await runCrawlLoop(
      async (_target, cursor) => {
        const page = cursor.page ?? 1
        const payload = await this.options.fetchJson(`https://m.weibo.cn/api/container/getIndex?type=uid&value=${creatorId}&containerid=107603${creatorId}&page=${page}`)
        const items = parseWbSearchResponse(payload)
        return { items, hasMore: wbHasMore(payload), next: { page: page + 1, cursor: null, sessionId: null } }
      },
      sink,
      {
        target: creatorId,
        startPage: this.startPage,
        maxNotesCount: this.options.maxNotesCount,
        pageIntervalMs: this.options.pageIntervalMs,
        maxConcurrencyNum: 1,
      },
    )
  }
}
