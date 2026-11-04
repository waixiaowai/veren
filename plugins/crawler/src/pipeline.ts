/**
 * 采集管线：启动请求 → 平台爬取器 → 数据汇 → 介质落盘的全链路装配。
 * The crawl pipeline: start request → platform crawler → data sink →
 * media persistence, assembled end to end.
 *
 * 文件介质经子进程 CLI 调用本管线；`dsh` 介质在宿主进程内跑（进程内
 * 运行器），依赖（JSON 获取、浏览器会话工厂）全部可注入，测试零网络
 * 零浏览器。
 * File media reach this pipeline through the subprocess CLI; the `dsh`
 * medium runs in-process (the in-process runner). Every dependency (json
 * fetch, browser-session factory) is injectable, so tests need no network
 * and no browser.
 *
 * @module @veren/crawler/pipeline
 */
import { invalidPlatform } from './errors.ts'
import { runLoginFlow } from './auth/flow.ts'
import type { AbstractCrawler } from './crawler/contract.ts'
import { StoreSink, assertStoreSupports } from './sink.ts'
import type { CrawlerRunRequest } from './control/runner.ts'
import { WbCrawler, type FetchJson } from './platform/wb/crawler.ts'
import type { CrawlerStore } from './store/domain.ts'
import type { CancelFlag } from './runner/inprocess-runner.ts'
import type { BrowserSession } from './browser/contract.ts'
import type { Platform } from './types.ts'

/** 平台注册表：当前已接入的平台 / the platform registry: currently wired platforms */
const WIRED_PLATFORMS: readonly Platform[] = ['wb']

/** 管线可注入依赖 / the injectable pipeline dependencies */
export interface PipelineDeps {
  /** JSON 获取（平台接口数据源）/ the json fetch (the platform data source) */
  fetchJson: FetchJson
  /** 浏览器会话工厂 / the browser-session factory */
  launchSession: () => Promise<BrowserSession>
  /** 登录探测 / the login probe */
  probeLoggedIn?: () => Promise<boolean>
  /** 登录流程 / the login flow */
  login?: () => Promise<void>
}

/** 管线运行选项 / the pipeline run options */
export interface PipelineRunOptions {
  /** 已打开的宿主存储域（`dsh` 介质必需）/ the opened host storage domain (required by the `dsh` medium) */
  domain?: CrawlerStore
  /** 协作式取消标记（进程内运行器注入）/ the cooperative-cancel flag (injected by the in-process runner) */
  cancelFlag?: CancelFlag
}

/** 平台爬取器实例化（未接入平台抛 INVALID_PLATFORM）/ instantiates a platform crawler (unwired platforms throw INVALID_PLATFORM) */
export function createPlatformCrawler(request: CrawlerRunRequest, deps: PipelineDeps): AbstractCrawler {
  if (!(WIRED_PLATFORMS as readonly string[]).includes(request.platform)) throw invalidPlatform(request.platform)
  return new WbCrawler({
    fetchJson: deps.fetchJson,
    launchSession: deps.launchSession,
    probeLoggedIn: deps.probeLoggedIn ?? (async () => true),
    login: deps.login ?? (async () => {}),
    targets: {
      keywords: request.keywords,
      specifiedId: request.specifiedIds,
      creatorId: request.creatorIds,
    },
    startPage: request.startPage,
    maxNotesCount: request.maxNotesCount,
    pageIntervalMs: 2000,
    enableComments: request.enableComments,
    maxCommentsCount: request.maxCommentsCount,
  })
}

/**
 * 全链路运行：建数据汇 → 建爬取器 → 采集 → 介质收尾。
 * Runs the full chain: build the sink, build the crawler, crawl, finalize
 * the medium.
 */
export async function runPipeline(request: CrawlerRunRequest, deps: PipelineDeps, dataRoot: string, options: PipelineRunOptions = {}): Promise<number> {
  assertStoreSupports(request.saveOption)
  const crawler = createPlatformCrawler(request, deps)
  const loginFlow = await runLoginFlow({
    loginType: request.loginType,
    cookies: request.cookies,
    login: { platform: request.platform, begin: deps.login ?? (async () => {}), loginByQrcode: async () => true, loginByMobile: async () => true, loginByCookies: deps.login ?? (async () => {}) },
    probe: async () => ({ loggedIn: (await deps.probeLoggedIn?.()) ?? true, probeMethod: 'cookie' }),
    persist: async () => {},
  })
  if (loginFlow.state !== 'logged_in') throw invalidPlatform('login-flow')
  const sink = new StoreSink({
    dataRoot,
    platform: request.platform,
    crawlerType: request.crawlerType,
    sourceKeyword: request.keywords[0] ?? null,
    saveDataOption: request.saveOption,
    domain: options.domain,
  })
  try {
    await crawler.start(sink)
    return 0
  } finally {
    await sink.finalize()
  }
}
