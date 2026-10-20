/**
 * 页面 store：任务工作台三页共享的内存任务集（可订阅，供页面挂载同步）。
 * Page store: the in-memory task set shared by the three pages (subscribable
 * for page-session sync). 与 page-sync-bench 同型，但归属本应用作用域。
 * @module @veren/task-workbench
 */
import type { TaskItem } from './types.ts'

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

/** 最小可订阅 store：getSnapshot 引用稳定，变更才通知 / minimal subscribable store */
export class TaskStore {
  private items: TaskItem[]
  private readonly listeners = new Set<() => void>()

  constructor(initial: TaskItem[]) {
    this.items = initial
  }

  /** 当前快照（引用稳定，变更才换）/ current snapshot (stable reference between changes) */
  getSnapshot(): TaskItem[] {
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

  /** 本地追加一条 open 任务（发布降级路径也走这里）/ append a local open task */
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
