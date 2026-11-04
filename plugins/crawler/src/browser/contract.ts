/**
 * 浏览器自动化契约：双模式浏览器（CDP 接管优先 / 标准启动回退）
 * （design/modules/crawler.md 关键决策 1 与 §3 契约）。
 * Browser automation contracts: the dual-mode browser (CDP attach first,
 * standard launch as the fallback) (crawler.md decision 1 and §3).
 *
 * 分两层类型：`Raw*` 描述 playwright-core 的真实结构面（库缝，只在这里
 * 出现）；`BrowserContextLike` 是插件内部使用的干净契约（登录态请求通道
 * 一定存在）。库对象一律经 `browser/adapter.ts` 包装后才进入插件。
 * Two type layers: `Raw*` describes the real playwright-core surface (the
 * library seam, confined to this file); `BrowserContextLike` is the clean
 * in-plugin contract whose session-carrying request channel always exists.
 * Library objects only enter the plugin through `browser/adapter.ts`.
 *
 * @module @veren/crawler/browser/contract
 */

/** Cookie 键值对（域限定）/ a domain-scoped cookie pair */
export interface CookieLike {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
}

/** 原始 HTTP 响应（playwright-core 子集）/ the raw http response (a playwright-core subset) */
export interface RawResponseLike {
  status(): number
  headers(): Readonly<Record<string, string>>
  json(): Promise<unknown>
  text(): Promise<string>
}

/** 原始页面（playwright-core 子集）/ the raw page (a playwright-core subset) */
export interface RawPageLike {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'commit' }): Promise<unknown>
  content(): Promise<string>
}

/** 原始上下文（playwright-core 子集，含带登录态的请求通道）/ the raw context (a playwright-core subset with the session-carrying request channel) */
export interface RawContextLike {
  newPage(): Promise<RawPageLike>
  pages(): RawPageLike[]
  addCookies(cookies: CookieLike[]): Promise<void>
  cookies(urls?: string[]): Promise<CookieLike[]>
  close(): Promise<void>
  request: {
    get(url: string, options: { headers: Readonly<Record<string, string>> }): Promise<RawResponseLike>
  }
}

/** CDP 接管后的浏览器（原始面）/ the browser after a CDP attach (raw surface) */
export interface CdpBrowserLike {
  contexts(): RawContextLike[]
  close(): Promise<void>
}

/** playwright-core 的最小结构面（可注入测试替身）/ the minimal structural surface of playwright-core (injectable test doubles) */
export interface PlaywrightLike {
  chromium: {
    /** CDP 接管已装浏览器 / attach to the user's browser over CDP */
    connectOverCDP(endpointURL: string): Promise<CdpBrowserLike>
    /** 标准启动持久化上下文 / launch a persistent context */
    launchPersistentContext(userDataDir: string, options: PersistentLaunchOptions): Promise<RawContextLike>
  }
}

/** 插件内部页面契约 / the in-plugin page contract */
export interface PageLike {
  goto(url: string): Promise<unknown>
  content(): Promise<string>
}

/** 插件内部上下文契约：请求通道一定携带登录态 / the in-plugin context contract: the request channel always carries the session */
export interface BrowserContextLike {
  /** 新建页面 / open a new page */
  newPage(): Promise<PageLike>
  /** 会话内已有页面（复用活动页，避免标签堆积）/ existing pages in the session (reuse the working one, no tab piling) */
  pages(): Promise<PageLike[]>
  /** Cookie 注入与回写 / cookie injection and read-back */
  addCookies(cookies: CookieLike[]): Promise<void>
  cookies(urls?: string[]): Promise<CookieLike[]>
  /** 携带登录态的上下文内请求（接口取数通道）/ a context request carrying the login session (the api data channel) */
  requestJson(url: string): Promise<unknown>
  close(): Promise<void>
}

/** 浏览器渠道：用系统已装浏览器而非 playwright 自带包 / the browser channel: use the system browser instead of playwright's bundle */
export type BrowserChannel = 'chrome' | 'msedge'

/** 持久化上下文启动选项 / persistent-context launch options */
export interface PersistentLaunchOptions {
  headless: boolean
  proxy?: { server: string; username?: string; password?: string }
  userAgent?: string
  viewport?: { width: number; height: number } | null
  /** 系统浏览器渠道（缺省用 playwright 自带 chromium）/ the system browser channel (playwright's bundled chromium when absent) */
  channel?: BrowserChannel
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
  /** 系统浏览器渠道（仅标准启动生效）/ the system browser channel (standard launch only) */
  channel?: BrowserChannel
}

/** 浏览器会话：上下文 + 统一清理 / a browser session: context plus unified cleanup */
export interface BrowserSession {
  context: BrowserContextLike
  /** CDP 模式需额外关闭浏览器连接 / CDP mode also closes the browser connection */
  close(): Promise<void>
}

/** 浏览器启动器契约 / the browser-launcher contract */
export type BrowserLauncher = (options: BrowserLaunchOptions) => Promise<BrowserSession>
