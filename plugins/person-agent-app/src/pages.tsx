/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的两个页面（一次性渲染形态，模块级组件）——组装门面。实现按职责分域：
 *   - page-shared.ts：URL 前缀、工具全名化、页面消息 source kind 与送达路径；
 *   - page-context.ts：装配期绑定的模块级 ctx 槽位（bind/require）；
 *   - page-tools.ts：两页的惰性工具预挂面；
 *   - overview-sections.ts：概览页异步三节的读取与文本渲染；
 *   - page-overview.tsx / page-workspaces.tsx：页面组件与 meta。
 * 本文件只做 re-export，`./pages.tsx` 的导出面保持不变。
 * The app's two pages in the one-shot form as MODULE-LEVEL components — the
 * assembly facade. Implementations live by duty domain: page-shared.ts (the url
 * prefix, tool full-naming, the page message source kind and delivery path),
 * page-context.ts (the module-level ctx slot bound at assembly time),
 * page-tools.ts (the two pages' lazy prebuilt tool sets), overview-sections.ts
 * (the overview's three async sections) and page-overview.tsx /
 * page-workspaces.tsx (the page components and their metas). This file only
 * re-exports, so the `./pages.tsx` export face is unchanged.
 *
 * 设计律：**工具只在页面存在**。组件体在页面会话的真实 Agent 上执行恰好一次，
 * 工具由体直接 `agent.ctx.tools.register` 登记（全名 `person_agent__<本地名>`，
 * 随 agent fiber 生灭）；session_dispatch 携带结算看守——它经
 * `agent.ctx.effect` 登记，看守随 agent 销毁结清，派给已废弃会话的回报不会悬空。
 * 单会话 skill（renhua）与工具同机制：组件体直接 `agent.ctx.skills.register`，
 * 随 agent fiber 生灭，宿主不经手挂载。
 * §3.9 承诺对齐 = "说明点名 = 这一段登记"。
 * Design law: **a tool exists only inside a page**. The body runs exactly once
 * on the page session's real Agent; tools register via `agent.ctx.tools.register`
 * directly (full names `person_agent__<local>`, living and dying with the agent
 * fiber); session_dispatch carries the settlement watch — registered via
 * `agent.ctx.effect`, the watch settles at agent disposal, so a report addressed
 * to a deprecated session never dangles. The page-scope skill (renhua) is
 * declared in meta.skills and mounted by app-host. §3.9 promise alignment =
 * "named in the instructions = registered in this block".
 * @module @veren/person-agent-app
 */
export { bindPersonAgentContext } from './page-context.ts'
export type { ModelsSection, OverviewFirstScreen, PresetsSection, TasksSection } from './overview-sections.ts'
export { OverviewMeta, OverviewPage } from './page-overview.tsx'
export { WorkspacesMeta, WorkspacesPage } from './page-workspaces.tsx'
