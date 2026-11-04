/**
 * 真实管线依赖：浏览器会话（CDP 优先，系统浏览器渠道兜底）。
 * The real pipeline dependencies: browser sessions (CDP first, the system
 * browser channel as the fallback).
 *
 * CDP 接管优先：机器上已有开了调试端口的浏览器时，直接复用它的登录态与
 * 指纹；没有则用系统 Chrome 标准启动，登录态写进平台隔离档案目录。
 * CDP attach first: when a browser with a debug port is around, reuse its
 * session and fingerprint; otherwise standard-launch the system Chrome and
 * persist the session into the platform-isolated profile directory.
 *
 * @module @veren/crawler/runner/real-deps
 */
import { chromium as playwrightChromium } from 'playwright-core'
import { createDualModeLauncher } from '../browser/launcher.ts'
import { userDataDirOf } from '../auth/flow.ts'
import type { BrowserChannel, BrowserSession, PlaywrightLike } from '../browser/contract.ts'
import type { PipelineDeps } from '../pipeline.ts'
import type { CrawlerRunRequest } from '../control/runner.ts'

/** 真实依赖选项 / the real-deps options */
export interface RealDepsOptions {
  /** 浏览器档案根目录 / the browser profile root */
  browserDataRoot?: string
  /** 标准启动用的系统浏览器渠道 / the system browser channel for standard launches */
  channel?: BrowserChannel
  /** CDP 调试端口 / the CDP debug port */
  cdpPort?: number
}

/** 库边界适配：playwright-core 结构面转换只在装配处收口 / the library-seam adapter, converted only at assembly */
function playwright(): PlaywrightLike {
  return { chromium: playwrightChromium } as unknown as PlaywrightLike
}

/**
 * 真实浏览器会话：CDP 接管优先，失败回退系统 Chrome 持久化启动。
 * The real browser session: CDP attach first, falling back to a standard
 * persistent launch of the system Chrome.
 */
export async function launchSession(request: CrawlerRunRequest, options: RealDepsOptions = {}): Promise<BrowserSession> {
  return await createDualModeLauncher(playwright())({
    mode: 'cdp',
    cdpPort: options.cdpPort ?? 9222,
    userDataDir: userDataDirOf(request.platform, options.browserDataRoot),
    headless: request.headless,
    proxyUrl: null,
    userAgent: null,
    ...(options.channel === undefined ? {} : { channel: options.channel }),
  })
}

/** 真实管线依赖 / the real pipeline dependencies */
export function realDeps(request: CrawlerRunRequest, options: RealDepsOptions = {}): PipelineDeps {
  return {
    launchSession: async () => await launchSession(request, options),
    ...(options.browserDataRoot === undefined ? {} : { profileRoot: options.browserDataRoot }),
  }
}
