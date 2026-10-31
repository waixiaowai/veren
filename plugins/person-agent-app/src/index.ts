/**
 * @veren/person-agent-app 插件入口：把 Person Agent 注册成一个应用（定义 → 页面）。
 * 应用即整栈：桥梁人设在应用说明里，**工具清单在 pages.tsx 的组件体里**
 * （设计律：工具只在页面存在——没有应用级目录，没有全局注册的工具），renhua
 * 技能挂进页面会话的 agent 作用域，没有预设行。
 * Plugin entry: registers Person Agent as an application (definition → pages).
 * The app IS the whole stack: the bridge persona lives in the app instructions,
 * the **tool list lives in pages.tsx's component bodies** (design law: a tool
 * exists only inside a page — no app-level catalog, no globally registered
 * tools), the renhua skill mounts into each page session's agent scope, and
 * there is no preset row.
 *
 * 注册走单入口：ctx.apps.pages(id).register 内部镜像进 page-registry，
 * 不手动调 pageRegistry.registerAppPage。
 * Single entry: ctx.apps.pages(id).register mirrors into the page registry
 * internally; pageRegistry.registerAppPage is never called by hand.
 * @module @veren/person-agent-app
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import { APP_DEFINITION, APP_ID } from './app.ts'
import { bindPersonAgentContext, OverviewMeta, OverviewPage, WorkspacesMeta, WorkspacesPage } from './pages.tsx'

export const name = 'personAgentApp'

/** 应用无部署开关：工具面常量就近写在组件体里（pages.tsx），这里没有可配的东西。
 * / The app carries no deployment knobs: the tool-face constants live right in the component bodies (pages.tsx); nothing is configurable here. */
export interface Config {}

export const Config: z<Config> = z.object({})

// 服务依赖全部显式声明（G13）：本插件就是应用；workspaceRegistry /
// taskCenter / agentPresets / llm 由页面组件在渲染体内经组件 ctx 读取——在此
// 声明保证组件渲染时它们必然在场，不做运行期探测。
// 页面登记的工具闭包捕获**本插件的 ctx**，并在执行时直接读取
// `ctx.sessions` / `ctx.sessionProjections` / `ctx.sessionController`（见
// @veren/person-agent-tool-workspace 与 -tool-session 的实现）——属性守卫按属主
// 归因，缺少声明会在工具执行时报 "cannot get property ... without inject"，因此
// 这三个服务必须在这里声明（与工具包自身的 inject 清单保持一致）。
// All service dependencies are declared explicitly (G13): this plugin IS an
// app; workspaceRegistry / taskCenter / agentPresets / llm are read by the page
// components in their bodies via the component ctx — declaring them here
// guarantees they are present when the components render, no probing. The
// page-registered tools close over **this plugin's ctx** and read
// ctx.sessions / ctx.sessionProjections / ctx.sessionController at execution
// time (see the tool packages' implementations) — the property guard
// attributes accesses to the accessed context's owner, so a missing
// declaration fails the tool call with "cannot get property ... without
// inject"; those three must be declared here, matching the tool packages' own
// inject lists.
export const inject = [
  'apps',
  'pageRegistry',
  'workspaceRegistry',
  'taskCenter',
  'agentPresets',
  'llm',
  'sessions',
  'sessionProjections',
  'sessionController',
]
export const provide = []

/**
 * 单一 effect 的接线体（G13 规则 3）：定义 → 页面，体内任何一步失败都把已完成的
 * 步骤逆序回滚——绝不留下"应用在、页面缺"的半接线状态。本接线不持有独立资源：
 * 清理全部由注册表侧的 disposer 承担，effect 返回空清理器。
 * The wiring body inside the one effect (G13 rule 3): definition → pages; any
 * failing step rolls the finished ones back in reverse, never leaving a
 * half-wired state. This wiring owns no standalone resource: cleanup lives in
 * the registry disposers, so the effect returns a no-op disposer.
 */
function wirePersonAgent(ctx: Context): () => void {
  const done: Array<() => void> = []
  try {
    // 1) 应用定义：绑定本 fiber，fiber 销毁 → 整应用摘除。
    //    Bind the definition to this fiber: disposing it removes the whole app.
    done.push(ctx.apps.register(APP_DEFINITION, ctx))
    // 2) 页面注册（一次性渲染形态）：工厂以本插件 ctx 为纯参数产出 PageFC + meta，
    //    单入口内部自动镜像进 page-registry（可被 openUrl 解析）。组件体在页面会话的
    //    真实 Agent 上执行恰好一次——工具由体直接登记（随 agent fiber 生灭），异步
    //    数据在 load 里取齐；此后不再渲染。
    //    Page registration (one-shot form): the factory takes this plugin's ctx as
    //    the pure parameter and yields PageFCs + metas, single entry mirrored into
    //    the page registry (openUrl-resolvable). Each body runs exactly once on
    //    the page session's real Agent - tools register via the body (living and
    //    dying with the agent fiber) and async data settles in load; the page
    //    never renders again.
    bindPersonAgentContext(ctx)
    const pages = ctx.apps.pages(APP_ID, ctx)
    done.push(pages.register(OverviewPage, OverviewMeta))
    done.push(pages.register(WorkspacesPage, WorkspacesMeta))
  } catch (error: unknown) {
    for (const dispose of done.reverse()) dispose()
    throw error
  }
  return () => undefined
}

export const apply = (ctx: Context): void => {
  // 单一 effect 收线（G13 规则 3）：定义 → 页面。
  // One effect owns the wiring (G13 rule 3): definition → pages.
  ctx.effect(() => wirePersonAgent(ctx), 'person-agent-app:wire')
}
