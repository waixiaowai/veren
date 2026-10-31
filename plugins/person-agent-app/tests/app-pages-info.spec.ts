/**
 * §3.10 页面信息组织：首页必须把该给的信息给全——map 覆盖、说明点名即组件体
 * 登记（承诺 = 登记）、同步面首帧真实数据、异步面 load 取齐后进正文、读取失败
 * 如实标注（不编造），以及工作区 id 必须进正文。
 * §3.10 page information organization: the home page must give the full picture —
 * map coverage, instructions naming equals body registration (promise =
 * registration), real first-frame sync data, async sections landing after load,
 * honest failure labeling (never faked), and workspace ids carried in the body.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_DEFINITION, APP_ID } from '../src/app.ts'
import { bindPersonAgentContext, OverviewMeta, OverviewPage, WorkspacesMeta, WorkspacesPage } from '../src/pages.tsx'
import { disposeTracked, install, mountPage, trackDisposer } from './app-harness.ts'

afterEach(disposeTracked)

describe('§3.10 页面信息组织：首页必须把该给的信息给全', () => {
  it('首页（entry）零结构问题：map 覆盖全部详情页、每条带"什么时候用"', async () => {
    const { apps, fiber } = await install()
    trackDisposer(() => fiber.dispose())
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
    trackDisposer(() => fiber.dispose())
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
    trackDisposer(() => fiber.dispose())
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
    trackDisposer(() => fiber.dispose())
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
    trackDisposer(() => fiber.dispose())
    bindPersonAgentContext(ctx)
    const { body } = await mountPage(WorkspacesPage, WorkspacesMeta, ctx)
    expect(body).toContain('主工作区（id: ws-1；会话账目 2）')
    expect(body).toContain('共 2 个工作区')
  })

  it('工作区 id 进正文：工具按 id 解析，正文必须给出 id（标题只是展示名）', async () => {
    const { ctx, fiber } = await install({ openTitles: [] })
    trackDisposer(() => fiber.dispose())
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
