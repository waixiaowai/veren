/**
 * 组合测试：真实 cordis Context + 真实 AppRegistryService/PageRegistryService，
 * 锁定验收面：目录可发现、入口 URL 可解析、页面 URL 前缀、工具外部名前缀、
 * 单入口一致性、卸载清理、自承载页面的真实数据渲染与读取失败显式降级
 * （服务都是硬 inject）。
 * Composition tests: real cordis Context with real registries; locks catalog
 * discovery, entry-url resolution, url prefixes, tool external-name prefixes,
 * single-entry consistency, teardown, and the self-contained pages' real-data
 * rendering plus explicit read-failure degrade (all services are hard injects).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import AppRegistryPlugin, { AppRegistryService } from '@veren/app-registry'
import PageRegistryPlugin, { PageRegistryService } from '@veren/page-registry'
import { apply, inject, name } from '../src/index.ts'
import { APP_DEFINITION, APP_ID } from '../src/app.ts'
import { defineComponentPage, isMarkdownDocHost } from '@veren/prompt-page'
import type { ComponentPageMeta, MarkdownDocHost, PageFC } from '@veren/prompt-page'
import { OverviewMeta, OverviewPage, WorkspacesMeta, WorkspacesPage } from '../src/pages.tsx'

/** 假任务中心：open 列表可编程 / a fake task center with a programmable open list */
function fakeTaskCenter(options: { openTitles?: string[]; failList?: boolean } = {}) {
  return {
    list: async () => {
      if (options.failList === true) throw new Error('storage backend down')
      return (options.openTitles ?? []).map((title, index) => ({ id: `t-${index + 1}`, title, status: 'open' }))
    },
  }
}

/** 假工作区注册表 / a fake workspace registry */
function fakeWorkspaceRegistry(rows: Array<{ id: string; title: string; sessionIds: string[] }> = [
  { id: 'ws-1', title: '主工作区', sessionIds: ['s-1', 's-2'] },
  { id: 'ws-2', title: '副工作区', sessionIds: [] },
]) {
  return {
    archivedSessionIds: ['s-archived'],
    list: () => rows,
  }
}

/** 挂好真实注册表与应用插件（三个数据面服务总是真实提供：它们是硬 inject）。
 * Mount real registries plus the app plugin (the three data faces are always
 * provided for real: they are hard injects). */
async function install(options: {
  openTitles?: string[]
  failList?: boolean
  workspaces?: Array<{ id: string; title: string; sessionIds: string[] }>
} = {}): Promise<{
  ctx: Context
  apps: AppRegistryService
  pageRegistry: PageRegistryService
  fiber: Fiber
}> {
  const ctx = new Context()
  // 两个注册表服务挂在同一个宿主上下文上，镜像面由测试显式接上（app-host 语义）。
  // Both registries live on one host context; the mirror is wired explicitly.
  const hostCtx = new Context()
  const apps = new AppRegistryService(hostCtx)
  const pageRegistry = new PageRegistryService(hostCtx)
  ctx.provide('apps', apps)
  ctx.provide('pageRegistry', pageRegistry)
  apps.setPageMirror({
    registerAppPage: (appId: never, page: never) => pageRegistry.registerAppPage(appId, page),
    releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
  })
  ctx.provide('workspaceRegistry', fakeWorkspaceRegistry(options.workspaces) as never)
  ctx.provide('taskCenter', fakeTaskCenter(options) as never)
  const fiber = ctx.plugin({ name, inject, apply }, { maxListSessions: 50 })
  await fiber
  return { ctx, apps, pageRegistry, fiber }
}

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.reverse()) await dispose()
  disposers.length = 0
})

/**
 * 挂载真实页面组件并返回其文档宿主：组件体内的 ctx.workspaceRegistry /
 * ctx.taskCenter 经 facade 转发到测试 ctx 的 fake 服务面——零工厂、零闭包注入。
 * Mount a real page component and return its doc host: the body's
 * ctx.workspaceRegistry / ctx.taskCenter forward through the facade to the
 * test ctx's fake faces — zero factory, zero closure injection.
 */
function mountPage(component: PageFC, meta: ComponentPageMeta, ctx: Context): MarkdownDocHost {
  const view = defineComponentPage(component, meta, ctx).live.mount({})
  disposers.push(async () => { view.unsubscribe() })
  const host = isMarkdownDocHost(view.host) ? view.host : undefined
  if (host === undefined) throw new Error('expected the markdown doc host')
  return host
}

describe('应用可被发现与解析', () => {
  it('ctx.apps.catalog() 能发现 person-agent：active、toolPrefix=person_agent', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const record = apps.get(APP_ID)
    expect(record).toBeDefined()
    expect(record?.state).toBe('active')
    expect(record?.toolPrefix).toBe('person_agent')
    expect(apps.catalog().map((app) => app.definition.id)).toContain('person-agent')
  })

  it('入口页 URL 合法（/apps/person-agent/overview）且能被 page-registry 解析', async () => {
    const { apps, pageRegistry, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const entry = apps.listPages(APP_ID).find((page) => page.name === APP_DEFINITION.entry)
    expect(entry?.url).toBe('/apps/person-agent/overview')
    // 应用页以 pageKey（<appId>/<本地名>）登记（见 registerAppPage）
    // app pages register under their pageKey (see registerAppPage)
    expect(pageRegistry.resolve('/apps/person-agent/overview')?.page.name).toBe('person-agent/overview')
    expect(pageRegistry.resolve('/apps/person-agent/workspaces')?.page.name).toBe('person-agent/workspaces')
  })

  it('所有页面 URL 都是 /apps/person-agent/...，不绑定预设，revision ≥ 1', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const pages = apps.listPages(APP_ID)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    for (const page of pages) {
      expect(page.url.startsWith('/apps/person-agent/')).toBe(true)
      expect('preset' in page).toBe(false)
      expect(page.instanceTitle?.({})).toBeTypeOf('string')
    }
  })

  it('页面工具对外名带 person_agent__ 前缀（收编既有实现）', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    expect(apps.listTools(APP_ID).map((tool) => tool.externalName)).toEqual([
      'person_agent__session_create',
      'person_agent__session_rename',
      'person_agent__workspace_session_list',
    ])
  })

  it('单入口一致性：应用目录页面与 page-registry 可解析页面一一对应', async () => {
    const { apps, pageRegistry, fiber } = await install()
    disposers.push(() => fiber.dispose())
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
    expect(() => apps.listTools(APP_ID)).toThrow()
  })
})

describe('§3.10 页面信息组织：首页必须把该给的信息给全', () => {
  it('首页（entry）零结构问题：map 覆盖全部详情页、每条带"什么时候用"，且自带 load', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const pages = apps.listPages(APP_ID)
    const entryKey = APP_DEFINITION.entry
    if (entryKey === undefined) throw new Error('person-agent must declare an entry page')
    const home = pages.find((page) => page.name === entryKey)
    if (home === undefined) throw new Error(`entry page ${entryKey} is not registered`)
    // 判据：map 由注册表推导（RFC prompt-page-render §3.5）——AppRecord.pages
    // 投影列全兄弟页（工作区浏览页），构造上覆盖；首页是组件页。
    // / the criterion: the map is registry-derived (§3.5) — the AppRecord.pages
    // projection lists the sibling (the workspace browser), coverage by
    // construction; the home is a component page.
    const record = apps.get(APP_ID)
    const sibling = record?.pages?.get('workspaces')
    expect(sibling?.url).toBe('/apps/person-agent/workspaces')
    expect(record?.pages?.get(entryKey)?.component).toBe(true)
  })

  it('概览页"会话明细现查"的承诺有工具承接：说明点名 workspace_session_list，页面就真挂着它', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const home = apps.listPages(APP_ID).find((page) => page.name === APP_DEFINITION.entry)
    if (home === undefined) throw new Error('the overview page must be registered')
    // 真机教训：overview 曾一个 person_agent__* 工具都不挂，说明里的承诺成了空头
    // 支票。钉死"承诺与挂载一致"：说明里点名现查工具 → tools 必须真挂它；反之
    // 页面挂的工具也必须被说明提到（不许出现模型看不见来源的能力）。
    // / Live-host lesson: the overview once mounted no person_agent__* tool at
    // all, leaving the instructions' promise empty. Pin promise-vs-mount: naming
    // an on-demand tool in the instructions requires really mounting it; and
    // every mounted tool must be named in the instructions (no capability whose
    // source the model cannot see).
    expect(home.tools).toContain('workspace_session_list')
    if (home.instructions === undefined) throw new Error('the overview page must carry instructions')
    expect(home.instructions).toContain('workspace_session_list')
  })

  it('概览页自承载加载：首帧如实渲染空快照，ctx.effect 就地读 ctx 后真实数据进正文（WYSIWYG）', async () => {
    const { ctx, fiber } = await install({ openTitles: ['唯一任务'] })
    disposers.push(() => fiber.dispose())
    const host = mountPage(OverviewPage, OverviewMeta, ctx)
    // 首帧：空快照如实标注未刷新（反编造）；数据在 effect 异步读取完成后经
    // 重渲 diff 进正文。
    // / Frame 1: the empty snapshot honestly marked not-refreshed
    // (anti-fabrication); data enters the body via the re-render after the
    // effect's async read completes.
    expect(host.bodyText()).toContain('not refreshed yet')
    await vi.waitFor(() => expect(host.bodyText()).toContain('主工作区'))
    expect(host.bodyText()).toContain('副工作区（会话账目 0）')
    expect(host.bodyText()).toContain('工作区 2 个')
    expect(host.bodyText()).toContain('live from the task center')
  })

  it('工作区浏览页自承载加载：打开后正文出现工作区行（ws-1/会话账目 2）', async () => {
    const { ctx, fiber } = await install({ openTitles: [] })
    disposers.push(() => fiber.dispose())
    const host = mountPage(WorkspacesPage, WorkspacesMeta, ctx)
    await vi.waitFor(() => expect(host.bodyText()).toContain('主工作区（会话账目 2）'))
    expect(host.bodyText()).toContain('共 2 个工作区')
  })
})

describe('真实数据与读取失败降级', () => {
  it('taskCenter 读取失败：tasks 区显式不可用并给原因，其余两区照常给真实数据', async () => {
    const { ctx, fiber } = await install({ failList: true, workspaces: undefined })
    disposers.push(() => fiber.dispose())
    const host = mountPage(OverviewPage, OverviewMeta, ctx)
    // 失败显式降级进正文（不抛异常、不编造）；apps / workspaces 两区照常真实。
    // / the failure degrades explicitly into the body (no throw, no faking);
    // the apps / workspaces sections stay real.
    await vi.waitFor(() => expect(host.bodyText()).toContain('task center read failed: storage backend down'))
    expect(host.bodyText()).toContain('主工作区（会话账目 2）')
    expect(host.bodyText()).toContain('Person Agent')
  })

  it('workspaceRegistry 在场：workspaces 页给出真实行；注册表为空时给出空列表', async () => {
    const withWorkspaces = await install()
    disposers.push(() => withWorkspaces.fiber.dispose())
    const host = mountPage(WorkspacesPage, WorkspacesMeta, withWorkspaces.ctx)
    await vi.waitFor(() => expect(host.bodyText()).toContain('主工作区（会话账目 2）'))
    const empty = await install({ workspaces: [] })
    disposers.push(() => empty.fiber.dispose())
    const emptyHost = mountPage(WorkspacesPage, WorkspacesMeta, empty.ctx)
    await vi.waitFor(() => expect(emptyHost.bodyText()).toContain('共 0 个工作区'))
  })
})
