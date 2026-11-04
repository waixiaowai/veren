/**
 * 微博登录实现：登录探测、扫码/短信等待、双站 Cookie 注入
 * （design/modules/auth.md §4 与 crawler.md §5 双站 Cookie）。
 * The weibo login implementation: the login probe, the qr/sms wait, and
 * dual-site cookie injection (auth.md §4 and crawler.md §5).
 *
 * 探测走 `m.weibo.cn/api/config`（`data.login` 是微博自己的登录判定），
 * 登录页是移动端 passport（扫码与短信在同一页）。
 * The probe uses `m.weibo.cn/api/config` (`data.login` is weibo's own
 * verdict); the login page is the mobile passport (qr and sms share it).
 *
 * @module @veren/crawler/platform/wb/auth
 */
import { CrawlerError } from '../../errors.ts'
import { injectCookies } from '../../browser/cookies.ts'
import type { AbstractLogin, LoginProbe } from '../../auth/contract.ts'
import type { BrowserSession, PageLike } from '../../browser/contract.ts'
import type { CrawlerRunRequest } from '../../control/runner.ts'

/** 登录探测接口 / the login-probe endpoint */
export const WB_PROBE_URL = 'https://m.weibo.cn/api/config'

/** 移动端登录页（成功后回到 m.weibo.cn）/ the mobile login page (returns to m.weibo.cn on success) */
export const WB_LOGIN_PAGE_URL =
  'https://passport.weibo.cn/signin/login?entry=mweibo&r=https%3A%2F%2Fm.weibo.cn%2F'

/** 移动站首页（站点预热落点）/ the mobile index (the warm-up destination) */
export const WB_INDEX_URL = 'https://m.weibo.cn/'

/** 双站 Cookie 域：桌面站与移动站各一套 / the dual-site cookie domains: desktop and mobile */
export const WB_COOKIE_DOMAINS: readonly string[] = ['.weibo.com', '.weibo.cn']

/** 扫码等待上限（毫秒）/ the qr scan window (ms) */
export const QR_WAIT_TIMEOUT_MS = 300_000

/** 轮询间隔（毫秒）/ the poll interval (ms) */
export const QR_POLL_INTERVAL_MS = 2_000

/** 毫秒休眠 / sleep for ms */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 登录探测：接口判定当前上下文是否已有有效会话。
 * The login probe: the api verdict on whether this context holds a session.
 */
export async function probeWbLoggedIn(session: BrowserSession): Promise<LoginProbe> {
  const payload = (await session.context.requestJson(WB_PROBE_URL)) as { data?: { login?: unknown } }
  return { loggedIn: payload.data?.login === true, probeMethod: 'api' }
}

/** 容错探测：轮询期间网络抖动不终止等待，只当作本次未登录 / tolerant probe: a transient failure counts as not-yet-logged-in */
async function probeQuietly(session: BrowserSession): Promise<boolean> {
  try {
    return (await probeWbLoggedIn(session)).loggedIn
  } catch {
    return false
  }
}

/** 扫码等待选项 / the qr wait options */
export interface WbLoginWaitOptions {
  /** 等待上限毫秒 / the timeout in ms */
  timeoutMs?: number
  /** 轮询间隔毫秒 / the poll interval in ms */
  pollMs?: number
}

/**
 * 等待用户完成登录：轮询探测直到命中或超时。
 * Waits for the human to finish logging in: polls the probe until it hits
 * or the window closes.
 */
export async function waitForWbLogin(session: BrowserSession, options: WbLoginWaitOptions = {}): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? QR_WAIT_TIMEOUT_MS)
  const pollMs = options.pollMs ?? QR_POLL_INTERVAL_MS
  while (Date.now() < deadline) {
    if (await probeQuietly(session)) return true
    await sleep(pollMs)
  }
  return false
}

/** 打开登录页（可见窗口：扫码必须由人完成）/ opens the login page (a visible window: a human must scan) */
async function openLoginPage(session: BrowserSession): Promise<void> {
  const page = await workingPage(session)
  await page.goto(WB_LOGIN_PAGE_URL)
}

/**
 * 取活动页面：优先复用会话里已有的页面，没有才新建。
 * Picks the working page: reuse an existing page in the session, creating
 * one only when the session has none.
 */
async function workingPage(session: BrowserSession): Promise<PageLike> {
  const pages = await session.context.pages()
  return pages[0] ?? (await session.context.newPage())
}

/**
 * 站点预热：把活动页面停在移动站首页，离开登录页。
 * Site warm-up: park the working page on the mobile index, leaving the
 * login page behind.
 *
 * 登录页残留标签会持续改写 Cookie，导致下一次探测把已登录会话判成未登录
 * ——预热以导航的方式终结这条残留页。
 * A leftover login tab keeps rewriting cookies, so the next probe can read a
 * logged-in session as logged out — the warm-up navigates that stale tab
 * away.
 */
export async function prepareWbSession(session: BrowserSession): Promise<void> {
  const page = await workingPage(session)
  await page.goto(WB_INDEX_URL)
}

/** cookie 方式缺凭证 / the cookie method without a credential */
function credentialMissing(): CrawlerError {
  return new CrawlerError('CREDENTIAL_MISSING', '请先提供登录 Cookie', {})
}

/** 双站注入 Cookie 串 / injects the cookie string under both site domains */
async function injectDualSiteCookies(session: BrowserSession, cookies: string | null): Promise<void> {
  if (cookies === null || cookies.length === 0) throw credentialMissing()
  for (const domain of WB_COOKIE_DOMAINS) await injectCookies(session.context, cookies, domain)
}

/**
 * 微博登录器：三种方式共享同一会话；扫码与短信在同一登录页等待。
 * The weibo login: the three methods share one session; qr and sms wait on
 * the same login page.
 */
export function createWbLogin(session: BrowserSession, request: CrawlerRunRequest): AbstractLogin {
  return {
    platform: request.platform,
    begin: async () => undefined,
    loginByQrcode: async () => {
      await openLoginPage(session)
      return await waitForWbLogin(session)
    },
    loginByMobile: async () => {
      await openLoginPage(session)
      return await waitForWbLogin(session)
    },
    loginByCookies: async () => await injectDualSiteCookies(session, request.cookies),
  }
}
