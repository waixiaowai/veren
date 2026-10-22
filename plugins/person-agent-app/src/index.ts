/**
 * @veren/person-agent-app 插件入口：把 Person Agent 注册成一个应用
 * （定义 → 工具 → 页面）。本插件独立于预设插件：即使本行激活失败，
 * person-agent-preset 的人机桥预设也不受影响——这是「只追加、不动运行行为」
 * 硬约束的结构保证。
 * Plugin entry: registers Person Agent as an application (definition → tools →
 * pages). This plugin is deliberately separate from the preset plugin: even if
 * this row fails to activate, the person-agent-preset bridge is untouched —
 * the structural guarantee behind the "append-only, no behavior change" rule.
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
import { APP_DEFINITION, APP_ID, collectAppTools } from './app.ts'
import { OverviewMeta, OverviewPage, WorkspacesMeta, WorkspacesPage } from './pages.tsx'

export const name = 'personAgentApp'

export interface Config {
  /** 单次会话列表返回上限（收编工具沿用原语义）。Per-call session-list cap (collected tool keeps its semantics). */
  maxListSessions: number
}

export const Config: z<Config> = z.object({
  maxListSessions: z.number().step(1).min(1).default(200).description('Maximum sessions returned by one collected workspace_session_list call.'),
})

// 服务依赖全部显式声明（G13）：本插件就是应用；workspaceRegistry /
// taskCenter 由页面组件在渲染体内经组件 ctx 读取——在此声明保证组件渲染时
// 它们必然在场，不做运行期探测。
// All service dependencies are declared explicitly (G13): this plugin IS an
// app; workspaceRegistry / taskCenter are read by the page components in their
// bodies via the component ctx — declaring them here guarantees they are
// present when the components render, no probing.
export const inject = ['apps', 'pageRegistry', 'workspaceRegistry', 'taskCenter']
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
      // 2) 工具目录先于页面：收编既有工具（同一份实现），页面 tools 引用本地名。
      //    Tools before pages: collect existing tools (same implementations).
      const tools = apps.tools(APP_ID, ctx)
      for (const tool of collectAppTools(ctx, config.maxListSessions)) {
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
