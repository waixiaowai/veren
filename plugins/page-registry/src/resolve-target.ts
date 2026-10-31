/**
 * 页面 URL 目标解析：canonicalize → 应用在场/启用 → 页面命中，三段校验收口在
 * 一处。openUrl、page_send 投递与重挂路径共用同一段校验，任何调用方都绕不过。
 * Page-url target resolution: canonicalize → app present/active → page hit,
 * closed in one place. openUrl, the page_send delivery, and the remount path
 * share this one validation — no caller can bypass it.
 *
 * @module @veren/page-registry/resolve-target
 */
import { PageError, PageErrorCode, canonicalizePageUrl } from '@veren/prompt-page'
import type { PageInstanceKey, PageMatch } from '@veren/prompt-page'
import type { AppRecord } from '@veren/app-registry'
import type { PageRuntimePorts } from './runtime-ports.ts'

/** 规范 URL 里的 appId 段 / the appId segment of a canonical url */
export function appIdOf(url: string): string | undefined {
  const segments = url.split('/').filter((segment) => segment.length > 0)
  return segments.length >= 2 ? segments[1]! : undefined
}

/**
 * 解析并校验一个页面 URL 目标（canonicalize + 应用在场/启用 + 页面命中）。
 * openUrl 与投递路径（§3.9 delivery）共用的同一段校验。
 * Resolve and validate a page-url target (canonicalize + app present/active +
 * page hit). Shared by openUrl and the delivery path (§3.9).
 */
export function resolvePageTarget(
  registry: { resolve(url: string): PageMatch<never> | null },
  ports: PageRuntimePorts,
  url: string,
): { key: PageInstanceKey; app: AppRecord; match: PageMatch<never> } {
  const key = canonicalizePageUrl(url)
  const appId = appIdOf(key)
  if (appId === undefined) throw new PageError(PageErrorCode.UrlInvalid, `url ${key} carries no /apps/<appId> segment`)
  // URL 段是字符串，AppId 是 brand：跨边界在此一次性收窄 / url segment → branded AppId at this boundary
  const app = ports.apps.get(appId as AppRecord['definition']['id'])
  if (app === undefined) {
    throw new PageError(PageErrorCode.AppNotFound, `app "${appId}" is not registered`)
  }
  if (app.state !== 'active') {
    throw new PageError(PageErrorCode.AppDisabled, `app "${appId}" is ${app.state}; enable it before opening pages`)
  }
  const match = registry.resolve(key)
  if (match === null) throw new PageError(PageErrorCode.PageNotFound, `no page matches ${key}`)
  return { key, app, match }
}
