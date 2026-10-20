/**
 * 数据面：概览快照的构建与缓存。三个服务面都是所属插件声明的硬 inject（G13），
 * 以参数显式传入——这里不做任何运行期探测，也没有"服务缺席"分支。
 * - `ctx.apps.catalog()` / `ctx.workspaceRegistry.list()` 是同步内存读；
 * - `ctx.taskCenter.list()` 是异步读：页面 tree 是同步纯函数，所以任务区走
 *   「刷新 + 缓存」——读取失败显式标注不可用，绝不假装有数据。
 * The data plane: overview snapshot building and caching. All three service
 * faces are hard injects of the owning plugin (G13) and arrive as explicit
 * parameters — no runtime probing, no "service absent" branch.
 * - `apps.catalog()` / `workspaces.list()` are sync in-memory reads;
 * - `tasks.list()` is async, and the page tree is a sync pure function, so the
 *   tasks section is refresh-and-cache — a failed read is reported, never faked.
 * @module @veren/person-agent-app
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：拉取 apps / taskCenter / workspaceRegistry 的 Context 声明合并。
// Type-only imports: pull the apps / taskCenter / workspaceRegistry merging.
import type {} from '@veren/app-registry'
import type {} from '@veren/task-center'
import type {} from '@deepseek-ai/dsh-workspace'

/** 概览页依赖的三个服务面：全部来自声明的 inject，纯参数传递（G13）/ the three injected service faces */
export interface OverviewFaces {
  readonly apps: Context['apps']
  readonly workspaces: Context['workspaceRegistry']
  readonly tasks: Context['taskCenter']
}

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

/** 通用分区 / a section */
export interface Section<T> {
  readonly available: boolean
  readonly rows: readonly T[]
}

/** 待办任务区：openCount 只有在读取成功时才有值 / the tasks section */
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

/** 应用目录分区（apps 是硬 inject，读取本身不会缺席）/ the catalog section */
function catalogSection(apps: Context['apps']): Section<AppCatalogRow> {
  const rows = apps.catalog().map((record) => ({
    id: record.definition.id,
    name: record.definition.name,
    state: record.state,
    toolPrefix: record.toolPrefix,
  }))
  return { available: true, rows }
}

/** 工作区分区（注册表是硬 inject，读取本身不会缺席）/ the workspace section */
function workspaceSection(workspaces: Context['workspaceRegistry']): Section<WorkspaceRow> {
  const rows = workspaces.list().map((workspace) => ({
    id: workspace.id,
    title: workspace.title,
    sessions: workspace.sessionIds.length,
  }))
  return { available: true, rows }
}

/**
 * 待办任务分区：读取失败显式降级为不可用，不抛异常（服务缺席不是可能的失败，
 * 只处理读取本身的错误）。
 * The tasks section: a failed read degrades explicitly; service absence is not
 * a possible failure, so only read errors are handled.
 */
async function tasksSection(tasks: Context['taskCenter']): Promise<TasksSection> {
  try {
    const open = await tasks.list({ status: 'open' })
    return { available: true, openCount: open.length, detail: 'live from the task center' }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    return { available: false, openCount: null, detail: `task center read failed: ${detail}` }
  }
}

/**
 * 组装一次概览快照：全部真实数据，读取失败显示不可用。
 * Assemble one overview snapshot: real data only; failed reads read unavailable.
 */
export async function buildOverviewSnapshot(faces: OverviewFaces): Promise<OverviewSnapshot> {
  return {
    catalog: catalogSection(faces.apps),
    workspaces: workspaceSection(faces.workspaces),
    tasks: await tasksSection(faces.tasks),
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
 * 概览数据源：页面 tree 同步读缓存，onLoad 触发异步刷新。三个服务面由装配处
 * 以参数显式传入，本类不接触 ctx。
 * The overview source: the page tree reads the cache synchronously; onLoad
 * triggers an async refresh. The three service faces are passed in explicitly
 * by the assembly; this class never touches ctx.
 */
export class OverviewSource {
  private snapshot: OverviewSnapshot = emptySnapshot()

  constructor(private readonly faces: OverviewFaces) {}

  /** 最新已知快照（引用稳定，可能尚未刷新）/ the latest known snapshot (stable, maybe stale) */
  current(): OverviewSnapshot {
    return this.snapshot
  }

  /** 重新读取全部服务面并换掉快照引用 / re-read every service face and swap the snapshot */
  async refresh(): Promise<void> {
    this.snapshot = await buildOverviewSnapshot(this.faces)
  }
}
