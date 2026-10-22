/**
 * @veren/person-agent-app 插件入口：把 Person Agent 注册成一个应用
 * （定义 → 工具 → 页面）。应用即整栈：桥梁人设在应用说明里，工具与 renhua
 * 技能挂进页面会话的 agent 作用域——没有预设行，也没有全局注册的工具。
 * Plugin entry: registers Person Agent as an application (definition → tools →
 * pages). The app IS the whole stack: the bridge persona lives in the app
 * instructions, and the tools plus the renhua skill mount into each page
 * session's agent scope — no preset row, no globally registered tools.
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
import { APP_DEFINITION, APP_ID, WATCH_DEFAULTS, collectAppTools } from './app.ts'
import { OverviewMeta, OverviewPage, WorkspacesMeta, WorkspacesPage } from './pages.tsx'
import { createSettlementWatch } from '@veren/person-agent-tool-session'

export const name = 'personAgentApp'

export interface Config {
  /** 单次会话列表返回上限（收编工具沿用原语义）。Per-call session-list cap (collected tool keeps its semantics). */
  maxListSessions: number
  /** 是否允许 workspace_create 递归创建缺失目录。Whether workspace_create may create missing directories recursively. */
  allowCreateDirectory: boolean
}

export const Config: z<Config> = z.object({
  maxListSessions: z.number().step(1).min(1).default(200).description('Maximum sessions returned by one collected workspace_session_list call.'),
  allowCreateDirectory: z.boolean().default(false).description('Allow the workspace_create tool to create missing directories.'),
})

// 服务依赖全部显式声明（G13）：本插件就是应用；workspaceRegistry /
// taskCenter / agentPresets / llm 由页面组件在渲染体内经组件 ctx 读取——在此
// 声明保证组件渲染时它们必然在场，不做运行期探测。
// 目录工具与页面动态注册的会话工具都闭包捕获**本插件的 ctx**，并在执行时直接读取
// `ctx.sessions` / `ctx.sessionProjections` / `ctx.sessionController`（见
// @veren/person-agent-tool-workspace 与 -tool-session 的实现）——属性守卫按属主
// 归因，缺少声明会在工具执行时报 "cannot get property ... without inject"，因此
// 这三个服务必须在这里声明（与工具包自身的 inject 清单保持一致）。
// All service dependencies are declared explicitly (G13): this plugin IS an
// app; workspaceRegistry / taskCenter / agentPresets / llm are read by the page
// components in their bodies via the component ctx — declaring them here
// guarantees they are present when the components render, no probing. The
// catalog tools and the page-registered session tools both close over **this
// plugin's ctx** and read ctx.sessions / ctx.sessionProjections /
// ctx.sessionController at execution time (see the tool packages'
// implementations) — the property guard attributes accesses to the accessed
// context's owner, so a missing declaration fails the tool call with "cannot
// get property ... without inject"; those three must be declared here,
// matching the tool packages' own inject lists.
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

export const apply = (ctx: Context, config: Config): void => {
  const apps = ctx.apps

  // 单一 effect 收线（G13 规则 3）：定义 → 工具 → 页面，体内任何一步失败都把
  // 已完成的步骤逆序回滚——绝不留下"应用在、工具缺页"的半接线状态。
  // One effect owns the wiring (G13 rule 3): definition → tools → pages; any
  // failing step rolls the finished ones back in reverse, never leaving a
  // half-wired state.
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      // 1) 应用定义：绑定本 fiber，fiber 销毁 → 整应用（页面+工具）摘除。
      //    Bind the definition to this fiber: disposing it removes the whole app.
      done.push(apps.register(APP_DEFINITION, ctx))
      // 2) 工具目录先于页面：收编既有工具（同一份实现）。目录 dispatch 项引用
      //    的结算看守由本入口持有：取消器先注册（卸载时最后执行），工具后注册
      //    （卸载时先摘）——与旧插件装配同一顺序，观察者醒来即返回，不会去碰
      //    已失效的 Context。
      //    Tools before pages: collect existing tools (same implementations).
      //    The watch behind the catalog's dispatch entry is owned by this entry:
      //    the canceller registers first (runs last on unload) and the tools
      //    register after (removed first on unload) — the old plugin assembly's
      //    order, so an observer parked on whenIdle() wakes into `settled` and
      //    never touches the inactive Context.
      const watch = createSettlementWatch(ctx, WATCH_DEFAULTS)
      done.push(() => { watch.dispose() })
      const tools = apps.tools(APP_ID, ctx)
      for (const tool of collectAppTools(ctx, {
        watch,
        allowCreateDirectory: config.allowCreateDirectory,
        maxListSessions: config.maxListSessions,
      })) {
        done.push(tools.define(tool))
      }
      // 3) 页面注册（自承载组件，RFC prompt-page-render §3.5）：模块级 PageFC +
      //    meta 直接注册，单入口内部自动镜像进 page-registry（可被 openUrl 解析）。
      //    组件在渲染体内经组件 ctx 取服务面自加载数据，变化经 PAGE-PATCH 进上下文。
      //    Page registration (self-contained components, RFC §3.5): module-level
      //    PageFCs and metas registered directly, single entry mirrored into the
      //    page registry (openUrl-resolvable). Components load their own data via
      //    the component ctx in their bodies; changes flow as PAGE-PATCH blocks.
      const pages = apps.pages(APP_ID, ctx)
      done.push(pages.register(OverviewPage, OverviewMeta))
      done.push(pages.register(WorkspacesPage, WorkspacesMeta))
    } catch (error: unknown) {
      for (const dispose of done.reverse()) dispose()
      throw error
    }
    // 本接线不持有独立资源：清理全部由注册表侧的 disposer 承担，effect 返回空清理器。
    // This wiring owns no standalone resource: cleanup lives in the registry
    // disposers, so the effect returns a no-op disposer.
    return () => undefined
  }, 'person-agent-app:wire')
}
