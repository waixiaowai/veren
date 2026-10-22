/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的两个页面（自承载组件，RFC prompt-page-render §3.5）：模块级 PageFC +
 * 模块级 meta，经 `pages.register(component, meta)` 直接注册——没有工厂、没有
 * 闭包注入、没有中介读取器。数据加载写在组件体内：`ctx.effect` 里**直接从
 * 组件 ctx** 就地读取服务面（`ctx.workspaceRegistry` / `ctx.taskCenter` …），
 * 结果落 `useState`，触发重渲、diff 出 PAGE-PATCH。外部权威 store 的页面才走
 * `meta.store` + `useSnapshot`（如 task-workbench）；本应用页面数据自承载。
 * The app's two pages as self-contained components (RFC prompt-page-render
 * §3.5): module-level PageFCs and metas registered directly via
 * `pages.register(component, meta)` — no factory, no closure injection, no
 * broker reader. Data loading lives in the component body: `ctx.effect` reads
 * the service faces **straight off the component ctx**
 * (`ctx.workspaceRegistry` / `ctx.taskCenter` …) and the result lands in
 * `useState`, triggering a re-render that diffs into a PAGE-PATCH. Pages backed
 * by an external authoritative store use `meta.store` + `useSnapshot` instead
 * (task-workbench); this app's pages are self-contained.
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
import type { ComponentPageMeta, PageComponentContext, PageFC } from '@veren/prompt-page'
// 类型-only import：拉取 workspaceRegistry / taskCenter 的 Context 声明合并，
// 组件体内的 `ctx.workspaceRegistry` / `ctx.taskCenter` 由此获得类型。
// Type-only imports: pull the workspaceRegistry / taskCenter merging so
// `ctx.workspaceRegistry` / `ctx.taskCenter` are typed in the component bodies.
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@veren/task-center'
import { emptySnapshot } from './views.ts'
import type { AppCatalogRow, OverviewSnapshot, Section, TasksSection, WorkspaceRow } from './views.ts'

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = '/apps/person-agent'

/**
 * 就地从组件 ctx 读出概览快照：三个服务面直接取用，不做任何形状包装；任务区
 * 读取失败显式降级为不可用——绝不假装有数据。
 * Read the overview snapshot straight off the component ctx: the three service
 * faces are used in place with zero shape-wrapping; a failed task-center read
 * degrades explicitly to unavailable — never faked.
 */
async function readOverview(ctx: PageComponentContext): Promise<OverviewSnapshot> {
  const catalog: Section<AppCatalogRow> = {
    available: true,
    rows: ctx.apps.catalog().map((record) => ({
      id: record.definition.id,
      name: record.definition.name,
      state: record.state,
      toolPrefix: record.toolPrefix,
    })),
  }
  const workspaces: Section<WorkspaceRow> = {
    available: true,
    rows: ctx.workspaceRegistry.list().map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      sessions: workspace.sessionIds.length,
    })),
  }
  const tasks: TasksSection = await ctx.taskCenter.list({ status: 'open' }).then(
    (open) => ({ available: true, openCount: open.length, detail: 'live from the task center' }),
    (error: unknown) => ({
      available: false,
      openCount: null,
      detail: `task center read failed: ${error instanceof Error ? error.message : String(error)}`,
    }),
  )
  return { catalog, workspaces, tasks }
}

// ---- 概览页（home 档 / entry）---- Overview page (the home archetype / entry) ----

/**
 * 个人工作台概览：挂载即自加载三区真实数据。首帧是空快照（如实渲染），读取
 * 完成后落 useState 触发重渲，变化经 PAGE-PATCH 进历史。
 * The personal workbench overview: self-loads all three sections on mount. The
 * first frame is the empty snapshot (rendered honestly); once the read lands
 * in useState a re-render fires and the change flows into history as a
 * PAGE-PATCH.
 */
export const OverviewPage: PageFC = (_props, ctx) => {
  const [snapshot, setSnapshot] = useState<OverviewSnapshot>(emptySnapshot)
  ctx.effect(() => { void readOverview(ctx).then(setSnapshot) })
  const catalogApps = snapshot?.catalog.rows ?? []
  const workspaceRows = snapshot?.workspaces.rows ?? []
  const tasks = snapshot?.tasks
  return (
    <>
      <h1>Person Agent · 个人工作台（人机桥概览）</h1>
      <p>应用目录 {catalogApps.length} 个应用；工作区 {workspaceRows.length} 个。</p>
      <h2>应用目录</h2>
      <ul>
        {catalogApps.map((app) => (
          <li key={app.id}>{app.name}（{app.id} · {app.state}）</li>
        ))}
      </ul>
      <h2>工作区</h2>
      <ul>
        {workspaceRows.map((row) => (
          <li key={row.id}>{row.title}（会话账目 {row.sessions}）</li>
        ))}
      </ul>
      <h2>待办任务</h2>
      <p>{tasks?.detail ?? ''}</p>
      <blockquote>
        available=false 或 openCount=null 表示该数据源读取失败——如实告知用户，不要编造数字。
        要看某个工作区的会话明细，用本页挂载的 workspace_session_list 工具（workspaceId 取上面工作区条目）现查；
        apps 区与 tasks 区不提供下钻，只报快照。
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
  instructions: '这是 Person Agent 的首页（个人工作台概览）。正文即首屏快照，三区数据均为部署真实状态：'
    + 'apps 区来自应用目录，workspaces 区来自工作区注册表，tasks 区来自任务中心的 open 任务计数。'
    + 'available=false 或 openCount=null 表示该数据源读取失败——如实告知用户，不要编造数字。'
    + '要看某个工作区的会话明细，用本页挂载的 workspace_session_list 工具（workspaceId 取工作区条目）现查；'
    + 'apps 区与 tasks 区本页不提供下钻，只报快照。',
  instanceTitle: () => '个人工作台',
}

// ---- 工作区浏览页（只读副页）---- Workspace browser page (a read-only secondary page) ----

/**
 * 工作区浏览：挂载即就地读工作区行，只读。setSnapshot 包在 microtask 里落点——
 * effect 内同步 setState 会重入渲染帧、打乱 hook 顺序。
 * The workspace browser: reads the workspace rows in place on mount, read-only.
 * The setState lands inside a microtask — a synchronous setState inside an
 * effect would re-enter the render frame and corrupt hook order.
 */
export const WorkspacesPage: PageFC = (_props, ctx) => {
  const [rows, setRows] = useState<readonly WorkspaceRow[]>([])
  ctx.effect(() => {
    void Promise.resolve().then(() => {
      setRows(ctx.workspaceRegistry.list().map((workspace) => ({
        id: workspace.id,
        title: workspace.title,
        sessions: workspace.sessionIds.length,
      })))
    })
  })
  return (
    <>
      <h1>Person Agent · 工作区浏览</h1>
      <p>共 {rows.length} 个工作区（标题/会话账目数），只读。</p>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>{row.title}（会话账目 {row.sessions}）</li>
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
