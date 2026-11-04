/**
 * 真实管线依赖：浏览器会话（CDP 优先）与宿主 fetch——CLI 与进程内运行器
 * 共用。
 * The real pipeline dependencies: browser sessions (CDP first) and host
 * fetch — shared by the CLI and the in-process runner.
 *
 * @module @veren/crawler/runner/real-deps
 */
import { chromium as playwrightChromium } from 'playwright-core'
import { createDualModeLauncher } from '../browser/launcher.ts'
import { userDataDirOf } from '../auth/flow.ts'
import type { BrowserSession, PlaywrightLike } from '../browser/contract.ts'
import type { PipelineDeps } from '../pipeline.ts'
import type { CrawlerRunRequest } from '../control/runner.ts'

/** 库边界适配：playwright-core 结构面转换只在装配处收口 / the library-seam adapter, converted only at assembly */
function playwright(): PlaywrightLike {
  return { chromium: playwrightChromium } as unknown as PlaywrightLike
}

/** 宿主 fetch 的 JSON 获取实现（微博公开接口可用）/ the host-fetch json implementation (works for weibo public endpoints) */
async function hostFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  return (await response.json()) as unknown
}

/** 浏览器会话工厂：CDP 接管优先，失败回退标准持久化启动 / the session factory: CDP attach first, standard persistent launch as fallback */
export async function launchSession(request: CrawlerRunRequest): Promise<BrowserSession> {
  return await createDualModeLauncher(playwright())({
    mode: 'cdp',
    cdpPort: 9222,
    userDataDir: userDataDirOf(request.platform),
    headless: request.headless,
    proxyUrl: null,
    userAgent: null,
  })
}

/** 真实管线依赖 / the real pipeline dependencies */
export function realDeps(request: CrawlerRunRequest): PipelineDeps {
  return {
    fetchJson: hostFetchJson,
    launchSession: async () => await launchSession(request),
  }
}
