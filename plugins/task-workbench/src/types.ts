/**
 * 领域类型（只放类型）/ Domain types (types only)
 *
 * 任务工作台的内存面：页面 store 的条目与工具返回结果。
 * In-memory face of the workbench: page-store items and tool outcomes.
 *
 * 任务条目从扁平列表改为树投影（§4.7.8 第 4 条）：条目带 `parentId`，
 * 整棵子树的进度/展开状态都是派生值，不落 store。
 * Task items are a tree projection now (§4.7.8 item 4): items carry `parentId`;
 * whole-subtree progress and expand state are derived values, never stored.
 * @module @veren/task-workbench
 */

/** 列表页展示的任务条目 / one task item shown on the list page */
export interface TaskItem {
  readonly id: string
  readonly title: string
  readonly status: 'open' | 'taken' | 'done'
  readonly ownerId?: string
  /** 直接父任务 id；缺省 = 根任务（§4.7.1，随创建一次定型）/ direct parent id; absent = root */
  readonly parentId?: string
}

/**
 * 整棵子树的进度口径（§4.7.8 第 1 条）：全树终态数 / 全树节点数，含根自己。
 * Whole-subtree progress (§4.7.8 item 1): terminal nodes / all nodes, root included.
 */
export interface SubtreeProgress {
  /** 树根 id / the tree root id */
  readonly rootId: string
  /** 全树节点数 / nodes in the whole tree */
  readonly total: number
  /** 全树终态节点数 / terminal nodes in the whole tree */
  readonly done: number
  /** 展示为 `2/5` / rendered as `2/5` */
  readonly label: string
  /** 树里还有非终态节点（“进行中”标记）/ the tree still has non-terminal nodes */
  readonly active: boolean
}

/** 列表页条目投影：根任务 + 整树进度 / list-page projection: a root plus its subtree progress */
export type TaskListItem = TaskItem & {
  /** 仅根任务携带 / present on roots only */
  readonly progress?: SubtreeProgress
}

/** 详情页子任务树节点投影 / detail-page subtask-tree node projection */
export interface SubtaskNode {
  readonly item: TaskItem
  /** 相对根的深度（根的直接子节点为 1）/ depth below the root (direct children = 1) */
  readonly depth: number
  /** 默认展开（活跃分支）/ expanded by default (active branch) */
  readonly expanded: boolean
  /** 该节点直接子节点的整树进度 / subtree progress of this node */
  readonly progress: SubtreeProgress
}

/** 子任务树区的渲染行：带 id 的 Keyed 条目 / a rendered row of the subtask tree: a keyed entity with an id */
export interface SubtaskRow {
  readonly id: string
  readonly title: string
  readonly status: TaskItem['status']
  /** 相对根的深度（根的直接子节点为 1）/ depth below the root (direct children = 1) */
  readonly depth: number
  /** 默认展开（活跃分支）/ expanded by default (active branch) */
  readonly expanded: boolean
  /** 整树进度徽标 `2/5` / whole-subtree progress badge `2/5` */
  readonly progress: string
}

/** 工具执行结果：ok=false 时带稳定 code 与人读说明 / tool outcome with a stable code on failure */
export interface ToolOutcome {
  readonly ok: boolean
  readonly code?: string
  readonly detail?: string
  /** 任务中心缺席降级标记 / set when the publish fell back to the local store */
  readonly degraded?: boolean
}
