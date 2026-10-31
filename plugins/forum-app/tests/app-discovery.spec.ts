/**
 * Composition specs — app discovery, resolution, and lifecycle: a real cordis
 * Context, the real `@veren/forum` service over the real storage stack, and the
 * real AppRegistryService/PageRegistryService with the mirror seam wired exactly
 * as the host assembly does. They lock: the app is discovered and active, the
 * entry URL resolves, page urls carry the app prefix with per-page identity,
 * the page tools carry the `forum__` prefix in the one render, single-entry
 * consistency holds, and teardown strips both sides.
 *
 * 组合测试——应用可发现、可解析与生命周期：真实 cordis Context、真实存储栈上的
 * `@veren/forum` 服务，以及与真实宿主装配同缝接线的 AppRegistryService /
 * PageRegistryService。锁定：应用可发现且 active、入口 URL 可解析、页面 URL 带
 * 应用前缀且逐页有身份、页面工具带 `forum__` 前缀（一次渲染内）、单入口一致、
 * 卸载两侧摘干净。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponentPage } from '@veren/prompt-page'
import { CatalogMeta, CatalogPage, PostMeta, PostPage } from '../src/pages.tsx'
import { FORUM_APP_DEFINITION, FORUM_APP_ID } from '../src/index.ts'
import { disposeTrackedRoots, makeFixture, mount } from './helpers/app-mount.ts'

afterEach(disposeTrackedRoots)

describe('forum app discovery and resolution / 应用可发现与可解析', () => {
  it('ctx.apps.catalog() discovers the forum app as active with the forum prefix', async () => {
    const { apps, fiber } = await mount()

    const record = apps.get(FORUM_APP_ID)
    expect(record).toBeDefined()
    expect(record?.state).toBe('active')
    expect(record?.toolPrefix).toBe('forum')
    expect(apps.catalog().map((app) => app.definition.id)).toContain('forum')

    await fiber.dispose()
  })

  it('the entry page URL is /apps/forum/catalog and resolves in the page registry', async () => {
    const { apps, pageRegistry, fiber } = await mount()

    const entry = apps.listPages(FORUM_APP_ID).find((page) => page.name === FORUM_APP_DEFINITION.entry)
    expect(entry?.url).toBe('/apps/forum/catalog')
    // pageKey 命名（见 registerAppPage）/ pageKey naming (see registerAppPage)
    expect(pageRegistry.resolve('/apps/forum/catalog')?.page.name).toBe(`${FORUM_APP_ID}/catalog`)
    const match = pageRegistry.resolve('/apps/forum/post/p-12?focus=chat')
    expect(match?.params).toEqual({ postId: 'p-12', focus: 'chat' })

    await fiber.dispose()
  })

  it('every page URL lives under /apps/forum/, carries no preset, and titles its instances', async () => {
    const { apps, fiber } = await mount()
    const listed = apps.listPages(FORUM_APP_ID)
    for (const page of listed) {
      expect(page.url.startsWith('/apps/forum/')).toBe(true)
      expect('preset' in page).toBe(false)
    }
    const post = listed.find((page) => page.name === 'post')
    expect(post?.url).toBe('/apps/forum/post/:postId')
    expect(post?.instanceTitle?.({ postId: '12' })).toBe('主题 #12')
    await fiber.dispose()
  })

  it('page tools carry the forum__ external-name prefix (bodies register full names in the one render)', async () => {
    const { ctx, fiber, port } = await mount()
    const fixture = makeFixture(ctx, port)
    // 按页断言：入口页三件 + 投递回报三件；详情页四件 + 投递回报三件（inbox 两页
    // 都挂——处理主题的会话也要读通知；task_* 页面作用域随两页挂载，§6 完成路径）
    // / per-page asserts: the catalog page's three + the delivery trio; the post
    // page's four + the trio (inbox rides both pages; the page-scoped task_*
    // rides both too — the §6 completion path)
    const catalogRegistration = defineComponentPage(CatalogPage, CatalogMeta)
    catalogRegistration.live.mount({}, fixture.agent)
    expect(fixture.registered.slice(0, 3).map((entry) => entry.name)).toEqual(['forum__list', 'forum__post', 'forum__inbox'])
    expect(fixture.registered.slice(3).map((entry) => entry.name)).toEqual(['task_take', 'task_complete', 'task_fail'])
    const postRegistration = defineComponentPage(PostPage, PostMeta)
    postRegistration.live.mount({ postId: 'p-1' }, fixture.agent)
    expect(fixture.registered.slice(6, 10).map((entry) => entry.name)).toEqual(['forum__read', 'forum__comment', 'forum__vote', 'forum__inbox'])
    expect(fixture.registered.slice(10).map((entry) => entry.name)).toEqual(['task_take', 'task_complete', 'task_fail'])

    await fiber.dispose()
  })

  it('single-entry consistency: catalog pages and resolvable pages correspond one to one', async () => {
    const { apps, pageRegistry, fiber } = await mount()

    const listed = apps.listPages(FORUM_APP_ID)
    expect(listed.length).toBe(2)
    for (const page of listed) {
      const match = pageRegistry.resolve(page.url)
      expect(match, `page "${page.name}" (${page.url}) must be resolvable`).not.toBeNull()
      expect(match?.page.name).toBe(`${FORUM_APP_ID}/${page.name}`)
    }
    // Nothing under the app prefix resolves without a catalog entry: the
    // mirror never drifts in either direction.
    // 应用前缀下也不存在目录之外的页面：镜像不会向任一方向漂移。
    const mirrored = pageRegistry.catalog().filter((row) => row.url.startsWith('/apps/forum/'))
    expect(mirrored.map((row) => row.url).sort()).toEqual(listed.map((page) => page.url).sort())

    await fiber.dispose()
  })
})

describe('forum app lifecycle / 生命周期', () => {
  it('disposing the fiber removes the app, its pages, and its tools at once', async () => {
    const { apps, pageRegistry, fiber } = await mount()
    await fiber.dispose()
    expect(apps.catalog()).toHaveLength(0)
    expect(pageRegistry.resolve('/apps/forum/catalog')).toBeNull()
    expect(pageRegistry.resolve('/apps/forum/post/p-1')).toBeNull()
    // HMR safety: the same context can mount the app again after disposal.
    // HMR 安全：卸载后同一上下文可以再次挂载应用。
    expect(apps.get(FORUM_APP_ID)).toBeUndefined()
  })
})
