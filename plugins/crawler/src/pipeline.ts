/**
 * 采集管线：会话 → 登录 → 平台爬取器 → 数据汇 → 宿主存储域的全链路装配。
 * The crawl pipeline: session → login → platform crawler → data sink →
 * host storage domain, assembled end to end.
 *
 * 会话与登录是管线的职责（铁律 1「先凭证后请求」）：先建浏览器会话，
 * 探测/登录通过后才允许发出任何业务请求；会话在成功与失败路径上都会关闭。
 * 存储只认宿主 storageDomain（文件/数据库介质归 dsh 其他插件）。
 * The pipeline owns the session and the login (invariant 1, "credentials
 * before requests"): the browser session comes first, business requests only
 * start after a passing probe/login, and the session closes on both paths.
 * Storage is the host storageDomain only (file/database media belong to
 * other dsh plugins).
 *
 * @module @veren/crawler/pipeline
 */
import { CrawlerError, invalidPlatform } from './errors.ts'
import { runLoginFlow } from './auth/flow.ts'
import { persistLoginState } from './auth/persist.ts'
import { createSessionFetchJson } from './browser/context-fetch.ts'
import { createPlatformAuth, type PlatformAuth } from './platform/login.ts'
import { report } from './runner/report.ts'
import { StoreSink } from './sink.ts'
import { WbCrawler, type FetchJson } from './platform/wb/crawler.ts'
import { TiebaCrawler } from './platform/tieba/crawler.ts'
import { BiliCrawler } from './platform/bili/crawler.ts'
import type { AbstractCrawler } from './crawler/contract.ts'
import type { BrowserSession } from './browser/contract.ts'
import type { CrawlerRunRequest } from './control/runner.ts'
import type { CrawlerStore } from './store/domain.ts'
import type { CancelFlag } from './runner/inprocess-runner.ts'
import type { Platform } from './types.ts'

/** 平台注册表：当前已接入的平台 / the platform registry: currently wired platforms */
const WIRED_PLATFORMS: readonly Platform[] = ['wb', 'tieba', 'bili']

/** 管线可注入依赖 / the injectable pipeline dependencies */
export interface PipelineDeps {
  /** 浏览器会话工厂 / the browser-session factory */
  launchSession: () => Promise<BrowserSession>
  /** 会话取数覆写（测试注入；缺省用会话内请求）/ the session-fetch override (tests; the in-context request by default) */
  fetchJson?: FetchJson
  /** 登录面覆写（测试注入；缺省按平台造）/ the login-face override (tests; built per platform by default) */
  auth?: PlatformAuth
  /** 评论页 HTML 获取（tieba 渲染页）/ the raw-text fetch for tieba comment pages */
  fetchText?: (url: string) => Promise<string>
  /** 浏览器档案根目录（登录态摘要落盘位置）/ the profile root (where the login summary lands) */
  profileRoot?: string
}

/** 管线运行选项 / the pipeline run options */
export interface PipelineRunOptions {
  /** 已打开的宿主存储域 / the opened host storage domain */
  domain?: CrawlerStore
  /** 协作式取消标记（进程内运行器注入）/ the cooperative-cancel flag (injected by the in-process runner) */
  cancelFlag?: CancelFlag
}

/** 未接入平台在启动浏览器之前拒绝 / unwired platforms are rejected before the browser launch */
function assertWiredPlatform(platform: Platform): void {
  if (!(WIRED_PLATFORMS as readonly string[]).includes(platform)) throw invalidPlatform(platform)
}

/** 平台爬取器实例化（未接入平台抛 INVALID_PLATFORM）/ instantiates a platform crawler (unwired platforms throw INVALID_PLATFORM) */
export function createPlatformCrawler(request: CrawlerRunRequest, fetchJson: FetchJson, fetchText?: (url: string) => Promise<string>): AbstractCrawler {
  assertWiredPlatform(request.platform)
  if (request.platform === 'bili') {
    return new BiliCrawler({
      fetchJson,
      targets: {
        keywords: request.keywords,
        specifiedId: request.specifiedIds,
        creatorId: request.creatorIds,
      },
      startPage: request.startPage,
      maxNotesCount: request.maxNotesCount,
      pageIntervalMs: 2000,
    })
  }
  if (request.platform === 'tieba') {
    return new TiebaCrawler({
      fetchJson,
      fetchText,
      enableComments: request.enableComments,
      maxCommentsCount: request.maxCommentsCount,
      targets: {
        keywords: request.keywords,
        specifiedId: request.specifiedIds,
        creatorId: request.creatorIds,
      },
      startPage: request.startPage,
      maxNotesCount: request.maxNotesCount,
      pageIntervalMs: 2000,
    })
  }
  return new WbCrawler({
    fetchJson,
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

/** 登录前置：探测 → 登录 → 持久化；未登录即抛错，绝不带未登录状态采集 / login prerequisite: probe, login, persist; throws when not logged in */
async function loginBeforeCrawl(request: CrawlerRunRequest, deps: PipelineDeps, auth: PlatformAuth): Promise<void> {
  const probe = await auth.probe()
  if (probe.loggedIn) {
    report(`登录探测命中（${probe.probeMethod}），跳过登录 / probe hit, skipping login`)
    return
  }
  if (request.loginType === 'cookie') {
    report('Cookie 登录：注入后复验 / cookie login: injecting, then re-probing')
  } else {
    report('等待扫码登录：请在弹出的浏览器窗口完成（最多 300 秒）/ waiting for the scan in the opened browser (max 300s)')
  }
  const flow = await runLoginFlow({
    loginType: request.loginType,
    cookies: request.cookies,
    login: auth.login,
    probe: auth.probe,
    persist: persistLoginState,
    ...(deps.profileRoot === undefined ? {} : { profileRoot: deps.profileRoot }),
  })
  if (flow.state !== 'logged_in') {
    throw new CrawlerError('LOGIN_TIMEOUT', '登录流程未完成，采集已放弃', { platform: request.platform })
  }
  report('登录完成，登录态已写入浏览器档案 / login done, session persisted into the browser profile')
}

/** 采集一段：建数据汇 → 爬取（存储域由管线持有，缺域 fail loud）/ the crawl segment: sink, crawl (the domain is pipeline-owned; missing fails loud) */
async function crawlWithSink(
  request: CrawlerRunRequest,
  deps: PipelineDeps,
  session: BrowserSession,
  domain: CrawlerStore,
): Promise<number> {
  const crawler = createPlatformCrawler(request, deps.fetchJson ?? createSessionFetchJson(session), deps.fetchText)
  const sink = new StoreSink({
    platform: request.platform,
    sourceKeyword: request.keywords[0] ?? null,
    domain,
  })
  await crawler.run(session, sink)
  // 收尾如实报数：0 条也要说出来（静默空结果是最难查的故障）。
  // Honest closing counts, zeros included (a silent empty result is the
  // hardest failure to diagnose).
  report(
    `落库完成：内容 ${sink.contentsWritten} 条，评论 ${sink.commentsWritten} 条 / ` +
      `persisted ${sink.contentsWritten} contents, ${sink.commentsWritten} comments`,
  )
  return 0
}

/**
 * 全链路运行：会话 → 登录 → 采集 → 会话清理。存储域必须已打开。
 * Runs the full chain: session → login → crawl → session cleanup. The
 * storage domain must be open.
 */
export async function runPipeline(
  request: CrawlerRunRequest,
  deps: PipelineDeps,
  options: PipelineRunOptions = {},
): Promise<number> {
  if (options.domain === undefined) {
    throw new CrawlerError('DB_CONNECT_FAILED', '宿主存储域未打开，无法落库', {})
  }
  assertWiredPlatform(request.platform)
  report(`启动采集：平台=${request.platform} 模式=${request.crawlerType} 登录=${request.loginType} 无头=${request.headless}`)
  const session = await deps.launchSession()
  try {
    const auth = deps.auth ?? createPlatformAuth(request.platform, session, request)
    await loginBeforeCrawl(request, deps, auth)
    const code = await crawlWithSink(request, deps, session, options.domain)
    report('采集结束 / crawl finished')
    return code
  } finally {
    await session.close().catch(() => undefined)
  }
}
