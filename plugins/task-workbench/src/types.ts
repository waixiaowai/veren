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
}

/** 页面工具拿到的执行上下文（本应用只用会话 id）/ the execution context page tools read (session id only) */
export interface ToolCallContext {
  readonly agent?: {
    readonly session?: {
      readonly id?: string
    }
  }
}

/**
 * 详情页会话解析出的那条任务：taskId 供本地投影，url 是任务中心 target 的
 * 主键（§4.2「任务目标存规范 URL」）。
 * / The task a detail-page session resolves to: taskId feeds the local
 * projection; url is the task center's target primary key (§4.2).
 */
export interface PageTaskRef {
  readonly taskId: string
  readonly url: string
}

/**
 * 详情页→任务 的作用域解析面（§3.10.1：详情页的活就是"动这一条"）。实现由
 * index.ts 用 page-registry 实例索引承担：本会话在 `task-workbench/detail`
 * 上的那条 live 行——URL 里已有 taskId，接取天然限定在"本页那条"，不靠参数。
 * / The detail-page→task scope resolver (§3.10.1: a detail page's job is to act
 * on its one record). index.ts implements it over the page-registry instance
 * index: this session's live `task-workbench/detail` row — the url already
 * carries the taskId, so the take is naturally scoped to "this page's task",
 * with no parameter to forge.
 */
export interface PageTaskScope {
  readonly liveDetailTaskOf: (sessionId: string) => Promise<PageTaskRef | undefined>
}
