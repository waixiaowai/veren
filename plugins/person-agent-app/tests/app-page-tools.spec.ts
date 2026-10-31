/**
 * 工具只在页面存在：组件体登记即页面全部工具面——清单逐一对齐、说明逐一点名
 * （承诺 = 登记）、renhua 随页直登为单会话 skill，以及页面登记工具经真实
 * plugin ctx 执行不撞属性守卫。
 * A tool exists only inside a page: the body's registrations ARE the page's
 * whole tool face — the list aligns item by item, the instructions name each one
 * (promise = registration), renhua rides the page as a body-registered
 * single-session skill, and a body-registered tool executes through the real
 * plugin ctx without tripping the property guard.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { bindPersonAgentContext, OverviewMeta, OverviewPage, WorkspacesMeta, WorkspacesPage } from '../src/pages.tsx'
import { disposeTracked, install, mountPage, trackDisposer } from './app-harness.ts'

afterEach(disposeTracked)

describe('工具只在页面存在：组件体登记即页面全部工具面', () => {
  it('概览页组件体登记十件工具，instructions 逐一点名（承诺 = 登记）', async () => {
    const { ctx, fiber } = await install()
    trackDisposer(() => fiber.dispose())
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
    trackDisposer(() => fiber.dispose())
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
    trackDisposer(() => fiber.dispose())
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
