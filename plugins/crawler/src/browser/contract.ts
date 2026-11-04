/**
 * 浏览器自动化契约：双模式浏览器（CDP 接管优先 / 标准启动回退）
 * （design/modules/crawler.md 关键决策 1 与 §3 契约）。
 * Browser automation contracts: the dual-mode browser (CDP attach first,
 * standard launch as the fallback) (crawler.md decision 1 and §3).
 *
 * CDP 接管保留真实浏览器指纹，风控拒绝率显著更低；标准启动为无 CDP
 * 环境的回退路径。
 * CDP attach keeps the real browser fingerprint, cutting risk-control
 * rejections sharply; standard launch is the fallback without a CDP
 * endpoint.
 *
 * @module @veren/crawler/browser/contract
 */

/** playwright-core 的最小结构面（可注入测试替身）/ the minimal structural surface of playwright-core (injectable test doubles) */
export interface PlaywrightLike {
  chromium: {
    /** CDP 接管已装浏览器 / attach to the user's browser over CDP */
    connectOverCDP(endpointURL: string): Promise<CdpBrowserLike>
    /** 标准启动持久化上下文 / launch a persistent context */
    launchPersistentContext(userDataDir: string, options: PersistentLaunchOptions): Promise<BrowserContextLike>
  }
}

/** CDP 接管后的浏览器 / the browser after a CDP attach */
export interface CdpBrowserLike {
  /** 现有浏览器上下文（接管模式复用使用者会话）/ the existing contexts (attach reuses the user's session) */
  contexts(): BrowserContextLike[]
  close(): Promise<void>
}

/** 浏览器上下文最小面 / the minimal browser-context surface */
export interface BrowserContextLike {
  /** 新建页面 / open a new page */
  newPage(): Promise<PageLike>
  /** Cookie 注入与回写 / cookie injection and read-back */
  addCookies(cookies: CookieLike[]): Promise<void>
  cookies(urls?: string[]): Promise<CookieLike[]>
  /** 携带登录态的上下文内请求（接口取数通道）/ a context request carrying the login session (the api data channel) */
  requestJson(url: string): Promise<unknown>
  close(): Promise<void>
}

/** 页面最小面 / the minimal page surface */
export interface PageLike {
  goto(url: string): Promise<unknown>
  content(): Promise<string>
}

/** Cookie 键值对（域限定）/ a domain-scoped cookie pair */
export interface CookieLike {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
}

/** 持久化上下文启动选项 / persistent-context launch options */
export interface PersistentLaunchOptions {
  headless: boolean
  proxy?: { server: string; username?: string; password?: string }
  userAgent?: string
  viewport?: { width: number; height: number } | null
}

/** 启动模式 / the launch mode */
export type BrowserLaunchMode = 'cdp' | 'standard'

/** 浏览器启动参数 / the browser launch arguments */
export interface BrowserLaunchOptions {
  mode: BrowserLaunchMode
  /** CDP 远程调试端口 / the CDP remote-debugging port */
  cdpPort: number
  /** 登录态持久化目录（平台隔离）/ the profile directory (platform-isolated) */
  userDataDir: string
  headless: boolean
  /** 完整代理 URL（proxy 模块转换）/ the full proxy url (converted by the proxy module) */
  proxyUrl: string | null
  userAgent: string | null
}

/** 浏览器会话：上下文 + 统一清理 / a browser session: context plus unified cleanup */
export interface BrowserSession {
  context: BrowserContextLike
  /** CDP 模式需额外关闭浏览器连接 / CDP mode also closes the browser connection */
  close(): Promise<void>
}

/** 浏览器启动器契约 / the browser-launcher contract */
export type BrowserLauncher = (options: BrowserLaunchOptions) => Promise<BrowserSession>
