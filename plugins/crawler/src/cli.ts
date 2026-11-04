/**
 * 采集进程命令行入口：控制服务以子进程方式拉起（design/modules/launcher.md）。
 * The crawl process command-line entry: spawned as a subprocess by the
 * control service (design/modules/launcher.md).
 *
 * 控制服务与本入口的唯一耦合是命令行参数约定：单参数 JSON（启动请求）。
 * The only coupling between the control service and this entry is the argv
 * contract: one JSON argument (the start request).
 *
 * 全链路：解析参数 → 采集管线（爬取器 → 整形脱敏 → 介质落盘）。
 * The full chain: parse args → crawl pipeline (crawler → shape/mask →
 * medium persistence).
 *
 * @module @veren/crawler/cli
 */
import { chromium as playwrightChromium } from 'playwright-core'
import type { PlaywrightLike } from './browser/contract.ts'
import { DEFAULT_CONFIG } from './config.ts'
import { CrawlerError } from './errors.ts'
import { createDualModeLauncher } from './browser/launcher.ts'
import { userDataDirOf } from './auth/flow.ts'
import { runPipeline, type PipelineDeps } from './pipeline.ts'
import type { CrawlerRunRequest } from './control/runner.ts'
import type { BrowserSession } from './browser/contract.ts'

/** 默认页间限频毫秒 / the default inter-page interval in ms */
const PAGE_INTERVAL_MS = 2000

/** 宿主 fetch 的 JSON 获取实现（微博公开接口可用）/ the host-fetch json implementation (works for weibo public endpoints) */
async function hostFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  return (await response.json()) as unknown
}

/** 真实浏览器会话工厂：标准持久化启动（平台隔离目录）/ the real browser-session factory: standard persistent launch (platform-isolated dir) */
async function launchSession(request: CrawlerRunRequest): Promise<BrowserSession> {
  // 库边界适配：playwright-core 的结构面与本插件契约在发射类型上存在
  // 泛型方差，仅在 CLI 装配这一处收口转换。
  // Library-seam adapter: playwright-core's structural surface differs in
  // generic variance from the plugin contract; converted only here.
  const playwright = {
    chromium: playwrightChromium,
  } as unknown as PlaywrightLike
  return await createDualModeLauncher(playwright)({
    mode: 'standard',
    cdpPort: 9222,
    userDataDir: userDataDirOf(request.platform),
    headless: request.headless,
    proxyUrl: null,
    userAgent: null,
  })
}

/**
 * 管线依赖（真实形态）：浏览器会话 + 宿主 fetch + 默认探测命中。
 * The real pipeline dependencies: browser sessions, host fetch, and the
 * default probe hit.
 */
function realDeps(request: CrawlerRunRequest): PipelineDeps {
  return {
    fetchJson: hostFetchJson,
    launchSession: async () => await launchSession(request),
  }
}

/** CLI 主流程：解析 → 管线 → 退出码 / the CLI main flow: parse → pipeline → exit code */
async function main(argv: string[]): Promise<number> {
  const request = JSON.parse(argv[0] ?? '{}') as CrawlerRunRequest
  return await runPipeline(request, realDeps(request), DEFAULT_CONFIG.dataRoot)
}

/** 入口：错误统一兜底为退出码 1 / entry: every error bottoms out as exit code 1 */
async function bootstrap(): Promise<void> {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    if (error instanceof CrawlerError) {
      console.log(`[ERROR] ${error.code}: ${error.message}`)
    } else {
      console.log(`[ERROR] ${String(error)}`)
    }
    process.exitCode = 1
  }
}

void bootstrap()
