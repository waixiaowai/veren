/**
 * 概览数据契约（纯类型 + 空快照初值）：没有读取器、没有服务——页面组件直接从
 * 组件 ctx 读取三个服务面（`ctx.apps` / `ctx.workspaceRegistry` / `ctx.taskCenter`）
 * 并就地组装快照，读取的自由度完全在页面组件手里。
 * The overview data contract (pure types + the empty-snapshot initial value):
 * no reader, no service — page components read the three service faces off the
 * component ctx (`ctx.apps` / `ctx.workspaceRegistry` / `ctx.taskCenter`) and
 * assemble the snapshot in place; data-loading freedom belongs entirely to the
 * page component.
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

/** 未刷新时的空快照：三区都显式不可用（useState 的初值）/ the never-refreshed snapshot: all sections unavailable (the useState initial value) */
export function emptySnapshot(): OverviewSnapshot {
  return {
    catalog: { available: false, rows: [] },
    workspaces: { available: false, rows: [] },
    tasks: { available: false, openCount: null, detail: 'not refreshed yet' },
  }
}
