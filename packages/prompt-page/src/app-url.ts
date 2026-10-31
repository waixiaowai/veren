/**
 * 应用作用域 URL 形态校验（§6.1）：页面 URL 一律是 `/apps/<appId>/<应用内路径>`。
 * App-scoped url shape validation (§6.1): a page url is always
 * `/apps/<appId>/<in-app path>`.
 *
 * @module @veren/prompt-page/app-url
 */
import { normalizePath } from './registry.ts'

/** 页面 URL 统一前缀 / the one page-url prefix */
export const APPS_URL_PREFIX = '/apps'

/** 应用 id 保留字 / reserved app ids */
export const RESERVED_APP_IDS: readonly string[] = ['api', 'apps', 'system', '__global__']

const APP_SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/

/** 应用 id 是否合法 slug / whether an app id is a valid slug */
export function isValidAppId(id: string): boolean {
  return APP_SLUG_RE.test(id) && !RESERVED_APP_IDS.includes(id)
}

/**
 * 校验页面 URL 模式为 `/apps/<appId>/<应用内路径>` 形态（保留 `:param` 规则）。
 * 应用内路径不能以 `apps` 段开头；查询串不允许出现在模式里。
 * Validates the `/apps/<appId>/...` pattern shape; keeps `:param` rules.
 * @throws Error 形态不合法时 / on an invalid shape
 */
export function assertAppUrlPattern(pageName: string, url: string): void {
  const fail = (why: string): never => {
    throw new Error(`[page-url] page "${pageName}" ${why}: ${JSON.stringify(url)}`)
  }
  if (!url.startsWith(`${APPS_URL_PREFIX}/`)) fail(`url must start with ${APPS_URL_PREFIX}/<appId>/`)
  if (url.includes('?') || url.includes('#')) fail('url pattern must not carry a query or fragment')
  const segments = normalizePath(url).split('/').filter((segment) => segment.length > 0)
  const appId = segments[1]!
  if (!isValidAppId(appId)) fail(`has an invalid app id segment ${JSON.stringify(appId)}`)
  if (segments[2] === 'apps') fail('app-internal path must not start with the "apps" segment')
  const paramNames = new Set<string>()
  for (const segment of segments.slice(2)) {
    if (!segment.startsWith(':')) continue
    const paramName = segment.slice(1)
    if (paramName.length === 0 || paramNames.has(paramName)) {
      fail(`has an invalid or duplicate :param ${JSON.stringify(segment)}`)
    }
    paramNames.add(paramName)
  }
}

/**
 * `/apps/<appId>/<应用内路径>` 是否合法形态。仅供测试/对外契约——生产校验走
 * `assertAppUrlPattern`（fail loud），本函数是其布尔查询面。
 * Whether a url has a valid app-scoped shape. Test-only / external contract:
 * production validation is `assertAppUrlPattern` (fail loud); this is its
 * boolean query face.
 */
export function isAppUrlPattern(url: string): boolean {
  try {
    assertAppUrlPattern('check', url)
    return true
  } catch {
    return false
  }
}

/** URL 模式里声明的全部 `:param` 名（按出现顺序）/ every `:param` name a url pattern declares, in order */
export function patternParamsOf(url: string): readonly string[] {
  return url.split('/').filter((segment) => segment.startsWith(':') && segment.length > 1).map((segment) => segment.slice(1))
}
