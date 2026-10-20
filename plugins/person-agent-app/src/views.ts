/**
 * 数据面：概览快照的构建与缓存。全部读真实服务面，任何缺席服务都显式降级。
 * The data plane: overview snapshot building and caching. Every read hits a
 * real service face; any absent service degrades explicitly.
 *
 * - `ctx.apps.catalog()` / `ctx.workspaceRegistry.list()` 是同步内存读；
 * - `ctx.taskCenter.list()` 是异步读：页面 tree 是同步纯函数，所以任务区走
 *   「刷新 + 缓存」——拿不到就显示不可用，绝不假装有数据。
 * - `ctx.apps.catalog()` / `ctx.workspaceRegistry.list()` are sync in-memory
 *   reads; `ctx.taskCenter.list()` is async, and the page tree is a sync pure
 *   function, so the tasks section is refresh-and-cache — never faked.
 * @module @veren/person-agent-app
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：拉取 apps / taskCenter / workspaceRegistry 的 Context 声明合并。
// Type-only imports: pull the apps / taskCenter / workspaceRegistry merging.
import type {} from '@veren/app-registry'
import type {} from '@veren/task-center'
import type {} from '@deepseek-ai/dsh-workspace'

/** 应用目录行 / one catalog row */
export interface AppCatalogRow {
  readonly id: string
  readonly name: string
  readonly state: string
  readonly toolPrefix: string
}

/** 工作区行（会话数是账目口径）/ one workspace row (session count per the ledger) */
export interface WorkspaceRow {
  readonly id: string
  readonly title: string
  readonly sessions: number
}

/** 通用分区：available=false 时 rows 恒为空 / a section: rows stay empty when unavailable */
export interface Section<T> {
  readonly available: boolean
  readonly rows: readonly T[]
}

/** 待办任务区：openCount 只有在任务中心在场且读取成功时才有值 / the tasks section */
export interface TasksSection {
  readonly available: boolean
  readonly openCount: number | null
  readonly detail: string
}

/** 概览快照 / the overview snapshot */
export interface OverviewSnapshot {
  readonly catalog: Section<AppCatalogRow>
  readonly workspaces: Section<WorkspaceRow>
  readonly tasks: TasksSection
}

/** 应用目录分区（ctx.apps 缺席 → 不可用）/ the catalog section (no ctx.apps → unavailable) */
function catalogSection(ctx: Context): Section<AppCatalogRow> {
  const apps = ctx.get('apps')
  if (apps === undefined) {
    return { available: false, rows: [] }
  }
  const rows = apps.catalog().map((record) => ({
    id: record.definition.id,
    name: record.definition.name,
    state: record.state,
    toolPrefix: record.toolPrefix,
  }))
  return { available: true, rows }
}

/** 工作区分区（注册表缺席 → 不可用）/ the workspace section (no registry → unavailable) */
function workspaceSection(ctx: Context): Section<WorkspaceRow> {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) {
    return { available: false, rows: [] }
  }
  const rows = registry.list().map((workspace) => ({
    id: workspace.id,
    title: workspace.title,
    sessions: workspace.sessionIds.length,
  }))
  return { available: true, rows }
}

/**
 * 待办任务分区：任务中心缺席或读取失败都显式降级，不抛异常。
 * The tasks section: absent task center or a failed read degrades explicitly.
 */
async function tasksSection(ctx: Context): Promise<TasksSection> {
  const taskCenter = ctx.get('taskCenter')
  if (taskCenter === undefined || typeof taskCenter.list !== 'function') {
    return { available: false, openCount: null, detail: 'task center is not installed in this deployment' }
  }
  try {
    const open = await taskCenter.list({ status: 'open' })
    return { available: true, openCount: open.length, detail: 'live from the task center' }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    return { available: false, openCount: null, detail: `task center read failed: ${detail}` }
  }
}

/**
 * 组装一次概览快照：全部真实数据，缺席服务显示不可用。
 * Assemble one overview snapshot: real data only; absent services read unavailable.
 */
export async function buildOverviewSnapshot(ctx: Context): Promise<OverviewSnapshot> {
  return {
    catalog: catalogSection(ctx),
    workspaces: workspaceSection(ctx),
    tasks: await tasksSection(ctx),
  }
}

/** 未刷新时的空快照：三区都显式不可用 / the never-refreshed snapshot: all sections unavailable */
function emptySnapshot(): OverviewSnapshot {
  return {
    catalog: { available: false, rows: [] },
    workspaces: { available: false, rows: [] },
    tasks: { available: false, openCount: null, detail: 'not refreshed yet' },
  }
}

/**
 * 概览数据源：页面 tree 同步读缓存，onLoad 触发异步刷新。
 * The overview source: the page tree reads the cache synchronously; onLoad
 * triggers an async refresh.
 */
export class OverviewSource {
  private snapshot: OverviewSnapshot = emptySnapshot()

  constructor(private readonly ctx: Context) {}

  /** 最新已知快照（引用稳定，可能尚未刷新）/ the latest known snapshot (stable, maybe stale) */
  current(): OverviewSnapshot {
    return this.snapshot
  }

  /** 重新读取全部服务面并换掉快照引用 / re-read every service face and swap the snapshot */
  async refresh(): Promise<void> {
    this.snapshot = await buildOverviewSnapshot(this.ctx)
  }
}
