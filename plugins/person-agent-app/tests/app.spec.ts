/**
 * 组合测试：真实 cordis Context + 真实 AppRegistryService/PageRegistryService，
 * 锁定验收面：目录可发现、入口 URL 可解析、页面 URL 前缀、工具全名、
 * 单入口一致性、卸载清理、正文（load 快照 + 闭包同步读）首帧真实数据、
 * 异步面的读取失败显式降级（服务都是硬 inject）。
 * Composition tests: real cordis Context with real registries; locks catalog
 * discovery, entry-url resolution, url prefixes, full tool names, single-entry
 * consistency, teardown, the first-frame real data (load snapshots + closure
 * sync reads), and the async face's explicit read-failure degrade (all services
 * are hard injects).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import AppRegistryPlugin, { AppRegistryService } from '@veren/app-registry'
import PageRegistryPlugin, { PageRegistryService } from '@veren/page-registry'
import { apply, inject, name } from '../src/index.ts'
import { APP_DEFINITION, APP_ID } from '../src/app.ts'
import { defineComponentPage } from '@veren/prompt-page'
import type { ComponentPageMeta, PageParams } from '@veren/prompt-page'
import { bindPersonAgentContext, OverviewMeta, OverviewPage, WorkspacesMeta, WorkspacesPage } from '../src/pages.tsx'

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
    // live 必须透传（与真实宿主 wire.ts 同缝）：live 改必填后，丢绑定会在登记处抛错。
    // `live` must pass through (the same seam as the real host's wire.ts): with live
    // required, dropping the binding now throws at registration.
    registerAppPage: (appId: never, page: never, live: never) => pageRegistry.registerAppPage(appId, page, live),
    releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
  })
  ctx.provide('workspaceRegistry', fakeWorkspaceRegistry(options.workspaces) as never)
  ctx.provide('taskCenter', fakeTaskCenter(options) as never)
  // 页面正文的另外两块部署事实：预设名单与模型目录。默认给真实形状的数据，
  // 失败测试用开关让读取抛错，钉住"失败如实渲染、不编造"。
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
  const fiber = ctx.plugin({ name, inject, apply })
  await fiber
  return { ctx, apps, pageRegistry, fiber }
}

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.reverse()) await dispose()
  disposers.length = 0
})

/**
 * 假会话 agent：记录组件体直登的定义（页面的工具面断言源）。
 * A fake session agent: records the body's direct registrations (the assertion
 * source of a page's tool face).
 */
function fakeAgent() {
  const registered: Array<{ name: string; definition: unknown }> = []
  const followups: string[] = []
  const skills: Array<{ name: string; description: string; content: string }> = []
  const agent = {
    ctx: {
      tools: {
        register: (definition: { name: string }) => {
          registered.push({ name: definition.name, definition })
          return () => undefined
        },
      },
      // 组件体的首屏读经 effect 发起：这里立即执行，promise 异步落定
      // / the body's first-screen read starts via an effect: run it now, the promise settles async
      effect: (run: () => unknown) => { void Promise.resolve().then(run); return async () => undefined },
      on: () => () => undefined,
      // 单会话 skill 组件体直登的断言面 / the assertion face of body-registered single-session skills
      skills: {
        register: (skill: { name: string; description: string; content: string }) => {
          skills.push(skill)
          return () => undefined
        },
      },
    },
    session: { id: 'spec' },
    followup: (message: { content: ReadonlyArray<{ type: string; text?: string }> }) => {
      followups.push(...message.content.map((block) => block.text ?? ''))
    },
  }
  return { agent: agent as never, registered, followups, skills }
}

/**
 * 挂载真实页面组件（一次性渲染）：组件体在假 agent 上执行恰好一次——登记名剥去
 * `person_agent__` 前缀返回；异步首屏由组件体自己的 effect 读出、经 followup
 * 送达（本帮手不等它，测试按需 vi.waitFor）。
 * Mount a real page component (one-shot): the body runs exactly once on the
 * fake agent — registered names come back with the `person_agent__` prefix
 * stripped; the async first screen is read by the body's own effect and
 * delivered via followup (this helper does not wait for it; tests vi.waitFor
 * as needed).
 */
async function mountPage(component: (props: never, agent: never) => unknown, meta: ComponentPageMeta<never>, ctx: Context, params: PageParams = {}): Promise<{
  body: string
  followups: () => string[]
  skills: () => Array<{ name: string; description: string; content: string }>
  recorded: () => string[]
  definitions: () => { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }[]
}> {
  const fake = fakeAgent()
  const body = defineComponentPage(component as never, meta).live.mount(params, fake.agent)
  return {
    body,
    followups: () => fake.followups,
    skills: () => fake.skills,
    recorded: () => fake.registered.map((entry) => entry.name.replace('person_agent__', '')),
    definitions: () => fake.registered.map((entry) => entry.definition as { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }),
  }
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

  it('所有页面 URL 都是 /apps/person-agent/...，不绑定预设', async () => {
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

  it('应用目录没有工具：工具只在页面存在（设计律），页面登记面即全部工具面', async () => {
    const { apps, ctx, fiber } = await install()
    disposers.push(() => fiber.dispose())
    // 应用级目录零条目——collectAppTools 清单模式已退役；工具面唯一的去处是
    // 页面组件体（mountPage 的记录断言见下）。应用目录连工具面都没有（新契约下
    // 目录工具清单整个退役），工具唯一的家是页面组件体。
    // / The app-level catalog holds nothing — under the new contract the catalog
    // tool manifest is gone entirely, so a tool face has exactly one home: the
    // page component body.
    expect('tools' in apps).toBe(false)
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

  it('概览页"会话明细现查"的承诺有工具承接：说明点名 workspace_session_list，组件体就真登记它', async () => {
    const { ctx, apps, fiber } = await install()
    disposers.push(() => fiber.dispose())
    const home = apps.listPages(APP_ID).find((page) => page.name === APP_DEFINITION.entry)
    if (home === undefined) throw new Error('the overview page must be registered')
    // 真机教训：overview 曾一个 person_agent__* 工具都不挂，说明里的承诺成了空头
    // 支票。钉死"承诺与登记一致"：说明里点名现查工具 → 组件体必须真登记它；反之
    // 登记的工具也必须被说明提到（不许出现模型看不见来源的能力）。
    // / Live-host lesson: the overview once mounted no person_agent__* tool at
    // all, leaving the instructions' promise empty. Pin promise-vs-record:
    // naming an on-demand tool in the instructions requires really registering it
    // in the body; and every registered tool must be named in the instructions
    // (no capability whose source the model cannot see).
    if (home.instructions === undefined) throw new Error('the overview page must carry instructions')
    expect(home.instructions).toContain('workspace_session_list')
    // 登记面核对：组件体的记录里必须有它（承诺 = 登记 / promise = registration）
    bindPersonAgentContext(ctx)
    const { recorded } = await mountPage(OverviewPage, OverviewMeta, ctx)
    expect(recorded()).toContain('workspace_session_list')
  })

  it('概览页正文：同步面首帧即真实数据，异步面在 load 取齐后进正文（一次性渲染，无 loading 态）', async () => {
    const { ctx, fiber } = await install({ openTitles: ['唯一任务'] })
    disposers.push(() => fiber.dispose())
    bindPersonAgentContext(ctx)
    const page = await mountPage(OverviewPage, OverviewMeta, ctx)
    // 同步面（apps/workspaces）正文直读 / sync faces (apps/workspaces) read straight in the body
    expect(page.body).toContain('Workspace List')
    expect(page.body).toContain('主工作区（id: ws-1；会话账目 2）')
    expect(page.body).toContain('副工作区（id: ws-2；会话账目 0）')
    expect(page.body).toContain('工作区 2 个')
    expect(page.body).toContain('Person Agent')
    // 异步面（tasks/presets/models）由组件体 effect 读出、经 followup 消息送达
    // （失败态在消息里如实渲染）
    // / async faces (tasks/presets/models) are read by the body's effect and
    // delivered as a followup message (failures render honestly in it)
    await vi.waitFor(() => expect(page.followups().length).toBeGreaterThan(0))
    const msg = page.followups().join('\n')
    expect(msg).toContain('open 任务 1 条')
    expect(msg).toContain('Agent Preset List')
    expect(msg).toContain('Standard mode(standard)')
    expect(msg).toContain('Person Agent(person-agent):Bridge')
    expect(msg).toContain('（不可用：activation failed）')
    expect(msg).toContain('Model Catalog')
    expect(msg).toContain('DeepSeek(deepseek)')
    expect(msg).toContain('DeepSeek Flash(deepseek-flash)')
    expect(msg).toContain('context 128000 tokens')
  })

  it('预设/模型读取失败：正文如实标注原因，工作区与任务区不受影响', async () => {
    const { ctx, fiber } = await install({ failPresetList: true, failModelList: true })
    disposers.push(() => fiber.dispose())
    bindPersonAgentContext(ctx)
    const page = await mountPage(OverviewPage, OverviewMeta, ctx)
    await vi.waitFor(() => expect(page.followups().length).toBeGreaterThan(0))
    const msg = page.followups().join('\n')
    expect(page.body).toContain('主工作区（id: ws-1；会话账目 2）')
    expect(msg).toContain('预设名单）读取失败：preset registry down')
    expect(msg).toContain('模型目录）读取失败：llm registry down')
  })

  it('工作区浏览页正文直读：打开即真实工作区行（ws-1/会话账目 2），零 loading 态', async () => {
    const { ctx, fiber } = await install({ openTitles: [] })
    disposers.push(() => fiber.dispose())
    bindPersonAgentContext(ctx)
    const { body } = await mountPage(WorkspacesPage, WorkspacesMeta, ctx)
    expect(body).toContain('主工作区（id: ws-1；会话账目 2）')
    expect(body).toContain('共 2 个工作区')
  })

  it('工作区 id 进正文：工具按 id 解析，正文必须给出 id（标题只是展示名）', async () => {
    const { ctx, fiber } = await install({ openTitles: [] })
    disposers.push(() => fiber.dispose())
    // 真机教训：正文只渲染标题（default-workspace）时，模型会把标题当 id 传进
    // workspace_session_list，得到 WORKSPACE_NOT_FOUND——promise 必须带事实来源。
    // / Live-host lesson: when the body rendered only titles (default-workspace),
    // the model passed the title as the id and got WORKSPACE_NOT_FOUND — every
    // promise must carry its source of fact.
    bindPersonAgentContext(ctx)
    const workspaces = await mountPage(WorkspacesPage, WorkspacesMeta, ctx)
    expect(workspaces.body).toContain('id: ws-1')
    expect(workspaces.body).toContain('id: ws-2')
    // 概览页同样带来下钻/建会话工具，正文也必须给 id
    // / the overview mounts the same drilldown/create tools, so its body must carry ids too
    const overview = await mountPage(OverviewPage, OverviewMeta, ctx)
    expect(overview.body).toContain('id: ws-1')
    // 说明必须指向 id 而不是标题 / the instructions must point at the id, not the title
    expect(WorkspacesMeta.instructions).toContain('id:')
    expect(OverviewMeta.instructions).toContain('id:')
  })
})

describe('工具只在页面存在：组件体登记即页面全部工具面', () => {
  it('概览页组件体登记十件工具，instructions 逐一点名（承诺 = 登记）', async () => {
    const { ctx, fiber } = await install()
    disposers.push(() => fiber.dispose())
    bindPersonAgentContext(ctx)
    const { recorded } = await mountPage(OverviewPage, OverviewMeta, ctx)
    // 设计律下的完整清单：无状态九件就地登记，session_dispatch 携带结算看守
    // （agent.ctx.effect 登记项，看守随 agent 销毁结清）。顺序 = 组件体书写顺序 + effect 项。
    // / the full list under the design law: nine stateless tools register in
    // place, session_dispatch carries the settlement watch (the agent.ctx.effect
    // entry; the watch settles at agent disposal). Order = body order, with the
    // effect entry last.
    expect(recorded()).toEqual([
      'session_create',
      'session_rename',
      'session_archive',
      'session_unarchive',
      'session_pin',
      'session_unpin',
      'workspace_create',
      'workspace_rename',
      'workspace_session_list',
      'session_dispatch',
    ])
    const instructions = OverviewMeta.instructions ?? ''
    // 组件体登记的每个工具都必须被说明点名 / every body-registered tool is named in the instructions
    for (const name of recorded()) {
      expect(instructions).toContain(name)
    }
  })

  it('工作区页组件体登记四件工具，instructions 逐一点名', async () => {
    const { ctx, fiber } = await install()
    disposers.push(() => fiber.dispose())
    bindPersonAgentContext(ctx)
    const { recorded } = await mountPage(WorkspacesPage, WorkspacesMeta, ctx)
    expect(recorded()).toEqual(['workspace_session_list', 'session_create', 'workspace_create', 'workspace_rename'])
    const instructions = WorkspacesMeta.instructions ?? ''
    for (const name of recorded()) {
      expect(instructions).toContain(name)
    }
  })

  it('renhua 随两页由组件体直登为单会话 skill：name/description/content 齐全（与工具同机制）', async () => {
    const { ctx } = await install()
    // 单会话 skill 与工具同一承诺律：页面直登、随 agent fiber 生灭；
    // 宿主不经手挂载（meta.skills/mountSkills 已随 load 一起退役）。
    // / A single-session skill carries the same promise law as the tools:
    // the body registers it, it lives and dies with the agent fiber, and the
    // host never mounts one (meta.skills/mountSkills died with load).
    bindPersonAgentContext(ctx)
    for (const [pageName, component, meta] of [['overview', OverviewPage, OverviewMeta], ['workspaces', WorkspacesPage, WorkspacesMeta]] as const) {
      const page = await mountPage(component, meta, ctx)
      const skill = page.skills().find((entry) => entry.name === 'renhua')
      expect(skill, `${pageName} 页必须直登 renhua`).toBeDefined()
      expect(skill?.description.length).toBeGreaterThan(0)
      expect(skill?.content).toContain('人话')
    }
  })

  it('页面登记的工具执行不撞属性守卫：会话事实依赖在 inject 里声明且真能读到', async () => {
    const { ctx, fiber } = await install()
    disposers.push(() => fiber.dispose())
    bindPersonAgentContext(ctx)
    const { definitions } = await mountPage(OverviewPage, OverviewMeta, ctx)
    const tool = definitions().find((entry) => entry.name === 'person_agent__workspace_session_list')
    if (tool === undefined) throw new Error('workspace_session_list must be registered by the overview body')
    // 真机教训：页面登记的工具闭包捕获应用 plugin ctx，缺 inject 时执行报
    // "cannot get property \"sessions\" without inject"——这里用真实 plugin ctx
    // 执行一次，钉住 sessions / sessionProjections 两条属性访问路径。
    // / Live-host lesson: page-registered tools close over the app plugin ctx;
    // without the inject they fail with 'cannot get property "sessions" without
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
})

describe('真实数据与读取失败降级', () => {
  it('taskCenter 读取失败：任务区如实标注原因，同步两区照常给真实数据', async () => {
    const { ctx, fiber } = await install({ failList: true, workspaces: undefined })
    disposers.push(() => fiber.dispose())
    bindPersonAgentContext(ctx)
    const page = await mountPage(OverviewPage, OverviewMeta, ctx)
    await vi.waitFor(() => expect(page.followups().length).toBeGreaterThan(0))
    // 同步区首帧照常真实；失败显式降级进首屏消息（不抛异常、不编造）
    // / sync sections stay real on frame 1; the failure degrades explicitly into the first-screen message (no throw, no faking)
    expect(page.body).toContain('主工作区（id: ws-1；会话账目 2）')
    expect(page.followups().join('\n')).toContain('待办任务读取失败：storage backend down')
  })

  it('workspaceRegistry 在场：workspaces 页给出真实行；注册表为空时给出空列表', async () => {
    const withWorkspaces = await install()
    disposers.push(() => withWorkspaces.fiber.dispose())
    bindPersonAgentContext(withWorkspaces.ctx)
    const withMount = await mountPage(WorkspacesPage, WorkspacesMeta, withWorkspaces.ctx)
    expect(withMount.body).toContain('主工作区（id: ws-1；会话账目 2）')
    const empty = await install({ workspaces: [] })
    disposers.push(() => empty.fiber.dispose())
    bindPersonAgentContext(empty.ctx)
    const emptyMount = await mountPage(WorkspacesPage, WorkspacesMeta, empty.ctx)
    expect(emptyMount.body).toContain('共 0 个工作区')
  })
})
