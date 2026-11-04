/**
 * Cookie 转换：凭证串 ↔ 浏览器 Cookie（design/modules/tools.md Cookie 转换）。
 * Cookie conversion: credential string ↔ browser cookies (the cookie
 * conversion utility in design/tools.md).
 *
 * @module @veren/crawler/browser/cookies
 */
import type { CookieLike } from './contract.ts'

/** Cookie 注入目标面（上下文的子集，便于测试）/ the cookie-injection surface (a context subset, handy in tests) */
export interface CookieSink {
  addCookies(cookies: CookieLike[]): Promise<void>
}

/**
 * 把 Cookie 凭证串解析为键值对。
 * Parses a cookie credential string into name-value pairs.
 */
export function parseCookieString(cookieString: string): Array<{ name: string; value: string }> {
  const pairs: Array<{ name: string; value: string }> = []
  for (const segment of cookieString.split(';')) {
    const trimmed = segment.trim()
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    pairs.push({ name: trimmed.slice(0, separator), value: trimmed.slice(separator + 1) })
  }
  return pairs
}

/**
 * 注入 Cookie 串到浏览器上下文（指定域，路径根）。
 * Injects the cookie string into a browser context under the given domain.
 */
export async function injectCookies(context: CookieSink, cookieString: string, domain: string): Promise<void> {
  const cookies = parseCookieString(cookieString).map((pair) => ({
    ...pair,
    domain,
    path: '/',
  }))
  if (cookies.length > 0) await context.addCookies(cookies)
}

/**
 * 回写：浏览器 Cookie 摘要为凭证串（登录后同步给接口客户端）。
 * The read-back: summarizes browser cookies into a credential string for
 * the api client after login.
 */
export function cookiesToString(cookies: CookieLike[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}
