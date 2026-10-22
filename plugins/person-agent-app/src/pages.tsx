/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的两个页面（自承载组件，RFC prompt-page-render §3.5）：模块级 PageFC +
 * 模块级 meta，经 `pages.register(component, meta)` 直接注册——没有工厂、没有
 * 闭包注入、没有快照契约。同步服务面在正文里直接读（每帧最新，零状态零
 * effect）；异步服务面走 `ctx.effect` 拉取、`useState` 落地，重渲 diff 出
 * PAGE-PATCH。外部权威 store 的页面才走 `meta.store` + `useSnapshot`
 * （如 task-workbench）。
 * The app's two pages as self-contained components (RFC prompt-page-render
 * §3.5): module-level PageFCs and metas registered directly via
 * `pages.register(component, meta)` — no factory, no closure injection, no
 * snapshot contract. Synchronous service faces are read straight in the body
 * (fresh every frame, zero state, zero effect); the asynchronous face is
 * fetched in `ctx.effect` and lands in `useState`, re-rendering into a
 * PAGE-PATCH. Pages backed by an external authoritative store use
 * `meta.store` + `useSnapshot` instead (task-workbench).
 *
 * §3.10.1 三档标注：本应用是**纯只读应用**（所有页面都不声明 writes，下钻靠工具）
 * ——合法形态：规则 1 构造上成立（map 由注册表推导，列全兄弟页）、规则 3 无从
 * 触发、§3.9 完备性警告天然沉默。
 * §3.10.1 archetype annotations: this app is a **pure read-only app** (no page
 * declares writes; drill-down happens through tools) — a legal shape: rule 1
 * holds by construction (the map is registry-derived, listing all sibling
 * pages), rule 3 cannot trigger, and the §3.9 coverage warning stays silent.
 * @module @veren/person-agent-app
 */
import { useState } from '@veren/prompt-core'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
// 类型-only import：拉取 apps / workspaceRegistry / taskCenter 的 Context 声明合并，
// 正文里的 `ctx.apps` / `ctx.workspaceRegistry` / `ctx.taskCenter` 由此获得类型。
// Type-only imports: pull the apps / workspaceRegistry / taskCenter merging so
// `ctx.apps` / `ctx.workspaceRegistry` / `ctx.taskCenter` are typed in the body.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@veren/app-registry'
import type {} from '@veren/task-center'

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = '/apps/person-agent'

// ---- 概览页（home 档 / entry）---- Overview page (the home archetype / entry) ----

/**
 * 个人工作台概览：应用目录与工作区是同步内存读——正文直接调，首帧即真实数据；
 * 任务中心是异步读——`ctx.effect` 拉取，读取失败如实渲染原因，绝不编造数字。
 * The personal workbench overview: catalog and workspaces are sync in-memory
 * reads called straight in the body — the first frame already carries real
 * data; the task center is an async read fetched in `ctx.effect`, with a
 * failed read rendered honestly — never faked.
 */
export const OverviewPage: PageFC = (_props, ctx) => {
  const apps = ctx.apps
  const workspaces = ctx.workspaceRegistry
  // 异步面：null = 读取中 / the async face: null = still reading
  const [openTasks, setOpenTasks] = useState<Awaited<ReturnType<Context['taskCenter']['list']>> | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  ctx.effect(() => {
    void ctx.taskCenter.list({ status: 'open' }).then(setOpenTasks, (error: unknown) => {
      setTaskError(error instanceof Error ? error.message : String(error))
    })
  })
  const catalog = apps.catalog()
  const rows = workspaces.list()
  return (
    <>
      <h1>Person Agent · 个人工作台（人机桥概览）</h1>
      <p>应用目录 {catalog.length} 个应用；工作区 {rows.length} 个。</p>
      <h2>应用目录</h2>
      <ul>
        {catalog.map((record) => (
          <li key={record.definition.id}>{record.definition.name}（{record.definition.id} · {record.state}）</li>
        ))}
      </ul>
      <h2>工作区</h2>
      <ul>
        {rows.map((workspace) => (
          <li key={workspace.id}>{workspace.title}（会话账目 {workspace.sessionIds.length}）</li>
        ))}
      </ul>
      <h2>待办任务</h2>
      {taskError !== null
        ? <p>任务中心读取失败：{taskError}——如实告知用户，不要编造数字。</p>
        : <p>{openTasks === null ? '读取中…' : `open 任务 ${openTasks.length} 条（live 自任务中心）`}</p>}
      <blockquote>
        要看某个工作区的会话明细，用本页挂载的 workspace_session_list 工具（workspaceId 取上面工作区条目）现查；
        apps 区与 tasks 区不提供下钻，只报快照；任务区读取失败时正文如实标注原因。
      </blockquote>
    </>
  )
}

export const OverviewMeta: ComponentPageMeta = {
  name: 'overview',
  url: `${URL_PREFIX}/overview`,
  description: '个人工作台概览：一屏看清当前部署、应用目录、工作区/会话与待办任务',
  // 挂本页承诺的现查读工具：说明里点名"看会话明细用它"，它就必须真的在页面上
  // / mount the read tool the page promises: naming it in the instructions requires it to really be mounted
  tools: ['workspace_session_list'],
  instructions: '这是 Person Agent 的首页（个人工作台概览）。正文即真实状态：'
    + 'apps 区来自应用目录（正文直读），workspaces 区来自工作区注册表（正文直读），'
    + 'tasks 区来自任务中心的 open 任务计数（挂载后异步刷新）。'
    + '任务区读取失败时正文会如实标注失败原因——如实告知用户，不要编造数字。'
    + '要看某个工作区的会话明细，用本页挂载的 workspace_session_list 工具（workspaceId 取工作区条目）现查；'
    + 'apps 区与 tasks 区本页不提供下钻，只报快照。',
  instanceTitle: () => '个人工作台',
}

// ---- 工作区浏览页（只读副页）---- Workspace browser page (a read-only secondary page) ----

/**
 * 工作区浏览：注册表是同步内存读——正文直接读，零状态零 effect，只读。
 * The workspace browser: the registry is a sync in-memory read straight in the
 * body — zero state, zero effect, read-only.
 */
export const WorkspacesPage: PageFC = (_props, ctx) => {
  const rows = ctx.workspaceRegistry.list()
  return (
    <>
      <h1>Person Agent · 工作区浏览</h1>
      <p>共 {rows.length} 个工作区（标题/会话账目数），只读。</p>
      <ul>
        {rows.map((workspace) => (
          <li key={workspace.id}>{workspace.title}（会话账目 {workspace.sessionIds.length}）</li>
        ))}
      </ul>
      <blockquote>
        要看某个工作区的会话明细，用 workspace_session_list 传 workspaceId 查询；该数据源不可用时如实说明。
      </blockquote>
    </>
  )
}

export const WorkspacesMeta: ComponentPageMeta = {
  name: 'workspaces',
  url: `${URL_PREFIX}/workspaces`,
  description: '工作区浏览：列出各工作区及其会话账目，只读',
  tools: ['workspace_session_list'],
  instructions: '这是工作区浏览页。正文每行是一个工作区（标题/会话账目数）。'
    + '要看某个工作区的会话明细，用 workspace_session_list 传 workspaceId 查询；该数据源不可用时如实说明。',
  instanceTitle: () => '工作区浏览',
}
