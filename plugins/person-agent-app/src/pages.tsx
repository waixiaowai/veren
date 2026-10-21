/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的两个页面（组件形态，RFC prompt-page-render §3.5）：PageFC + meta，
 * 经 `pages.register(component, meta)` 注册——正文渲染为 Markdown（WYSIWYG），
 * 数据面订阅概览服务（useSnapshot），变化经 PAGE-PATCH 增量进历史。
 * The app's two pages in component form (RFC prompt-page-render §3.5): PageFC +
 * meta, registered via `pages.register(component, meta)` — the body renders as
 * Markdown (WYSIWYG), the data plane subscribes to the overview service
 * (useSnapshot), and changes flow into history as PAGE-PATCHes.
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
import { useSnapshot } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { OverviewSnapshot, PersonAgentOverviewService } from './views.ts'

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = '/apps/person-agent'

/** 概览页首屏快照（load 面，供无 store 的消费方复用）/ the overview page's first-screen snapshot (the load face, reusable by store-less consumers) */
export type OverviewFirstScreen = {
  catalog: { available: boolean; apps: { id: string; name: string; state: string; toolPrefix: string }[] }
  workspaces: { available: boolean; rows: { id: string; title: string; sessions: number }[] }
  tasks: { available: boolean; openCount: number | null; detail: string }
}

/** 概览快照 → 首屏 JSON（字面量行投影，保持可序列化）/ the overview snapshot as first-screen JSON (literal rows, serializable) */
export function overviewFirstScreen(snapshot: OverviewSnapshot): OverviewFirstScreen {
  return {
    catalog: { available: snapshot.catalog.available, apps: snapshot.catalog.rows.map((row) => ({ ...row })) },
    workspaces: { available: snapshot.workspaces.available, rows: snapshot.workspaces.rows.map((row) => ({ ...row })) },
    tasks: { available: snapshot.tasks.available, openCount: snapshot.tasks.openCount, detail: snapshot.tasks.detail },
  }
}

/** 两个页面的组件与契约面（闭包引用本次装配的概览服务——单一事实源）
 * / the two pages' components and contract faces (closures over this assembly's
 * overview service — a single source of fact) */
export interface PersonAgentPages {
  readonly OverviewPage: PageFC
  readonly OverviewMeta: ComponentPageMeta
  readonly WorkspacesPage: PageFC
  readonly WorkspacesMeta: ComponentPageMeta
}

/** 页面工厂：概览服务以纯参数进入（G13 规则 2），组件经 useSnapshot 读它
 * / the page factory: the overview service arrives as a pure parameter (G13 rule
 * 2); components read it via useSnapshot */
export function createPersonAgentPages(overview: PersonAgentOverviewService): PersonAgentPages {
  // ---- 概览页（home 档 / entry）---- Overview page (the home archetype / entry) ----

  const OverviewPage: PageFC = (_props, ctx) => {
    // 挂载即刷新概览（ctx.effect 一次运行）；首帧读到的是空快照，如实渲染并在
    // 刷新完成后经 PAGE-PATCH 更新。
    // / refresh the overview on mount (ctx.effect runs once); the first frame
    // reads the empty snapshot, renders it honestly, and PAGE-PATCH carries the
    // update once refreshed.
    ctx.effect(() => { void overview.refresh() })
    const snapshot = useSnapshot<OverviewSnapshot>()
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

  const OverviewMeta: ComponentPageMeta = {
    name: 'overview',
    url: `${URL_PREFIX}/overview`,
    description: '个人工作台概览：一屏看清当前部署、应用目录、工作区/会话与待办任务',
    // 挂本页承诺的现查读工具：说明里点名"看会话明细用它"，它就必须真的在页面上
    // / mount the read tool the page promises: naming it in the instructions requires it to really be mounted
    tools: ['workspace_session_list'],
    store: overview,
    instructions: '这是 Person Agent 的首页（个人工作台概览）。正文即首屏快照，三区数据均为部署真实状态：'
      + 'apps 区来自应用目录，workspaces 区来自工作区注册表，tasks 区来自任务中心的 open 任务计数。'
      + 'available=false 或 openCount=null 表示该数据源读取失败——如实告知用户，不要编造数字。'
      + '要看某个工作区的会话明细，用本页挂载的 workspace_session_list 工具（workspaceId 取工作区条目）现查；'
      + 'apps 区与 tasks 区本页不提供下钻，只报快照。',
    instanceTitle: () => '个人工作台',
  }

  // ---- 工作区浏览页（只读副页）---- Workspace browser page (a read-only secondary page) ----

  const WorkspacesPage: PageFC = (_props, ctx) => {
    ctx.effect(() => { void overview.refresh() })
    const snapshot = useSnapshot<OverviewSnapshot>()
    const rows = snapshot?.workspaces.rows ?? []
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

  const WorkspacesMeta: ComponentPageMeta = {
    name: 'workspaces',
    url: `${URL_PREFIX}/workspaces`,
    description: '工作区浏览：列出各工作区及其会话账目，只读',
    tools: ['workspace_session_list'],
    store: overview,
    instructions: '这是工作区浏览页。正文每行是一个工作区（标题/会话账目数）。'
      + '要看某个工作区的会话明细，用 workspace_session_list 传 workspaceId 查询；该数据源不可用时如实说明。',
    instanceTitle: () => '工作区浏览',
  }

  return { OverviewPage, OverviewMeta, WorkspacesPage, WorkspacesMeta }
}
