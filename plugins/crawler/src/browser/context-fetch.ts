/**
 * 会话内取数：接口请求携带浏览器登录 Cookie（crawler.md §5 双站 Cookie）。
 * In-session data fetching: api requests carry the browser's login cookies
 * (the dual-site cookie difference in crawler.md §5).
 *
 * @module @veren/crawler/browser/context-fetch
 */
import type { BrowserSession } from './contract.ts'
import type { FetchJson } from '../platform/wb/crawler.ts'

/**
 * 由浏览器会话构造 FetchJson：请求在上下文内发出，自动携带登录态。
 * Builds a FetchJson from a browser session: requests run inside the
 * context and carry the login session automatically.
 */
export function createSessionFetchJson(session: BrowserSession): FetchJson {
  return async (url: string) => await session.context.requestJson(url)
}
