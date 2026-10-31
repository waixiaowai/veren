/**
 * 组合测试（可发现性与生命周期）：真实 cordis Context + 真实
 * AppRegistryService/PageRegistryService，锁定验收面：目录可发现、入口 URL 可
 * 解析、页面 URL 前缀、单入口一致性、卸载清理。（页面信息组织、工具面与降级
 * 场景分别在 app-pages-info / app-page-tools / app-data-degrade 两个 spec。）
 * Composition tests (discoverability and lifecycle): a real cordis Context with
 * real registries; locks catalog discovery, entry-url resolution, url prefixes,
 * single-entry consistency, and teardown. (Page information organization, the
 * tool face, and the degrade scenarios live in app-pages-info, app-page-tools
 * and app-data-degrade.)
 */
import { afterEach, describe, expect, it } from 'vitest'
import { APP_DEFINITION, APP_ID } from '../src/app.ts'
import { disposeTracked, install, trackDisposer } from './app-harness.ts'

afterEach(disposeTracked)

describe('应用可被发现与解析', () => {
  it('ctx.apps.catalog() 能发现 person-agent：active、toolPrefix=person_agent', async () => {
    const { apps, fiber } = await install()
    trackDisposer(() => fiber.dispose())
    const record = apps.get(APP_ID)
    expect(record).toBeDefined()
    expect(record?.state).toBe('active')
    expect(record?.toolPrefix).toBe('person_agent')
    expect(apps.catalog().map((app) => app.definition.id)).toContain('person-agent')
  })

  it('入口页 URL 合法（/apps/person-agent/overview）且能被 page-registry 解析', async () => {
    const { apps, pageRegistry, fiber } = await install()
    trackDisposer(() => fiber.dispose())
    const entry = apps.listPages(APP_ID).find((page) => page.name === APP_DEFINITION.entry)
    expect(entry?.url).toBe('/apps/person-agent/overview')
    // 应用页以 pageKey（<appId>/<本地名>）登记（见 registerAppPage）
    // app pages register under their pageKey (see registerAppPage)
    expect(pageRegistry.resolve('/apps/person-agent/overview')?.page.name).toBe('person-agent/overview')
    expect(pageRegistry.resolve('/apps/person-agent/workspaces')?.page.name).toBe('person-agent/workspaces')
  })

  it('所有页面 URL 都是 /apps/person-agent/...，不绑定预设', async () => {
    const { apps, fiber } = await install()
    trackDisposer(() => fiber.dispose())
    const pages = apps.listPages(APP_ID)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    for (const page of pages) {
      expect(page.url.startsWith('/apps/person-agent/')).toBe(true)
      expect('preset' in page).toBe(false)
      expect(page.instanceTitle?.({})).toBeTypeOf('string')
    }
  })

  it('应用目录没有工具：工具只在页面存在（设计律），页面登记面即全部工具面', async () => {
    const { apps, fiber } = await install()
    trackDisposer(() => fiber.dispose())
    // 应用级目录零条目——collectAppTools 清单模式已退役；工具面唯一的去处是
    // 页面组件体（mountPage 的记录断言见 app-page-tools.spec.ts）。应用目录连
    // 工具面都没有（新契约下目录工具清单整个退役），工具唯一的家是页面组件体。
    // / The app-level catalog holds nothing — under the new contract the catalog
    // tool manifest is gone entirely, so a tool face has exactly one home: the
    // page component body.
    expect('tools' in apps).toBe(false)
  })

  it('单入口一致性：应用目录页面与 page-registry 可解析页面一一对应', async () => {
    const { apps, pageRegistry, fiber } = await install()
    trackDisposer(() => fiber.dispose())
    const appUrls = apps.listPages(APP_ID).map((page) => page.url).sort()
    const registryUrls = pageRegistry.catalog()
      .map((entry) => entry.url)
      .filter((url) => url.startsWith('/apps/person-agent/'))
      .sort()
    expect(registryUrls).toEqual(appUrls)
    // 且每条都能解析 / every one of them resolves
    for (const url of appUrls) expect(pageRegistry.resolve(url)).not.toBeNull()
  })
})

describe('生命周期', () => {
  it('插件 fiber 销毁 → 整应用从 catalog 与 URL 索引同时摘除', async () => {
    const { apps, pageRegistry, fiber } = await install()
    await fiber.dispose()
    expect(apps.catalog()).toHaveLength(0)
    expect(pageRegistry.resolve('/apps/person-agent/overview')).toBeNull()
    expect(pageRegistry.resolve('/apps/person-agent/workspaces')).toBeNull()
  })
})
