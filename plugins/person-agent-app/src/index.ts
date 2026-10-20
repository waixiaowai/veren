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
import { OverviewSource } from './views.ts'

export const name = 'personAgentApp'

export interface Config {
  /** 单次会话列表返回上限（收编工具沿用原语义）。Per-call session-list cap (collected tool keeps its semantics). */
  maxListSessions: number
}

export const Config: z<Config> = z.object({
  maxListSessions: z.number().step(1).min(1).default(200).description('Maximum sessions returned by one collected workspace_session_list call.'),
})

// apps 必需（本插件就是应用）；pageRegistry 由 app-registry 的镜像面内部使用。
// workspaceRegistry / taskCenter 不硬注入：页面按需读取，缺席时优雅降级。
// apps is required (this plugin IS an app); pageRegistry is used by the
// app-registry mirror internally. workspaceRegistry / taskCenter are NOT hard
// injections: pages read them lazily and degrade gracefully when absent.
export const inject = ['apps', 'pageRegistry']
export const provide = []

export const apply = (ctx: Context, config: Config): void => {
  const apps = ctx.apps
  const source = new OverviewSource(ctx)

  // 1) 应用定义：绑定本 fiber，fiber 销毁 → 整应用（页面+工具）摘除。
  //    Bind the definition to this fiber: disposing it removes the whole app.
  ctx.effect(() => apps.register(APP_DEFINITION, ctx), 'person-agent-app:register')

  // 2) 工具目录先于页面：收编既有工具（同一份实现），页面 tools 引用本地名。
  //    Tools before pages: collect existing tools (same implementations); page
  //    tool lists reference local names.
  const tools = apps.tools(APP_ID, ctx)
  for (const tool of collectAppTools(ctx, config.maxListSessions)) {
    ctx.effect(() => tools.define(tool), `person-agent-app:tool:${tool.name}`)
  }

  // 3) 页面注册：单入口，内部自动镜像进 page-registry（可被 openUrl 解析）。
  //    Page registration: single entry, mirrored into the page registry
  //    automatically (resolvable by openUrl).
  const pages = apps.pages(APP_ID, ctx)
  for (const page of [createOverviewPage(source), createWorkspacesPage(source)]) {
    // 接缝断言：注册面是 PageDefinition<never>（registry 的不变式视角），
    // 与 task-workbench 样板同型——仅此一处收窄，不改页面字段。
    // Seam: the registrar takes PageDefinition<never> (the registry's invariant
    // view); same shape as the task-workbench template — the one narrowing,
    // no page fields touched.
    ctx.effect(() => pages.register(page as never), `person-agent-app:page:${page.name}`)
  }
}
