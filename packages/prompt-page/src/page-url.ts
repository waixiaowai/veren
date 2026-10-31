/**
 * 规范 URL：页面实例的主键与规范化函数（§3.5.1）。
 * Canonical urls: the page-instance primary key and the canonicalizer (§3.5.1).
 *
 * 规范 URL 是索引、任务、通知共用的那一份；失败 fail loud（page/url-invalid）。
 * The canonical url is the one copy shared by the index, tasks and
 * notifications; it fails loud on malformed input (page/url-invalid).
 *
 * @module @veren/prompt-page/page-url
 */
import { normalizePath } from './registry.ts'
import { PageError, PageErrorCode } from './page-errors.ts'

/** 规范 URL：页面实例的主键（brand，零运行时开销）/ canonical url, the page-instance primary key */
export type PageInstanceKey = string & { readonly __brand: 'PageInstanceKey' }

/** 应用 id（最小字符串面；完整契约在 @veren/app-registry）/ app id minimal string face */
export type AppIdString = string

/**
 * URL 规范化函数签名（§3.5.1：路径规范化、查询串参与身份、query 按 key/value
 * 排序、去空查询串、拒绝片段）。实现在下方。
 * Signature of the canonicalizer; the implementation follows below.
 */
export type CanonicalizePageUrl = (input: string) => PageInstanceKey

/**
 * URL 规范化（§3.5.1）：
 * 1. 拒绝片段（`#...` 不是页面身份的一部分）；
 * 2. 路径规范化：补前导 `/`、去尾 `/`（根除外）、折叠空段、每段解码后按
 *    RFC 3986 重新编码（percent 编码统一）；不做 host/scheme 规范化；
 * 3. 查询串参与身份：按 key 排序（同 key 多值再按 value 排序），去空查询串。
 * 规范 URL 是索引、任务、通知共用的那一份；失败 fail loud（page/url-invalid）。
 * Canonicalizes per §3.5.1; fails loud on malformed input.
 */
export const canonicalizePageUrl: CanonicalizePageUrl = (input: string): PageInstanceKey => {
  const fail = (why: string): never => {
    throw new PageError(PageErrorCode.UrlInvalid, `canonicalizePageUrl: ${why}: ${JSON.stringify(input)}`)
  }
  if (typeof input !== 'string' || input.length === 0) fail('url must be a non-empty string')
  if (input.includes('#')) fail('fragment is not part of a page identity')
  const queryIndex = input.indexOf('?')
  const rawPath = queryIndex === -1 ? input : input.slice(0, queryIndex)
  const rawQuery = queryIndex === -1 ? '' : input.slice(queryIndex + 1)
  const path = canonicalPath(rawPath, fail)
  const queryString = canonicalQuery(rawQuery)
  return `${path}${queryString.length > 0 ? `?${queryString}` : ''}` as PageInstanceKey
}

/** 路径：拆段 → 解码 → 重编码（统一 percent 形态）；根路径保持 "/" / path: split, decode, re-encode (uniform percent form); the root stays "/" */
function canonicalPath(rawPath: string, fail: (why: string) => never): string {
  const segments = normalizePath(rawPath).split('/').filter((segment) => segment.length > 0)
  return `/${segments.map((segment) => {
    try {
      return encodeURIComponent(decodeURIComponent(segment))
    } catch {
      return fail('path segment has malformed percent-encoding')
    }
  }).join('/')}`
}

/** 查询：key 排序（同 key 按 value），空查询串去掉 / query: sort by key then value, drop an empty query */
function canonicalQuery(rawQuery: string): string {
  const pairs = [...new URLSearchParams(rawQuery)].sort((a, b) =>
    a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1,
  )
  return new URLSearchParams(pairs).toString()
}
