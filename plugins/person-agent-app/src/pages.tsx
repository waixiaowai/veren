/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的两个页面（defineAppPage，URL 统一 /apps/person-agent/...）。
 * The app's two pages (defineAppPage, urls under /apps/person-agent).
 *
 * §3.10.1 三档标注：本应用是**纯只读应用**（所有页面都不声明 writes，下钻靠工具）
 * ——合法形态：规则 1 自动豁免（没有详情页 → map 可空）、规则 3 无从触发、
 * §3.9 完备性警告天然沉默。
 * §3.10.1 archetype annotations: this app is a **pure read-only app** (no page
 * declares writes; drill-down happens through tools) — a legal shape: rule 1
 * exempts it (no detail pages → the map may be empty), rule 3 cannot trigger,
 * and the §3.9 coverage warning stays silent by construction.
 * - `overview` = **首页（home）**：entry，基础信息 + map（这里列了只读副页——
 *   map 可空但列了真实可去的副页也合法）；挂只读工具 workspace_session_list
 *   承接"工作区会话明细"的现查承诺（三区快照本身来自 load，不需要工具）；
 *   / the home page: the entry; base info + a map (optional here — listing the
 *   real reachable secondary page is equally legal); it mounts the read-only
 *   workspace_session_list tool to carry the "session detail on demand"
 *   promise (the three section snapshots themselves come from load, no tool
 *   needed);
 * - `workspaces` = **只读副页**（无参、非入口、只读的剩余形态）：仪表盘应用的
 *   第二屏，除 definePage 基础校验外无额外要求。
 *   / a read-only secondary page (parameterless, non-entry, read-only — the
 *   leftover shape): a dashboard app's second screen, nothing beyond the
 *   definePage basics.
 *
 * tree 是同步纯函数，读 OverviewSource 的最新缓存；load 刷新后取首屏快照进
 * PAGE 块——数据拿不到就显示「不可用」，不假装。
 * The tree is a sync pure function over the OverviewSource's latest cache; load
 * refreshes and hands the first-screen snapshot to the PAGE block —
 * unavailable data says so, never faked.
 * @module @veren/person-agent-app
 */
import { Data, Keyed, Static, defineAppPage } from '@veren/prompt-page'
import type { PageJsonValue, PageDefinition } from '@veren/prompt-page'
import type { OverviewSnapshot, OverviewSource } from './views.ts'

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = '/apps/person-agent'

/** 概览页首屏快照 / the overview page's first-screen snapshot */
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

/**
 * 首页（home 档 / entry）：个人工作台概览 / the home page (the home archetype / entry).
 * 基础信息（load 刷新后取真实快照）+ 能力地图（工作区浏览页）。承诺与事实一一对齐
 * ——不许"承诺了但没有"（真机教训：本页曾一个工具都不挂）：三区快照全部来自 load
 * 进 data 行，快照本身不需要工具；"某工作区有哪些会话"是现查事实，由本页挂载的
 * 只读工具 workspace_session_list 承接；apps/tasks 两区明确不承诺下钻。
 * Basic information (a real snapshot via load) plus the capability map (the
 * workspace browser). Every promise is matched to a fact — never "promised but
 * absent" (the live-host lesson: this page once mounted no tool at all): the
 * three section snapshots arrive via load, so the snapshots need no tool; a
 * workspace's per-session detail is an on-demand fact carried by this page's
 * mounted read-only tool workspace_session_list; the apps/tasks sections
 * promise no drilldown.
 */
export function createOverviewPage(source: OverviewSource): PageDefinition<OverviewSnapshot> {
  return defineAppPage<OverviewSnapshot>({
    name: 'overview',
    url: `${URL_PREFIX}/overview`,
    description: '个人工作台概览：一屏看清当前部署、应用目录、工作区/会话与待办任务',
    // 挂本页承诺的现查读工具：说明里点名"看会话明细用它"，它就必须真的在页面上
    // / mount the read tool the page promises: naming it in the instructions
    // requires it to really be mounted on this page
    tools: ['workspace_session_list'],
    instructions: '这是 Person Agent 的首页（个人工作台概览）。data 行是首屏快照，三区数据均为部署真实状态：'
      + 'apps 区来自应用目录，workspaces 区来自工作区注册表，tasks 区来自任务中心的 open 任务计数。'
      + 'available=false 或 openCount=null 表示该数据源读取失败——如实告知用户，不要编造数字。'
      + 'workspaces.rows 的 sessions 只是账目计数；要看某个工作区的会话明细，'
      + '用本页挂载的 workspace_session_list 工具（workspaceId 取 rows[].id）现查；'
      + 'apps 区与 tasks 区本页不提供下钻，只报快照。',
    instanceTitle: () => '个人工作台',
    // §3.10.1：首页 = 基础信息（load 刷新真实服务面）+ 能力地图（无详情页 → map 可选）
    // / §3.10.1: the home page = basic information (load refreshes the real
    // service faces) + the capability map (no detail pages → the map is optional)
    load: async () => {
      await source.refresh()
      return overviewFirstScreen(source.current()) satisfies PageJsonValue
    },
    map: [
      { url: `${URL_PREFIX}/workspaces`, use: '要看各工作区的会话账目明细时打开' },
    ],
    onLoad: () => { void source.refresh() },
    tree: (_params, snapshot) => {
      const tasks = snapshot.tasks
      return (
        <>
          <Static content="Person Agent · 个人工作台（人机桥概览）" />
          <Data path="catalog.available" value={snapshot.catalog.available} />
          <Keyed path="catalog.apps" items={snapshot.catalog.rows} />
          <Data path="workspaces.available" value={snapshot.workspaces.available} />
          <Keyed path="workspaces.rows" items={snapshot.workspaces.rows} />
          <Data path="tasks.available" value={tasks.available} />
          <Data path="tasks.openCount" value={tasks.openCount} />
          <Data path="tasks.detail" value={tasks.detail} />
        </>
      )
    },
  })
}

/**
 * 工作区浏览页（只读副页：无参、非入口、只读）/ the workspace browser page (a
 * read-only secondary page: parameterless, non-entry, read-only).
 * 每个工作区一行（id/标题/会话账目数），只读；会话明细用收编的
 * workspace_session_list 工具按需查询。
 * One row per workspace (id/title/session ledger count), read-only; per-session
 * detail goes through the collected workspace_session_list tool on demand.
 */
export function createWorkspacesPage(source: OverviewSource): PageDefinition<OverviewSnapshot> {
  return defineAppPage<OverviewSnapshot>({
    name: 'workspaces',
    url: `${URL_PREFIX}/workspaces`,
    description: '工作区浏览：列出各工作区及其会话账目，只读',
    tools: ['workspace_session_list'],
    instructions: '这是工作区浏览页。data 行与 workspaces.rows 每行是一个工作区（id/title/sessions），'
      + 'sessions 是该工作区账目下的会话数。要看某个工作区的会话明细，用 '
      + 'workspace_session_list 传 workspaceId 查询；该数据源不可用时如实说明。',
    instanceTitle: () => '工作区浏览',
    load: async () => {
      await source.refresh()
      const workspaces = source.current().workspaces
      return { available: workspaces.available, rows: workspaces.rows.map((row) => ({ ...row })) } satisfies PageJsonValue
    },
    onLoad: () => { void source.refresh() },
    tree: (_params, snapshot) => (
      <>
        <Static content="Person Agent · 工作区浏览" />
        <Data path="workspaces.available" value={snapshot.workspaces.available} />
        <Keyed path="workspaces.rows" items={snapshot.workspaces.rows} />
      </>
    ),
  })
}
