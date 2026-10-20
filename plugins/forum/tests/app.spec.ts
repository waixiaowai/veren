/**
 * Composition tests for the forum app face: a real cordis Context with the real
 * AppRegistryService and PageRegistryService, locking catalog discovery, entry
 * resolution, URL prefixes, external tool names, single-entry consistency
 * (catalog pages === resolvable pages), and clean teardown.
 *
 * 论坛应用面的组合测试：真实 cordis Context 搭配真实的 AppRegistryService 与
 * PageRegistryService，锁定目录可发现、入口可解析、URL 前缀、工具外部名、
 * 单入口一致性（应用目录页面 === 可解析页面）与卸载干净。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { AppRegistryService } from '@veren/app-registry'
import { PageRegistryService } from '@veren/page-registry'
// Type-only: pulls the `ctx.apps` / `ctx.pageRegistry` service declarations.
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import { ForumError } from '../src/types.ts'
import type { ForumToolsPort } from '../src/index.ts'
import { FORUM_APP_ID, FORUM_ENTRY_KEY, registerForumApp } from '../src/app.ts'
import { catalogPage, postPage } from '../src/pages.tsx'

/** A port that refuses every call; the app face's registration needs no data. */
function refusingPort(): ForumToolsPort {
  const refuse = (): never => { throw new ForumError('forum/storage-unavailable', 'not wired in this spec') }
  return {
    catalog: refuse, detail: refuse, publish: refuse, comment: refuse, vote: refuse,
    inbox: refuse, markRead: refuse, autoPost: refuse, ensureBoard: refuse,
  }
}

/** Mount the real registries plus the forum app on one fresh context. */
async function install(): Promise<{ ctx: Context; apps: AppRegistryService; pageRegistry: PageRegistryService; fiber: Fiber }> {
  const ctx = new Context()
  const apps = new AppRegistryService(new Context())
  const pageRegistry = new PageRegistryService(new Context())
  ctx.provide('apps', apps)
  ctx.provide('pageRegistry', pageRegistry)
  // The mirror seam, wired exactly as the real host assembly (app-host) does.
  // 镜像接缝，与真实宿主装配（app-host）完全一致地接上。
  apps.setPageMirror({
    registerAppPage: (appId, page) => pageRegistry.registerAppPage(appId, page),
    releaseApp: appId => pageRegistry.releaseApp(appId),
  })
  const fiber = ctx.plugin({ name: 'forum-app-fixture', inject: [], apply: (inner: Context) => {
    registerForumApp(inner, refusingPort)
  } })
  await fiber
  return { ctx, apps, pageRegistry, fiber }
}

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.reverse()) await dispose()
  disposers.length = 0
})

describe('forum app discovery and resolution', () => {
  it('ctx.apps.catalog() discovers the forum app as active with the forum prefix', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const record = apps.get(FORUM_APP_ID)
    expect(record).toBeDefined()
    expect(record?.state).toBe('active')
    expect(record?.toolPrefix).toBe('forum')
    expect(apps.catalog().map((app) => app.definition.id)).toContain('forum')
  })

  it('the entry page URL is /apps/forum/catalog and resolves in the page registry', async () => {
    const { apps, pageRegistry, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const entry = apps.listPages(FORUM_APP_ID).find((page) => page.name === FORUM_ENTRY_KEY)
    expect(entry?.url).toBe('/apps/forum/catalog')
    // 应用页以 pageKey（<appId>/<本地名>）登记（见 registerAppPage）
    // app pages register under their pageKey (see registerAppPage)
    expect(pageRegistry.resolve('/apps/forum/catalog')?.page.name).toBe(`${FORUM_APP_ID}/catalog`)
    const match = pageRegistry.resolve('/apps/forum/post/p-12?focus=chat')
    expect(match?.params).toEqual({ postId: 'p-12', focus: 'chat' })
  })

  it('every page URL lives under /apps/forum/, carries no preset, and titles its instances', async () => {
    await install()
    for (const page of [catalogPage, postPage]) {
      expect(page.url.startsWith('/apps/forum/')).toBe(true)
      expect(page.pageRevision).toBeGreaterThanOrEqual(1)
      expect('preset' in page).toBe(false)
    }
    expect(postPage.url).toBe('/apps/forum/post/:postId')
    expect(postPage.instanceTitle?.({ postId: '12' })).toBe('主题 #12')
  })

  it('page tools carry the forum__ external-name prefix', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    expect(apps.listTools(FORUM_APP_ID).map((tool) => tool.externalName)).toEqual([
      'forum__list', 'forum__read', 'forum__post', 'forum__comment', 'forum__vote', 'forum__inbox',
    ])
  })

  it('single-entry consistency: catalog pages and resolvable pages correspond one to one', async () => {
    const { apps, pageRegistry, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const listed = apps.listPages(FORUM_APP_ID)
    expect(listed.length).toBe(2)
    for (const page of listed) {
      const match = pageRegistry.resolve(page.url)
      expect(match, `page "${page.name}" (${page.url}) must be resolvable`).not.toBeNull()
      // pageKey 命名（见 registerAppPage）/ pageKey naming (see registerAppPage)
      expect(match?.page.name).toBe(`${FORUM_APP_ID}/${page.name}`)
    }
    // And nothing under the app prefix resolves without a catalog entry:
    // the mirror never drifts in either direction.
    // 应用前缀下也不存在目录之外的页面：镜像不会向任一方向漂移。
    const mirrored = pageRegistry.catalog().filter((row) => row.url.startsWith('/apps/forum/'))
    expect(mirrored.map((row) => row.url).sort()).toEqual(listed.map((page) => page.url).sort())
  })
})

describe('forum app lifecycle', () => {
  it('disposing the fiber removes the app, its pages, and its tools at once', async () => {
    const { apps, pageRegistry, fiber } = await install()
    await fiber.dispose()
    expect(apps.catalog()).toHaveLength(0)
    expect(pageRegistry.resolve('/apps/forum/catalog')).toBeNull()
    expect(pageRegistry.resolve('/apps/forum/post/p-1')).toBeNull()
    // HMR safety: the same context can mount the app again after disposal.
    // HMR 安全：卸载后同一上下文可以再次挂载应用。
    const again = apps.get(FORUM_APP_ID)
    expect(again).toBeUndefined()
  })
})
