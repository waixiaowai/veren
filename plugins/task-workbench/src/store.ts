/**
 * 页面 store：任务工作台的首屏投影（可订阅）。v2 起队列权威在任务中心
 * （docs/task-workbench-modes-dispatch §1.1）——store 不再是事实源，只把中心
 * 记录投影成同步可读的条目，供一次性渲染的组件体直读。
 * The page store: the workbench's first-screen projection (subscribable). From
 * v2 the queue's authority is the task center (§1.1 of the design doc) — the
 * store is no longer the fact source; it projects center records into
 * synchronously readable items for the one-shot component bodies.
 *
 * 树形（整树进度、展开分支、子任务节点列表）仍是纯函数派生——store 只存投影
 * 事实，不存派生（§4.7.8 第 4 条）。
 * The tree views (whole-subtree progress, expanded branches, subtask nodes)
 * remain pure derivations — the store keeps projected facts, never derived
 * data (§4.7.8 item 4).
 * @module @veren/task-workbench
 */
import type { TaskRecord } from '@veren/task-center'
import { activeRecordOf, belongsToQueue, itemKeyOf, SELF_APP_ID } from './strategy.ts'
import type { SubtaskNode, SubtreeProgress, TaskItem, TaskStatus } from './types.ts'

/** 记录状态 → 投影状态（同一词汇表，恒等映射）/ record status → item status (same vocabulary) */
function statusOf(record: TaskRecord): TaskStatus {
  return record.status
}

/** 一条根记录 → 工作单条目（链接字段三件套，§1.1）/ one root record → a work-order item (the three link fields) */
function itemOfRoot(id: string, group: readonly TaskRecord[]): TaskItem {
  const active = activeRecordOf(group)
  const dispatched = active.target.appId !== SELF_APP_ID
  return {
    id,
    title: active.title,
    status: statusOf(active),
    ...(active.claimedBy?.sessionId === undefined ? {} : { ownerId: active.claimedBy.sessionId }),
    ...(active.parentId === undefined ? {} : { parentId: active.parentId }),
    activeRecordId: active.id,
    ...(dispatched ? { dispatchedTo: active.target.appId } : {}),
    attempts: group.filter((entry) => entry.parentId === undefined).length,
  }
}

/** 一条子任务记录 → 子任务投影行 / one subtask record → a subtask projection row */
function itemOfSubtask(record: TaskRecord, parentItemId: string): TaskItem {
  return {
    id: `wb-${record.id}`,
    title: record.title,
    status: statusOf(record),
    ...(record.claimedBy?.sessionId === undefined ? {} : { ownerId: record.claimedBy.sessionId }),
    parentId: parentItemId,
  }
}

/**
 * 整棵子树的进度（含根自己；§4.7.8 第 1 条的 `2/5` 口径）。
 * Whole-subtree progress (root included; §4.7.8 item 1's `2/5`).
 */
export function subtreeProgress(items: readonly TaskItem[], rootId: string): SubtreeProgress {
  const tree = [items.find((item) => item.id === rootId), ...descendantsOf(items, rootId)]
    .filter((item): item is TaskItem => item !== undefined)
  const done = tree.filter((item) => TERMINAL.has(item.status)).length
  return {
    rootId,
    total: tree.length,
    done,
    label: `${done}/${tree.length}`,
    active: done < tree.length,
  }
}

/** 记录终态集合（与 task-center 同口径）/ the terminal statuses (same as the task center) */
const TERMINAL: ReadonlySet<TaskStatus> = new Set(['done', 'failed', 'expired', 'cancelled', 'orphaned'])

/** 根工作单条目（列表口径：只出根）/ the root items (list view: roots only) */
export function rootsOf(items: readonly TaskItem[]): TaskItem[] {
  return items.filter((item) => item.parentId === undefined)
}

/** 一条工作单的全部后代（各层，深度优先）/ every descendant of one order, depth first */
export function descendantsOf(items: readonly TaskItem[], id: string): TaskItem[] {
  const result: TaskItem[] = []
  for (const child of items.filter((item) => item.parentId === id)) {
    result.push(child, ...descendantsOf(items, child.id))
  }
  return result
}

/**
 * 详情页子任务树投影（§4.7.8 第 2 条）：活跃分支默认展开，终态分支折叠。
 * The detail-page subtask-tree projection (§4.7.8 item 2): active branches
 * expand by default, terminal branches collapse.
 */
export function subtaskTree(items: readonly TaskItem[], rootId: string): SubtaskNode[] {
  const depthOf = new Map<string, number>([[rootId, 0]])
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
 * 最小可订阅投影 store：getState 引用稳定、变更才通知。
 * The minimal subscribable projection store: stable getState references,
 * notifying only on change.
 */
export class TaskStore {
  private items: TaskItem[]
  private readonly listeners = new Set<() => void>()

  constructor(initial: TaskItem[] = []) {
    this.items = initial
  }

  /** 当前投影（引用稳定，变更才换）/ the current projection (stable reference) */
  getState(): TaskItem[] {
    return this.items
  }

  /** 订阅变更；返回退订函数 / subscribe; returns an unsubscribe */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 从任务中心记录重建投影（队列权威搬家的收敛点）：根 = 入站/出站的根级
   * 记录按工作单 id 分组；子 = ancestorIds 前缀归属其根的工作单。
   * Rebuild the projection from task-center records (the queue-authority move's
   * convergence point): roots = root-level records grouped by work-order id;
   * subtasks join their root's group via the ancestorIds prefix.
   */
  rebuildFrom(records: readonly TaskRecord[]): void {
    const mine = records.filter((record) => belongsToQueue(record))
    const roots = mine.filter((record) => record.parentId === undefined)
    const groups = new Map<string, TaskRecord[]>()
    for (const root of roots) {
      const key = itemKeyOf(root)
      groups.set(key, [...groups.get(key) ?? [], root])
    }
    const rootIdOf = new Map(roots.map((root) => [root.id, itemKeyOf(root)]))
    const items: TaskItem[] = [...groups.entries()]
      .map(([id, group]) => itemOfRoot(id, group))
    for (const record of mine) {
      if (record.parentId === undefined) continue
      const parentItemId = rootIdOf.get(record.parentId)
      if (parentItemId === undefined) continue
      items.push(itemOfSubtask(record, parentItemId))
    }
    this.items = items
    this.notify()
  }

  /**
   * 单条投影更新：发布/改派（新根条目）与接取/完成/放弃（按载体记录 id 同步
   * 状态）。投影是给首屏看的，不承载互斥——权威永远在中心。
   * One projection update: publish/requeue (a new root item) and take/complete/
   * release (status sync by vehicle record id). The projection feeds the first
   * screen only; the mutex authority always lives in the center.
   */
  syncRecord(record: TaskRecord): void {
    const existing = this.items.find((item) => item.activeRecordId === record.id)
      ?? (record.parentId === undefined ? this.items.find((item) => item.id === itemKeyOf(record)) : undefined)
    if (existing === undefined) {
      if (record.parentId !== undefined) return
      this.items = [...this.items, itemOfRoot(itemKeyOf(record), [record])]
    } else {
      const dispatched = record.target.appId !== SELF_APP_ID
      const next: TaskItem = {
        ...existing,
        title: record.title,
        status: statusOf(record),
        ...(record.claimedBy?.sessionId === undefined ? {} : { ownerId: record.claimedBy.sessionId }),
        activeRecordId: record.id,
        ...(dispatched ? { dispatchedTo: record.target.appId } : {}),
      }
      this.items = this.items.map((item) => (item === existing ? next : item))
    }
    this.notify()
  }

  /**
   * 投影级接取（无中心记录的纯本地工作单）：open → taken；done 拒绝。互斥
   * 权威在中心租约，这里只动首屏投影。
   * The projection-level claim (a pure-local order with no center record):
   * open → taken; done refuses. The mutex authority is the center's lease —
   * this only moves the first-screen projection.
   */
  claimLocal(taskId: string, owner: string): void {
    const item = this.items.find((entry) => entry.id === taskId)
    if (item === undefined || item.status === 'done') return
    this.items = this.items.map((entry) => (entry === item
      ? { ...entry, status: 'taken' as const, ownerId: owner }
      : entry))
    this.notify()
  }

  /**
   * 下一个发布用的本地工作单 id（`t-<n>`，从现有条目推大，URL 参数跨重启
   * 由重建按 target.params.taskId 对齐）。
   * The next local work-order id for publishing (`t-<n>`, grown from the
   * existing items; restart stability comes from rebuild aligning on
   * target.params.taskId).
   */
  nextItemId(): string {
    let max = 0
    for (const item of this.items) {
      const match = /^t-(\d+)$/.exec(item.id)
      if (match !== null) max = Math.max(max, Number(match[1]))
    }
    return `t-${max + 1}`
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
