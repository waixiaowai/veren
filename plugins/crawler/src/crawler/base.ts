/**
 * 平台爬取器统一骨架：启动浏览器 → 校验登录 → 按模式分发 → 清理
 * （design/modules/crawler.md §4 主流程伪代码）。
 * The unified crawler skeleton: launch browser → verify login → dispatch
 * by mode → clean up (the §4 main-flow pseudocode in crawler.md).
 *
 * 铁律「先凭证后请求」：登录探测失败且登录流程被放弃时，不以未登录
 * 状态发出任何业务请求（验收 2）；成功失败都执行会话清理。
 * Invariant "credentials before requests": a failed probe with an abandoned
 * login never issues any business request (acceptance 2); cleanup runs on
 * success and failure alike.
 *
 * @module @veren/crawler/crawler/base
 */
import type { AbstractCrawler, DataSink, Platform } from './contract.ts'
import type { BrowserSession } from '../browser/contract.ts'

/** 骨架依赖 / the skeleton dependencies */
export interface BaseCrawlerDeps {
  /** 浏览器会话工厂 / the browser-session factory */
  launchSession: () => Promise<BrowserSession>
  /** 平台首页地址（会话建立后先导航）/ the platform index url (navigated once after launch) */
  indexUrl: string
  /** 登录探测 / the login probe */
  probeLoggedIn: () => Promise<boolean>
  /** 登录流程（含 Cookie 注入复验）；放弃登录抛错 / the login flow (with cookie re-verification); throws when abandoned */
  login: () => Promise<void>
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

  /** 主流程：启动 → 探测/登录 → 采集 → 清理（成功失败都清理）/ the main flow: launch, probe/login, crawl, cleanup (always) */
  async start(sink: DataSink): Promise<void> {
    const session = await this.deps.launchSession()
    try {
      await session.context.newPage().then((page) => page.goto(this.deps.indexUrl))
      if (!(await this.deps.probeLoggedIn())) {
        await this.deps.login()
      }
      this.keywords = this.deps.targets.keywords
      this.startPage = this.deps.startPage
      // 业务请求全部发生在登录探测通过之后（铁律 1）。
      // Every business request happens after a passing probe (invariant 1).
      await this.crawlAll(sink)
    } finally {
      await session.close().catch(() => undefined)
    }
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
