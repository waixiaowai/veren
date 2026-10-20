/**
 * 领域类型（只放类型）/ Domain types (types only)
 *
 * 任务工作台的内存面：页面 store 的条目与工具返回结果。
 * In-memory face of the workbench: page-store items and tool outcomes.
 * @module @veren/task-workbench
 */

/** 列表页展示的任务条目 / one task item shown on the list page */
export interface TaskItem {
  readonly id: string
  readonly title: string
  readonly status: 'open' | 'taken' | 'done'
  readonly ownerId?: string
}

/** 工具执行结果：ok=false 时带稳定 code 与人读说明 / tool outcome with a stable code on failure */
export interface ToolOutcome {
  readonly ok: boolean
  readonly code?: string
  readonly detail?: string
  /** 任务中心缺席降级标记 / set when the publish fell back to the local store */
  readonly degraded?: boolean
}
