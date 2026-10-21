/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的两个页面：个人工作台概览（一级页 / entry）/ 工作区浏览（defineAppPage，
 * URL 统一 /apps/person-agent/...）。tree 是同步纯函数，读 OverviewSource 的
 * 最新缓存；load 刷新后取首屏快照进 PAGE 块——数据拿不到就显示「不可用」，
 * 不假装。
 * The app's two pages: the personal workbench overview (the home page) and the
 * workspace browser (defineAppPage, urls under /apps/person-agent). The tree
 * is a sync pure function over the OverviewSource's latest cache; load
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
 * 入口页：个人工作台概览 / the entry page: the personal workbench overview.
 * 基础信息（load 刷新后取真实快照）+ 能力地图（工作区浏览页）；三区数据全部
 * 来自真实服务面。
 * Basic information (a real snapshot via load) plus the capability map (the
 * workspace browser); all three sections come from real service faces.
 */
export function createOverviewPage(source: OverviewSource): PageDefinition<OverviewSnapshot> {
  return defineAppPage<OverviewSnapshot>({
    name: 'overview',
    url: `${URL_PREFIX}/overview`,
    description: '个人工作台概览：一屏看清当前部署、应用目录、工作区/会话与待办任务',
    tools: [],
    instructions: '这是 Person Agent 的首页（个人工作台概览）。data 行是首屏快照，三区数据均为部署真实状态：'
      + 'apps 区来自应用目录（ctx.apps.catalog），workspaces 区来自工作区注册表，'
      + 'tasks 区来自任务中心的 open 任务计数。available=false 或 openCount=null '
      + '表示该数据源缺席或读取失败——如实告知用户，不要编造数字。'
      + '要看各工作区的会话账目明细时，打开 map 里的工作区浏览页。',
    instanceTitle: () => '个人工作台',
    // §3.10.1：一级页 = 基础信息（load 刷新真实服务面）+ 能力地图
    // / §3.10.1: the home page = basic information (load refreshes the real service faces) + the capability map
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
 * 工作区浏览页（无参数工具页）/ the workspace browser page (a parameterless tool page).
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
