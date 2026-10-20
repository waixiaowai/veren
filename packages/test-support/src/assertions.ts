/**
 * 断言助手：四个应用 spec 各写一遍的「单入口注册一致性」与「卸载摘净」。
 * Assertion helpers: the single-entry consistency and the torn-down-clean
 * checks that four app specs each re-wrote.
 *
 * @module @veren/test-support/assertions
 */
import { expect } from 'vitest'
import type { AppId, AppRegistryService } from '@veren/app-registry'
import type { PageRegistryService } from '@veren/page-registry'

/** 应用前缀：目录 id 即 URL 首段。The app URL prefix: the catalog id is the first segment. */
function appPrefix(appId: AppId): string {
  return `/apps/${appId}/`
}

/**
 * 单入口注册一致性：应用目录里的每一页都能被 page-registry 解析、名字一致，
 * 且应用前缀下不存在目录之外的页面——镜像不会向任一方向漂移。
 * Single-entry consistency: every catalog page resolves in page-registry with
 * the same name, and nothing under the app prefix resolves without a catalog
 * entry — the mirror never drifts in either direction.
 */
export function expectPagesRegisteredOnce(
  apps: AppRegistryService,
  pageRegistry: PageRegistryService,
  appId: AppId,
): void {
  const pages = apps.listPages(appId)
  expect(pages.length).toBeGreaterThan(0)
  for (const page of pages) {
    const match = pageRegistry.resolve(page.url)
    expect(match, `page "${page.name}" (${page.url}) must be resolvable`).not.toBeNull()
    // 应用页在 page-registry 里以 pageKey（<appId>/<本地名>）为名（见
    // PageRegistryService.registerAppPage）/ app pages are named by their
    // pageKey in page-registry (see PageRegistryService.registerAppPage)
    expect(match?.page.name, `resolved page for ${page.url} must be "${appId}/${page.name}"`).toBe(`${appId}/${page.name}`)
  }
  const catalogUrls = pages.map((page) => page.url).sort()
  const mirroredUrls = pageRegistry.catalog()
    .map((row) => row.url)
    .filter((url) => url.startsWith(appPrefix(appId)))
    .sort()
  expect(mirroredUrls).toEqual(catalogUrls)
}

/**
 * 卸载摘净：应用从 catalog 消失、前缀下没有任何可解析页面。
 * Torn down clean: the app is gone from the catalog and nothing under its
 * prefix resolves anymore.
 */
export function expectAppRemoved(
  apps: AppRegistryService,
  pageRegistry: PageRegistryService,
  appId: AppId,
  urls: string[],
): void {
  expect(apps.catalog().map((app) => app.definition.id)).not.toContain(appId)
  expect(
    pageRegistry.catalog().filter((row) => row.url.startsWith(appPrefix(appId))),
  ).toHaveLength(0)
  for (const url of urls) expect(pageRegistry.resolve(url)).toBeNull()
}
