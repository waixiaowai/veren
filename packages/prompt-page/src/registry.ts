/**
 * PageRegistry：页面注册表 + URL 匹配 / page registry + URL matching
 *
 * - 页面以唯一 URL 模式注册：/xx/:param（仅路径段）
 * - resolve(url)：路径参数 + query 合并（path 优先于同名 query）
 * - catalog()：供入口/目录渲染的 {name, url, description} 清单
 * - register 返回 disposer（HMR/卸载安全）
 */
import type { PageDefinition, PageLiveBinding, PageParams } from './types.ts'

/** 规范化路径：补前导斜杠、去尾斜杠（根除外）/ normalize a path */
export function normalizePath(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`
  return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash
}

/** 拆分 URL 为路径与查询 / split a url into path and query */
export function splitUrl(url: string): { path: string; query: URLSearchParams } {
  const queryIndex = url.indexOf('?')
  const path = queryIndex === -1 ? url : url.slice(0, queryIndex)
  const query = new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1))
  return { path: normalizePath(path), query }
}

/** 路径模式匹配：静态段相等，:param 捕获（解码）/ match a path pattern */
export function matchPath(pattern: string, path: string): PageParams | null {
  const patternSegments = normalizePath(pattern).split('/').filter((segment) => segment.length > 0)
  const pathSegments = normalizePath(path).split('/').filter((segment) => segment.length > 0)
  if (patternSegments.length !== pathSegments.length) return null
  const params: PageParams = {}
  for (let index = 0; index < patternSegments.length; index++) {
    const patternSegment = patternSegments[index]!
    const actualSegment = pathSegments[index]!
    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = decodeURIComponent(actualSegment)
    } else if (patternSegment !== actualSegment) {
      return null
    }
  }
  return params
}

/** 用参数实例化 URL 模式（编码）/ instantiate a pattern with params (encoded) */
export function formatPath(pattern: string, params: PageParams): string {
  return normalizePath(pattern)
    .split('/')
    .map((segment) => segment.startsWith(':')
      ? encodeURIComponent(params[segment.slice(1)] ?? '')
      : segment)
    .join('/')
}

/** 一次解析结果 / one resolve result */
export interface PageMatch<S> {
  readonly page: PageDefinition<S>
  /** path params + query 合并（path 优先）/ merged params, path wins */
  readonly params: PageParams
  /** 规范化后的具体 URL / normalized concrete url */
  readonly url: string
  /** 注册时声明的实时数据绑定；缺省 = 静态页（无 PAGE-DATA 同步）/ the live binding declared at registration; absent = static page */
  readonly live?: PageLiveBinding
}

/** 目录条目（入口渲染用）/ catalog entry for entry-point rendering */
export interface PageCatalogEntry {
  readonly name: string
  readonly url: string
  readonly description: string
}

export class PageRegistry<S> {
  /** 登记条目：页面定义 + 可选实时绑定 / one entry: page definition + optional live binding */
  private readonly entries: Array<{ page: PageDefinition<S>; live?: PageLiveBinding }> = []

  /** 注册页面：重名/URL 模式冲突 fail loud；返回 disposer / register with a disposer */
  register(page: PageDefinition<S>, live?: PageLiveBinding): () => void {
    if (this.entries.some((existing) => existing.page.name === page.name)) {
      throw new Error(`[PageRegistry] duplicate page name: ${page.name}`)
    }
    if (this.entries.some((existing) => normalizePath(existing.page.url) === normalizePath(page.url))) {
      throw new Error(`[PageRegistry] duplicate page url pattern: ${page.url}`)
    }
    this.entries.push(live === undefined ? { page } : { page, live })
    return () => {
      const index = this.entries.findIndex((entry) => entry.page === page)
      if (index >= 0) this.entries.splice(index, 1)
    }
  }

  /** 按名取页面定义 / look up a page definition by name */
  get(name: string): PageDefinition<S> | undefined {
    return this.entries.find((entry) => entry.page.name === name)?.page
  }

  /** 解析 URL：按注册顺序首个命中；无命中返回 null / resolve by registration order */
  resolve(url: string): PageMatch<S> | null {
    const { path, query } = splitUrl(url)
    for (const entry of this.entries) {
      const pathParams = matchPath(entry.page.url, path)
      if (pathParams === null) continue
      const params: PageParams = { ...Object.fromEntries(query), ...pathParams }
      // 回显 URL 只保留未被 path 覆盖的 query 参数 / echo only query params not overridden by path
      const queryString = new URLSearchParams(
        Object.entries(params).filter(([key]) => !(key in pathParams)),
      ).toString()
      return {
        page: entry.page,
        params,
        url: formatPath(entry.page.url, pathParams) + (queryString.length > 0 ? `?${queryString}` : ''),
        ...(entry.live === undefined ? {} : { live: entry.live }),
      }
    }
    return null
  }

  /** 目录清单 / catalog entries in registration order */
  catalog(): PageCatalogEntry[] {
    return this.entries.map(({ page }) => ({ name: page.name, url: page.url, description: page.description }))
  }
}
