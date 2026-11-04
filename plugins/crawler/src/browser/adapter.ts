/**
 * 库缝适配：把 playwright-core 的原始上下文包装成插件内部契约
 * （design/modules/crawler.md §3）。
 * The library-seam adapter: wraps a raw playwright-core context into the
 * in-plugin contract (crawler.md §3).
 *
 * 关键职责：`requestJson` 在上下文内发请求（自动携带登录 Cookie），并把
 * 非 JSON 响应（登录墙、风控页）折成稳定错误码——这是「带登录态取数」
 * 的唯一实现点。
 * The key duty: `requestJson` issues the request inside the context (the
 * login cookies ride along) and folds non-JSON responses (login walls,
 * risk-control pages) into a stable code — the single implementation point
 * of session-carrying data fetching.
 *
 * @module @veren/crawler/browser/adapter
 */
import { CrawlerError } from '../errors.ts'
import type {
  BrowserContextLike,
  PageLike,
  RawContextLike,
  RawPageLike,
  RawResponseLike,
} from './contract.ts'

/** 默认请求头：来源页取同源根，声明为异步请求 / the default headers: same-origin referer plus the async-request marker */
function defaultHeaders(url: string): Readonly<Record<string, string>> {
  return {
    Referer: `${new URL(url).origin}/`,
    'X-Requested-With': 'XMLHttpRequest',
  }
}

/** 非 JSON 响应 = 登录墙或风控页 / a non-JSON response means a login wall or a risk-control page */
function accessDenied(url: string, reason: string, fields: Record<string, string>): CrawlerError {
  return new CrawlerError('PLATFORM_ACCESS_DENIED', `目标平台返回非 JSON 响应（${reason}）`, { url, ...fields })
}

/** 响应 → JSON；非 JSON 或错误状态码 fail loud / response → json; non-JSON or error statuses fail loud */
async function parseJson(url: string, response: RawResponseLike): Promise<unknown> {
  const status = response.status()
  const contentType = response.headers()['content-type'] ?? ''
  if (!contentType.includes('json')) {
    throw accessDenied(url, '可能未登录或被风控', { status: String(status), contentType })
  }
  if (status >= 400) throw accessDenied(url, '接口状态码异常', { status: String(status) })
  return await response.json()
}

/** 页面包装：只暴露插件需要的导航与正文 / page wrapper: navigation and content only */
function wrapPage(raw: RawPageLike): PageLike {
  return {
    goto: async (url: string) => await raw.goto(url),
    content: async () => await raw.content(),
  }
}

/**
 * 包装上下文：请求通道一律走浏览器上下文（Cookie 随行）。
 * Wraps a context: every request goes through the browser context so the
 * cookies ride along.
 */
export function wrapContext(raw: RawContextLike): BrowserContextLike {
  return {
    newPage: async () => wrapPage(await raw.newPage()),
    addCookies: async (cookies) => await raw.addCookies(cookies),
    cookies: async (urls) => await raw.cookies(urls),
    requestJson: async (url: string) => await parseJson(url, await raw.request.get(url, { headers: defaultHeaders(url) })),
    close: async () => await raw.close(),
  }
}
