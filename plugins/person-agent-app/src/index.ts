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
import { createOverviewPage, createWorkspacesPage } from './pages.tsx'
import { PersonAgentOverviewService } from './views.ts'

export const name = 'personAgentApp'

export interface Config {
  /** 单次会话列表返回上限（收编工具沿用原语义）。Per-call session-list cap (collected tool keeps its semantics). */
  maxListSessions: number
}

export const Config: z<Config> = z.object({
  maxListSessions: z.number().step(1).min(1).default(200).description('Maximum sessions returned by one collected workspace_session_list call.'),
})

// 四个服务依赖全部显式声明（G13）：本插件就是应用；workspaceRegistry /
// taskCenter 同时也是概览服务（views.ts）经 static inject 声明的自身依赖——
// 在此声明保证服务构造时它们必然在场，不做运行期探测。
// All four service dependencies are declared explicitly (G13): this plugin IS
// an app; workspaceRegistry / taskCenter are also declared by the overview
// service (views.ts) as its own static injects — declaring them here
// guarantees they are present when the service is constructed, no probing.
export const inject = ['apps', 'pageRegistry', 'workspaceRegistry', 'taskCenter']
export const provide = []

export const apply = (ctx: Context, config: Config): void => {
  const apps = ctx.apps
  // 概览数据面挂载为 ctx.personAgentOverview 服务：它经 static inject 声明读取
  // apps / workspaceRegistry / taskCenter 三个服务面（G13），而这三者正是本插件
  // 已声明的 inject，构造时必然在场；注册随本 fiber 卸载自动摘除，不泄漏。
  // The overview data plane mounts as the ctx.personAgentOverview service: it
  // declares the apps / workspaceRegistry / taskCenter faces via its own static
  // inject (G13) — the very faces this plugin already declares, so they are
  // guaranteed present at construction; registration is removed with this fiber.
  const overview = new PersonAgentOverviewService(ctx)

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
      // 3) 页面注册：单入口，内部自动镜像进 page-registry（可被 openUrl 解析）。
      //    Page registration: single entry, mirrored automatically.
      const pages = apps.pages(APP_ID, ctx)
      for (const page of [createOverviewPage(overview), createWorkspacesPage(overview)]) {
        // 接缝断言：注册面是 PageDefinition<never>（registry 的不变式视角），
        // 与 task-workbench 样板同型——仅此一处收窄，不改页面字段。
        // Seam: the registrar takes PageDefinition<never> (the registry's
        // invariant view); the one narrowing, no page fields touched.
        done.push(pages.register(page as never))
      }
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
