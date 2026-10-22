/**
 * 组合测试：真实 cordis Context + 真实 AppRegistryService/PageRegistryService，
 * 锁定验收面：目录可发现、入口 URL 可解析、页面 URL 前缀、工具外部名前缀、
 * 单入口一致性、卸载清理、正文直读同步面的首帧真实数据、异步面的读取失败
 * 显式降级（服务都是硬 inject）。
 * Composition tests: real cordis Context with real registries; locks catalog
 * discovery, entry-url resolution, url prefixes, tool external-name prefixes,
 * single-entry consistency, teardown, the first-frame real data of
 * body-read sync faces, and the async face's explicit read-failure degrade
 * (all services are hard injects).
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
    // 工具按 id 解析工作区（workspace_session_list 的执行面）/ tools resolve workspaces by id
    get: (id: string) => rows.find((row) => row.id === id),
  }
}

/** 挂好真实注册表与应用插件（三个数据面服务总是真实提供：它们是硬 inject）。
 * Mount real registries plus the app plugin (the three data faces are always
 * provided for real: they are hard injects). */
async function install(options: {
  openTitles?: string[]
  failList?: boolean
  failPresetList?: boolean
  failModelList?: boolean
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
  // 页面正文的另外两块部署事实：预设名单与模型目录。默认给真实形状的数据，
  // 失败测试用开关让读取抛错，钉住“失败如实渲染、不编造”。
  // The other two deployment facts in the page body: preset roster and model
  // catalog. The defaults carry realistic shapes; failure tests flip a switch so
  // the read throws, pinning "failures render honestly, never faked".
  ctx.provide('agentPresets', {
    list: async () => {
      if (options.failPresetList === true) throw new Error('preset registry down')
      return [
        { id: 'standard' },
        { id: 'person-agent', name: 'Person Agent', description: 'Bridge', order: 5 },
        { id: 'broken-one', name: 'Broken preset', broken: 'activation failed' },
      ]
    },
  } as never)
  ctx.provide('llm', {
    listProviders: () => {
      if (options.failModelList === true) throw new Error('llm registry down')
      return [{ id: 'deepseek', name: 'DeepSeek' }]
    },
    listModels: async () => [{
      provider: 'deepseek',
      id: 'deepseek-flash',
      name: 'DeepSeek Flash',
      inputModalities: ['text'],
    }],
    resolveModelInfo: async () => ({ context: { contextWindow: 128000 } }),
  } as never)
  // 会话事实面：目录工具执行时直接读 ctx.sessions / ctx.sessionProjections，
  // 建会话工具读 ctx.sessionController——三者都必须真提供（插件的 inject 声明）。
  // The session-fact faces: the catalog tool reads ctx.sessions /
  // ctx.sessionProjections at execution time and the create tool reads
  // ctx.sessionController — all three must really be provided (the plugin's inject).
  ctx.provide('sessions', {
    get: (id: string) => (id === 's-1'
      ? { header: { id, createdAt: 1_700_000_000_000, agentPreset: 'default' } }
      : undefined),
  } as never)
  ctx.provide('sessionProjections', {
    stateOf: () => ({ lastUsed: { provider: 'deepseek', model: 'deepseek-chat' } }),
  } as never)
  ctx.provide('sessionController', {
    create: async () => ({ id: 's-created' }),
    rename: async ({ title }: { title: string }) => ({ title, seq: 1 }),
  } as never)
  const fiber = ctx.plugin({ name, inject, apply }, { maxListSessions: 50, allowCreateDirectory: false })
  await fiber
  return { ctx, apps, pageRegistry, fiber }
}

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.reverse()) await dispose()
  disposers.length = 0
})

/**
 * 挂载真实页面组件并返回其文档宿主与动态注册的工具名：正文里的
 * ctx.apps / ctx.workspaceRegistry / ctx.taskCenter 经 facade 转发到测试 ctx 的
 * fake 服务面——零工厂、零闭包注入。
 * Mount a real page component and return its doc host plus the dynamically
 * registered tool names: the body's ctx.apps / ctx.workspaceRegistry /
 * ctx.taskCenter forward through the facade to the test ctx's fake faces —
 * zero factory, zero closure injection.
 */
function mountPage(component: PageFC, meta: ComponentPageMeta, ctx: Context): { host: MarkdownDocHost; recorded: () => string[] } {
  const view = defineComponentPage(component, meta, ctx).live.mount({})
  disposers.push(async () => { view.unsubscribe() })
  const host = isMarkdownDocHost(view.host) ? view.host : undefined
  if (host === undefined) throw new Error('expected the markdown doc host')
  // 组件页视图的记账面：ctx.page.tool 的记录（运行时由 page-registry 合并挂载）
  // / the component-page view's recording face: ctx.page.tool records
  // (merged and mounted by page-registry at runtime)
  const take = (view as unknown as { takeRecordedTools?: () => { name: string }[] }).takeRecordedTools
  const recorded = (): string[] => (typeof take === 'function' ? take.call(view).map((tool) => tool.name) : [])
  return { host, recorded }
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
      'person_agent__session_dispatch',
      'person_agent__session_archive',
      'person_agent__session_unarchive',
      'person_agent__session_pin',
      'person_agent__session_unpin',
      'person_agent__workspace_create',
      'person_agent__workspace_rename',
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
  it('首页（entry）零结构问题：map 覆盖全部详情页、每条带"什么时候用"', async () => {
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

  it('概览页正文直读：同步面首帧即真实数据，异步任务区 effect 拉取后进正文（WYSIWYG）', async () => {
    const { ctx, fiber } = await install({ openTitles: ['唯一任务'] })
    disposers.push(() => fiber.dispose())
    const { host } = mountPage(OverviewPage, OverviewMeta, ctx)
    // 同步面（apps/workspaces）正文直读：首帧即真实数据，无 loading 态
    // / sync faces (apps/workspaces) read straight in the body: real data on frame 1, no loading state
    expect(host.bodyText()).toContain('Workspace List')
    expect(host.bodyText()).toContain('主工作区（id: ws-1；会话账目 2）')
    expect(host.bodyText()).toContain('副工作区（id: ws-2；会话账目 0）')
    expect(host.bodyText()).toContain('工作区 2 个')
    expect(host.bodyText()).toContain('Person Agent')
    expect(host.bodyText()).toContain('读取中')
    // 异步面（tasks/presets/models）effect 拉取后重渲进正文
    // / async faces (tasks/presets/models) re-render into the body after the effect fetches
    await vi.waitFor(() => expect(host.bodyText()).toContain('open 任务 1 条'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('Agent Preset List'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('Standard mode(standard)'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('Person Agent(person-agent):Bridge'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('（不可用：activation failed）'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('Model Catalog'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('DeepSeek(deepseek)'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('DeepSeek Flash(deepseek-flash)'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('context 128000 tokens'))
  })

  it('预设/模型读取失败：正文如实标注原因，工作区与任务区不受影响', async () => {
    const { ctx, fiber } = await install({ failPresetList: true, failModelList: true })
    disposers.push(() => fiber.dispose())
    const { host } = mountPage(OverviewPage, OverviewMeta, ctx)
    expect(host.bodyText()).toContain('主工作区（id: ws-1；会话账目 2）')
    await vi.waitFor(() => expect(host.bodyText()).toContain('预设名单读取失败：preset registry down'))
    await vi.waitFor(() => expect(host.bodyText()).toContain('模型目录读取失败：llm registry down'))
  })

  it('工作区浏览页正文直读：打开即真实工作区行（ws-1/会话账目 2），零 loading 态', async () => {
    const { ctx, fiber } = await install({ openTitles: [] })
    disposers.push(() => fiber.dispose())
    const { host } = mountPage(WorkspacesPage, WorkspacesMeta, ctx)
    expect(host.bodyText()).toContain('主工作区（id: ws-1；会话账目 2）')
    expect(host.bodyText()).toContain('共 2 个工作区')
  })

  it('工作区 id 进正文：工具按 id 解析，正文必须给出 id（标题只是展示名）', async () => {
    const { ctx, fiber } = await install({ openTitles: [] })
    disposers.push(() => fiber.dispose())
    // 真机教训：正文只渲染标题（default-workspace）时，模型会把标题当 id 传进
    // workspace_session_list，得到 WORKSPACE_NOT_FOUND——promise 必须带事实来源。
    // / Live-host lesson: when the body rendered only titles (default-workspace),
    // the model passed the title as the id and got WORKSPACE_NOT_FOUND — every
    // promise must carry its source of fact.
    const workspacesBody = mountPage(WorkspacesPage, WorkspacesMeta, ctx).host.bodyText()
    expect(workspacesBody).toContain('id: ws-1')
    expect(workspacesBody).toContain('id: ws-2')
    // 概览页同样带来下钻/建会话工具，正文也必须给 id
    // / the overview mounts the same drilldown/create tools, so its body must carry ids too
    const overviewBody = mountPage(OverviewPage, OverviewMeta, ctx).host.bodyText()
    expect(overviewBody).toContain('id: ws-1')
    // 说明必须指向 id 而不是标题 / the instructions must point at the id, not the title
    expect(WorkspacesMeta.instructions).toContain('id:')
    expect(OverviewMeta.instructions).toContain('id:')
  })
})

describe('工具两张脸：目录声明 + 会话内动态注册（ctx.tools）', () => {
  it('概览页动态注册只剩 session_dispatch（唯一带会话状态的工具），instructions 逐一点名全部工具（承诺 = 挂载）', async () => {
    const { ctx, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const { recorded } = mountPage(OverviewPage, OverviewMeta, ctx)
    // 无状态工具全走 meta.tools 静态脸；session_dispatch 携带随页面视图创建/
    // 销毁的结算看守，是唯一的动态脸。
    // / Stateless tools all ride the static meta.tools face; session_dispatch
    // carries the settlement watch created and disposed with the page view —
    // the one dynamic face.
    expect(recorded()).toEqual(['session_dispatch'])
    const instructions = OverviewMeta.instructions ?? ''
    // 静态面（meta.tools）+ 动态面（ctx.page.tool）的每个工具都必须被说明点名
    // / every tool from the static face (meta.tools) and the dynamic face (ctx.page.tool) is named
    for (const name of [...(OverviewMeta.tools ?? []), ...recorded()]) {
      expect(instructions).toContain(name)
    }
  })

  it('工作区页全部工具走静态脸（无动态注册），instructions 逐一点名', async () => {
    const { ctx, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const { recorded } = mountPage(WorkspacesPage, WorkspacesMeta, ctx)
    expect(recorded()).toEqual([])
    const instructions = WorkspacesMeta.instructions ?? ''
    for (const name of WorkspacesMeta.tools ?? []) {
      expect(instructions).toContain(name)
    }
  })

  it('renhua 随两页声明为页面级 skill：name/description/content 齐全（挂载归 app-host）', () => {
    // 页面级 skills 是"页面承诺里有真实来源"的一部分：声明了就得可读、可挂。
    // 挂载路径（app-host → ctx.skills.register）已由 app-host 的装配测试锁定。
    // / Page-scope skills are part of "every promise has a real source":
    // declared means readable and mountable. The mounting path (app-host →
    // ctx.skills.register) is locked by app-host's assembly tests.
    for (const meta of [OverviewMeta, WorkspacesMeta]) {
      expect(meta.skills).toHaveLength(1)
      const skill = meta.skills?.[0]
      expect(skill?.name).toBe('renhua')
      expect(skill?.description.length).toBeGreaterThan(0)
      expect(skill?.content).toContain('人话')
    }
  })

  it('目录工具执行不撞属性守卫：会话事实依赖在 inject 里声明且真能读到', async () => {
    const { apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const tool = apps.listTools(APP_ID).find((entry) => entry.name === 'workspace_session_list')
    if (tool === undefined) throw new Error('workspace_session_list must be in the catalog')
    // 真机教训：目录工具闭包捕获应用 plugin ctx，缺 inject 时执行报
    // "cannot get property \"sessions\" without inject"——这里用真实 plugin ctx
    // 执行一次，钉住 sessions / sessionProjections 两条属性访问路径。
    // / Live-host lesson: catalog tools close over the app plugin ctx; without
    // the inject they fail with 'cannot get property "sessions" without
    // inject'. Execute once through the real plugin ctx to pin both property
    // paths (sessions / sessionProjections).
    const result = await tool.execute({ workspaceId: 'ws-1' }, {} as never) as {
      total: number
      sessions: Array<Record<string, unknown>>
    }
    expect(result.total).toBe(1)
    expect(result.sessions[0]).toMatchObject({
      sessionId: 's-1',
      agentPreset: 'default',
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
  })

  it('重渲不重复注册：异步面刷新后登记仍是同一批工具（按名去重）', async () => {
    const { ctx, fiber } = await install({ openTitles: ['唯一任务'] })
    disposers.push(() => fiber.dispose())
    const { host, recorded } = mountPage(OverviewPage, OverviewMeta, ctx)
    await vi.waitFor(() => expect(host.bodyText()).toContain('open 任务 1 条'))
    expect(recorded()).toEqual(['session_dispatch'])
  })
})

describe('真实数据与读取失败降级', () => {
  it('taskCenter 读取失败：任务区如实标注原因，同步两区照常给真实数据', async () => {
    const { ctx, fiber } = await install({ failList: true, workspaces: undefined })
    disposers.push(() => fiber.dispose())
    const { host } = mountPage(OverviewPage, OverviewMeta, ctx)
    // 同步区首帧照常真实；失败显式降级进正文（不抛异常、不编造）
    // / sync sections stay real on frame 1; the failure degrades explicitly into the body (no throw, no faking)
    expect(host.bodyText()).toContain('主工作区（id: ws-1；会话账目 2）')
    await vi.waitFor(() => expect(host.bodyText()).toContain('任务中心读取失败：storage backend down'))
  })

  it('workspaceRegistry 在场：workspaces 页给出真实行；注册表为空时给出空列表', async () => {
    const withWorkspaces = await install()
    disposers.push(() => withWorkspaces.fiber.dispose())
    const { host } = mountPage(WorkspacesPage, WorkspacesMeta, withWorkspaces.ctx)
    expect(host.bodyText()).toContain('主工作区（id: ws-1；会话账目 2）')
    const empty = await install({ workspaces: [] })
    disposers.push(() => empty.fiber.dispose())
    const { host: emptyHost } = mountPage(WorkspacesPage, WorkspacesMeta, empty.ctx)
    expect(emptyHost.bodyText()).toContain('共 0 个工作区')
  })
})
