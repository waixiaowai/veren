/**
 * 双模式浏览器启动器：CDP 接管优先，失败回退标准启动
 * （design/modules/crawler.md 关键决策 1）。
 * The dual-mode launcher: CDP attach first, standard launch on failure
 * (crawler.md decision 1).
 *
 * @module @veren/crawler/browser/launcher
 */
import type {
  BrowserLaunchOptions,
  BrowserLauncher,
  BrowserSession,
  PlaywrightLike,
} from './contract.ts'

/** CDP 端点形态 / the CDP endpoint form */
function cdpEndpoint(options: BrowserLaunchOptions): string {
  return `http://127.0.0.1:${options.cdpPort}`
}

/** 代理选项：无代理为 undefined / proxy options: undefined when absent */
function proxyOption(options: BrowserLaunchOptions): { server: string } | undefined {
  return options.proxyUrl === null ? undefined : { server: options.proxyUrl }
}

/**
 * CDP 接管启动：复用使用者浏览器的默认上下文（保留登录态与指纹）。
 * CDP attach: reuses the user's default context (session and fingerprint
 * preserved).
 */
export function createCdpLauncher(playwright: PlaywrightLike): BrowserLauncher {
  return async (options) => {
    const browser = await playwright.chromium.connectOverCDP(cdpEndpoint(options))
    const context = browser.contexts()[0]
    // 无默认上下文的接管环境不可用，交由上层回退标准启动。
    // An attach environment without a default context is unusable; the
    // caller falls back to the standard launch.
    if (context === undefined) {
      await browser.close()
      throw new Error('CDP browser exposes no context')
    }
    return {
      context,
      close: async () => {
        await browser.close()
      },
    }
  }
}

/**
 * 标准启动：playwright 持久化上下文，登录态写入平台隔离用户目录。
 * Standard launch: a playwright persistent context persisting the login
 * profile into the platform-isolated directory.
 */
export function createStandardLauncher(playwright: PlaywrightLike): BrowserLauncher {
  return async (options) => {
    const context = await playwright.chromium.launchPersistentContext(options.userDataDir, {
      headless: options.headless,
      proxy: proxyOption(options),
      userAgent: options.userAgent ?? undefined,
    })
    return {
      context,
      close: async () => {
        await context.close()
      },
    }
  }
}

/**
 * 双模式组合：CDP 失败（未开启调试端口/无浏览器）回退标准启动。
 * The combined launcher: a CDP failure (debug port closed, no browser)
 * falls back to the standard launch.
 */
export function createDualModeLauncher(playwright: PlaywrightLike): BrowserLauncher {
  return async (options) => {
    if (options.mode === 'standard') return await createStandardLauncher(playwright)(options)
    try {
      return await createCdpLauncher(playwright)(options)
    } catch {
      return await createStandardLauncher(playwright)(options)
    }
  }
}
