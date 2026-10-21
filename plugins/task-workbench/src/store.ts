/**
 * 页面 store：任务工作台三页共享的内存任务集（可订阅，供页面挂载同步）。
 * Page store: the in-memory task set shared by the three pages (subscribable
 * for page-session sync). 与 page-sync-bench 同型，但归属本应用作用域。
 *
 * 任务集是扁平数组 + `parentId`，树形（整树进度、默认展开分支、子任务节点列表）
 * 全部是下面的纯函数派生——store 只存事实，不存派生（§4.7.8 第 4 条）。
 * The task set is a flat array + `parentId`; the tree views (whole-subtree
 * progress, default-expanded branches, subtask nodes) are pure derivations
 * below — the store keeps facts, never derived data (§4.7.8 item 4).
 * @module @veren/task-workbench
 */
import type { SubtaskNode, SubtreeProgress, TaskItem } from './types.ts'

/** 初始任务集 / the initial task list */
export function makeList(size: number): TaskItem[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `t-${index + 1}`,
    title: `示例任务 ${index + 1}`,
    status: 'open' as const,
  }))
}

/** 状态迁移结果 / outcome of one guarded migration */
export type Transition = 'ok' | 'not-found' | 'bad-state'

/** 终态集合（§4.7.1：与 task-center 同一口径）/ terminal statuses (same set as task-center) */
const TERMINAL: ReadonlySet<TaskItem['status']> = new Set(['done'])

/** 根任务条目（收件箱/列表口径：只出根）/ the root items (inbox/list view: roots only) */
export function rootsOf(items: readonly TaskItem[]): TaskItem[] {
  return items.filter((item) => item.parentId === undefined)
}

/** 一条任务的全部后代（各层，深度优先）/ every descendant of one task, depth first */
export function descendantsOf(items: readonly TaskItem[], id: string): TaskItem[] {
  const result: TaskItem[] = []
  for (const child of items.filter((item) => item.parentId === id)) {
    result.push(child, ...descendantsOf(items, child.id))
  }
  return result
}

/** 整棵子树的进度（含根自己；§4.7.8 第 1 条的 `2/5` 口径） */
export function subtreeProgress(items: readonly TaskItem[], rootId: string): SubtreeProgress {
  const tree = [items.find((item) => item.id === rootId), ...descendantsOf(items, rootId)]
    .filter((item): item is TaskItem => item !== undefined)
  const done = tree.filter((item) => TERMINAL.has(item.status)).length
  const progress: SubtreeProgress = {
    rootId,
    total: tree.length,
    done,
    label: `${done}/${tree.length}`,
    active: done < tree.length,
  }
  return progress
}

/**
 * 详情页子任务树投影（§4.7.8 第 2 条）：逐层列出全部后代，活跃分支（有非终态
 * 后代的节点）默认展开，终态分支折叠成进度徽标。
 * The detail-page subtask-tree projection (§4.7.8 item 2): lists every descendant
 * level by level; branches holding non-terminal nodes are expanded by default,
 * terminal branches collapse into a progress badge.
 */
export function subtaskTree(items: readonly TaskItem[], rootId: string): SubtaskNode[] {
  const depthOf = new Map<string, number>([[rootId, 0]])
  // 先算深度与“有活跃后代”标记，再投影 / compute depth and "has active
  // descendants" flags first, then project
  const hasActiveBelow = new Map<string, boolean>()
  for (const item of descendantsOf(items, rootId)) {
    const depth = (depthOf.get(item.parentId ?? '') ?? 0) + 1
    depthOf.set(item.id, depth)
    hasActiveBelow.set(item.id, item.status !== 'done')
  }
  for (const item of [...descendantsOf(items, rootId)].reverse()) {
    if (item.parentId === undefined) continue
    if (hasActiveBelow.get(item.id) === true) hasActiveBelow.set(item.parentId, true)
  }
  return descendantsOf(items, rootId).map((item) => ({
    item,
    depth: depthOf.get(item.id) ?? 0,
    expanded: hasActiveBelow.get(item.id) === true,
    progress: subtreeProgress(items, item.id),
  }))
}

/**
 * 最小可订阅 store：即 @veren/prompt-core 的 ExternalStore<TaskItem[]>（§3.10.3
 * 的权威数据源）：getState 引用稳定、变更才通知——正是活视图订阅所要求的形状。
 * The minimal subscribable store: exactly @veren/prompt-core's
 * ExternalStore<TaskItem[]> (the §3.10.3 authoritative source): getState keeps
 * a stable reference and notifies only on change — precisely the shape the
 * live-view subscription requires.
 */
export class TaskStore {
  private items: TaskItem[]
  private readonly listeners = new Set<() => void>()

  constructor(initial: TaskItem[]) {
    this.items = initial
  }

  /** 当前状态（引用稳定，变更才换）/ current state (stable reference between changes) */
  getState(): TaskItem[] {
    return this.items
  }

  /** 订阅变更；返回退订函数 / subscribe to changes; returns an unsubscribe */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 接取 open 任务 / take an open task */
  takeTask(id: string, owner: string): Transition {
    return this.mutate(id, (item) =>
      item.status !== 'open' ? null : { ...item, status: 'taken' as const, ownerId: owner })
  }

  /**
   * 页面作用域接取的本地投影（take_page_task 专用）：open → taken；已 taken 则
   * 幂等覆写 owner——互斥的权威在任务中心租约（§4.4），本地 store 只是页面数据，
   * 废弃会话的陈旧投影不该挡住新会话接取（§3.5.3 的收敛）。只有 done 拒绝。
   * / The local projection of a page-scoped take (take_page_task only):
   * open → taken; an already-taken item is overwritten idempotently — the mutex
   * authority is the task-center lease (§4.4), the local store is page data only,
   * and a deprecated session's stale projection must not block the fresh
   * session's take (the §3.5.3 convergence). Only done refuses.
   */
  claimTask(id: string, owner: string): Transition {
    return this.mutate(id, (item) =>
      item.status === 'done' ? null : { ...item, status: 'taken' as const, ownerId: owner })
  }

  /** 完成 taken 任务 / complete a taken task */
  completeTask(id: string): Transition {
    return this.mutate(id, (item) =>
      item.status !== 'taken' ? null : { ...item, status: 'done' as const })
  }

  /** 放弃 taken 任务（回到 open）/ abandon a taken task (back to open) */
  abandonTask(id: string): Transition {
    return this.mutate(id, (item) =>
      item.status !== 'taken' ? null : { ...item, status: 'open' as const, ownerId: undefined })
  }

  /**
   * 在 `parentId` 下新建一条子任务（§4.7.6 第 1 阶段的现拆）：只创建新记录，
   * 父指针一次定型、之后没有任何改挂入口——环在结构上不可能。
   * / Create one subtask under `parentId` (phase-1 on-the-spot split, §4.7.6):
   * a fresh record whose parent pointer is fixed once — no re-parenting entry
   * point exists, so cycles are structurally impossible.
   */
  splitTask(parentId: string, title: string): { outcome: Transition; item?: TaskItem } {
    const parent = this.items.find((item) => item.id === parentId)
    if (parent === undefined) return { outcome: 'not-found' }
    if (parent.status !== 'taken') return { outcome: 'bad-state' }
    const item: TaskItem = {
      id: `t-${this.items.length + 1}`,
      title,
      status: 'open',
      parentId,
    }
    this.items = [...this.items, item]
    this.notify()
    return { outcome: 'ok', item }
  }

  /** 本地追加一条 open 根任务（发布降级路径也走这里）/ append a local open root task */
  publishLocal(title: string): TaskItem {
    const item: TaskItem = { id: `t-${this.items.length + 1}`, title, status: 'open' }
    this.items = [...this.items, item]
    this.notify()
    return item
  }

  // ---- 内部 / internals ----

  /** 条件迁移：handler 返回 null 表示当前状态不允许 / guarded migration; null = state forbids */
  private mutate(id: string, handler: (item: TaskItem) => TaskItem | null): Transition {
    const current = this.items.find((item) => item.id === id)
    if (current === undefined) return 'not-found'
    const next = handler(current)
    if (next === null) return 'bad-state'
    this.items = this.items.map((item) => (item.id === id ? next : item))
    this.notify()
    return 'ok'
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
