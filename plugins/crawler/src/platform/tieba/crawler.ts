/**
 * 贴吧爬取器：无加密签名，搜索模式按关键词采集全吧帖子列表
 * （design/modules/crawler.md §5：tieba 无加密签名；搜索模式按吧名采集
 * 吧内帖子列表）。
 * The tieba crawler: no encrypted signature; search mode collects the
 * thread list by keyword across bars (crawler.md §5).
 *
 * 数据通道：mo/q/search/thread 免登录 JSON，页码分页（current_page）；
 * 会话生命周期归管线，本爬取器只消费已登录会话。
 * Data channel: the login-free mo/q/search/thread json, paged by
 * current_page; the session lifecycle belongs to the pipeline — this
 * crawler only consumes a logged-in session.
 *
 * @module @veren/crawler/platform/tieba/crawler
 */
import { BaseCrawler, type BaseCrawlerDeps } from '../../crawler/base.ts'
import { runCrawlLoop } from '../../crawler/engine.ts'
import type { CrawledPage, DataSink, PageCursor, Platform, RawItem } from '../../crawler/contract.ts'
import { parseTiebaSearchResponse, tiebaHasMore } from './parse.ts'
import { collectTiebaComments, parseTiebaThreadDetail, type FetchText } from './comments.ts'
import { CrawlerError } from '../../errors.ts'

/** 搜索接口地址模板 / the search endpoint template */
const SEARCH_URL = 'https://tieba.baidu.com/mo/q/search/thread?word={word}&pn={page}'

/** JSON 获取抽象（测试注入或会话内取数）/ the json-fetch abstraction (injected in tests or the in-session request) */
export type FetchJson = (url: string) => Promise<unknown>

/** 贴吧爬取器构造依赖 / tieba crawler construction dependencies */
export interface TiebaCrawlerOptions {
  fetchJson: FetchJson
  /** 评论页 HTML 获取（免登录渲染页）/ the raw-text fetch for comment pages */
  fetchText?: FetchText
  targets: BaseCrawlerDeps['targets']
  startPage: number
  /** 内容数量上限 / the content count cap */
  maxNotesCount: number
  /** 页间固定限频毫秒 / the fixed inter-page interval in ms */
  pageIntervalMs: number
  /** 评论伴随采集开关（默认关）/ the companion-comment switch (off by default) */
  enableComments?: boolean
  /** 单条内容评论上限 / the comment cap per content */
  maxCommentsCount?: number
}

/**
 * 贴吧爬取器：搜索/详情/创作者三模式共享免登录 JSON 通道。
 * The tieba crawler: the three modes share the login-free json channel.
 */
export class TiebaCrawler extends BaseCrawler {
  readonly platform: Platform = 'tieba'

  constructor(private readonly options: TiebaCrawlerOptions) {
    super({
      indexUrl: 'https://tieba.baidu.com/',
      targets: options.targets,
      startPage: options.startPage,
    })
  }

  /** 模式分发：详情 id 优先 → 创作者 → 关键词搜索 / mode dispatch: detail ids first, then creators, else search */
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

  /** 搜索模式：关键词走全吧帖子搜索；评论伴随采集按开关跟随 / search mode: the keyword drives the cross-bar thread search; companion comments follow the switch */
  async search(keyword: string, sink: DataSink): Promise<void> {
    const collectedIds: string[] = []
    const recording: DataSink = {
      content: async (item) => {
        collectedIds.push(item.id)
        await sink.content(item)
      },
      comment: async (comment) => await sink.comment(comment),
    }
    await runCrawlLoop(
      async (_target, cursor) => await this.fetchSearchPage(keyword, cursor),
      recording,
      {
        target: keyword,
        startPage: this.startPage,
        maxNotesCount: this.options.maxNotesCount,
        pageIntervalMs: this.options.pageIntervalMs,
        maxConcurrencyNum: 1,
      },
    )
    // 评论伴随采集：开关控制，单帖失败不中断内容（验收 4）。
    // Companion comments: switch-gated; a failure costs only this thread's
    // comments, never the contents (acceptance 4).
    if (this.options.enableComments === true) {
      for (const id of collectedIds) {
        await collectTiebaComments({
          contentId: id,
          fetchText: this.options.fetchText ?? (async () => ''),
          sink,
          maxCount: this.options.maxCommentsCount ?? 10,
        }).catch(() => undefined)
      }
    }
  }

  /** 抓取并整形一页搜索结果 / fetches and shapes one page of search results */
  private async fetchSearchPage(keyword: string, cursor: PageCursor): Promise<CrawledPage> {
    const page = cursor.page ?? 1
    const payload = await this.options.fetchJson(SEARCH_URL.replace('{word}', encodeURIComponent(keyword)).replace('{page}', String(page)))
    const items: RawItem[] = parseTiebaSearchResponse(payload)
    return { items, hasMore: tiebaHasMore(payload), next: { page: page + 1, cursor: null, sessionId: null } }
  }

  /** 详情模式：getpb 首楼正文 + 页面标题（免登录渲染页） / detail mode: the first floor body plus the page title (login-free rendered page) */
  async detail(id: string, sink: DataSink): Promise<void> {
    if (this.options.fetchText === undefined) {
      throw new CrawlerError('CONTENT_NOT_FOUND', '贴吧详情需要 fetchText 获取渲染页', { id })
    }
    const html = await this.options.fetchText(`https://tieba.baidu.com/mo/q/getpb?kz=${id}&pn=1`)
    const detailItem = parseTiebaThreadDetail(id, html)
    if (detailItem === null) {
      throw new CrawlerError('CONTENT_NOT_FOUND', `贴吧帖子不存在或已删除: ${id}`, { id })
    }
    await sink.content(detailItem)
  }  /** 创作者模式：贴吧以吧为主题，作者维度无独立时间线接口——按关键词兜底 / creator mode: tieba has no per-author timeline api; falls back to keyword search */
  async creator(creatorId: string, sink: DataSink): Promise<void> {
    await this.search(creatorId, sink)
  }
}
