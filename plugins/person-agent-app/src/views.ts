/**
 * 数据面服务：概览快照的构建与缓存，挂载为 `ctx.personAgentOverview`。
 * 读取的三个服务面（apps / workspaceRegistry / taskCenter）经 `static inject`
 * 声明为自身依赖（G13）——`this.ctx` 上直接用 declaration merging 暴露的服务面，
 * 不做任何运行期探测，也没有"服务缺席"分支。
 * - `ctx.apps.catalog()` / `ctx.workspaceRegistry.list()` 是同步内存读；
 * - `ctx.taskCenter.list()` 是异步读：页面 tree 是同步纯函数，所以任务区走
 *   「刷新 + 缓存」——读取失败显式标注不可用，绝不假装有数据。
 * The overview data-plane service: snapshot building and caching, mounted as
 * `ctx.personAgentOverview`. The three service faces it reads (apps /
 * workspaceRegistry / taskCenter) are declared as its own dependencies via
 * `static inject` (G13) — the declaration-merged service faces on `this.ctx`
 * are used directly; no runtime probing, no "service absent" branch.
 * - `apps.catalog()` / `workspaces.list()` are sync in-memory reads;
 * - `tasks.list()` is async, and the page tree is a sync pure function, so the
 *   tasks section is refresh-and-cache — a failed read is reported, never faked.
 * @module @veren/person-agent-app
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：拉取 apps / taskCenter / workspaceRegistry 的 Context 声明合并。
// Type-only imports: pull the apps / taskCenter / workspaceRegistry merging.
import type {} from '@veren/app-registry'
import type {} from '@veren/task-center'
import type {} from '@deepseek-ai/dsh-workspace'

/** 服务名（ctx.personAgentOverview / inject 'personAgentOverview'）/ service name */
export const PERSON_AGENT_OVERVIEW_NAME = 'personAgentOverview'

/** 概览页依赖的三个服务面：纯函数数据入口的显式参数面（G13 规则 2）/ the explicit faces parameter of the pure builders */
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

/** 应用目录分区（apps 是声明的依赖，读取本身不会缺席）/ the catalog section */
function catalogSection(apps: Context['apps']): Section<AppCatalogRow> {
  const rows = apps.catalog().map((record) => ({
    id: record.definition.id,
    name: record.definition.name,
    state: record.state,
    toolPrefix: record.toolPrefix,
  }))
  return { available: true, rows }
}

/** 工作区分区（注册表是声明的依赖，读取本身不会缺席）/ the workspace section */
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
 * 概览数据源服务：页面 tree 同步读最新缓存，onLoad 触发异步刷新。
 * 快照状态是本服务唯一的自有状态；三个服务面在读取时经 `this.ctx` 解析
 * （static inject 已声明），服务自身不持有它们的引用。
 * The overview source service: the page tree reads the latest cache
 * synchronously; onLoad triggers an async refresh. The snapshot is the only
 * state owned here; the three service faces are resolved through `this.ctx`
 * at read time (declared by static inject) — no references are held.
 */
export class PersonAgentOverviewService extends Service {
  /** 本服务读取的三个兄弟服务面 / the three sibling service faces read here */
  static inject = ['apps', 'workspaceRegistry', 'taskCenter']

  private snapshot: OverviewSnapshot = emptySnapshot()

  constructor(ctx: Context) {
    super(ctx, PERSON_AGENT_OVERVIEW_NAME)
  }

  /** 最新已知快照（引用稳定，可能尚未刷新）/ the latest known snapshot (stable, maybe stale) */
  current(): OverviewSnapshot {
    return this.snapshot
  }

  /** 重新读取全部服务面并换掉快照引用 / re-read every service face and swap the snapshot */
  async refresh(): Promise<void> {
    this.snapshot = await buildOverviewSnapshot({
      apps: this.ctx.apps,
      workspaces: this.ctx.workspaceRegistry,
      tasks: this.ctx.taskCenter,
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 概览数据源：页面 load/tree 的数据面（@veren/person-agent-app 提供）。 */
    personAgentOverview: PersonAgentOverviewService
  }
}
