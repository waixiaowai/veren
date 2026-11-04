/**
 * 平台爬取器统一骨架：在已登录会话上导航首页 → 按模式分发 → 采集
 * （design/modules/crawler.md §4 主流程）。
 * The unified crawler skeleton: navigate the index on the logged-in session,
 * dispatch by mode, then crawl (the §4 main flow in crawler.md).
 *
 * 会话生命周期归管线：登录在采集之前完成，爬取器既不启动浏览器也不关闭
 * 会话，只消费一个已登录会话。
 * The session lifecycle belongs to the pipeline: login finishes before any
 * crawl, and a crawler neither launches the browser nor closes the session;
 * it only consumes a logged-in session.
 *
 * @module @veren/crawler/crawler/base
 */
import type { AbstractCrawler, DataSink, Platform } from './contract.ts'
import type { BrowserSession } from '../browser/contract.ts'

/** 骨架依赖 / the skeleton dependencies */
export interface BaseCrawlerDeps {
  /** 平台首页地址（会话建立后先导航）/ the platform index url (navigated first on the session) */
  indexUrl: string
  /** 三模式目标（关键词/内容 id/创作者 id 列表）/ the mode targets (keyword, content-id, or creator-id lists) */
  targets: { keywords: string[]; specifiedId: string[]; creatorId: string[] }
  /** 起始页码 / the starting page */
  startPage: number
}

/**
 * 平台爬取器骨架基类：七平台实现 crawlAll 注入各自的采集内核。
 * The skeleton base class: the seven platforms implement crawlAll with
 * their own crawl kernels.
 */
export abstract class BaseCrawler implements AbstractCrawler {
  abstract readonly platform: Platform

  /** 关键词集合 / the keywords */
  keywords: string[] = []
  /** 起始页码 / the starting page */
  startPage = 1

  protected constructor(protected readonly deps: BaseCrawlerDeps) {}

  /** 主流程：导航首页 → 按模式采集（会话由管线持有）/ the main flow: navigate the index, crawl by mode (the session belongs to the pipeline) */
  async run(session: BrowserSession, sink: DataSink): Promise<void> {
    await this.openIndex(session)
    this.keywords = this.deps.targets.keywords
    this.startPage = this.deps.startPage
    // 业务请求全部发生在登录之后（铁律 1，由管线保证）。
    // Every business request happens after login (invariant 1, guaranteed
    // by the pipeline).
    await this.crawlAll(sink)
  }

  /** 在会话里打开平台首页（建立站点上下文与 Cookie 作用域）/ opens the platform index in the session (site context and cookie scope) */
  private async openIndex(session: BrowserSession): Promise<void> {
    const page = await session.context.newPage()
    await page.goto(this.deps.indexUrl)
  }

  /** 三模式分发：子类按平台实现 / mode dispatch: implemented per platform */
  protected abstract crawlAll(sink: DataSink): Promise<void>

  /** 搜索模式 / search mode */
  abstract search(keyword: string, sink: DataSink): Promise<void>
  /** 详情模式 / detail mode */
  abstract detail(id: string, sink: DataSink): Promise<void>
  /** 创作者模式 / creator mode */
  abstract creator(creatorId: string, sink: DataSink): Promise<void>
}
