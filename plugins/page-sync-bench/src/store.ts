/**
 * 权威任务存储：纯领域语义 + 订阅通知（版本化属于宿主层）
 * Authoritative task store: pure domain semantics + subscriptions (versioning belongs to the host layer)
 *
 * 不可变纪律：数组整体替换，绝不原地修改（内核 diff 按内容比较，别名会让旧状态跟着变）。
 */
import type { TaskItem, ToolOutcome } from './types.ts'

/** 任务集合在页面树中的路径 / path of the task collection in the page tree */
export const TASKS_PATH = 'tasks'

/** 构造 n 条初始任务 / build an initial list of n tasks */
export function makeList(n: number): TaskItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t-${i}`,
    title: `任务 ${i}：修复登录页深色模式样式偏移并补充回归测试`,
    status: 'open' as const,
    ownerId: null,
  }))
}

export class TaskStore {
  private items: TaskItem[]
  private readonly listeners = new Set<() => void>()

  constructor(initial: TaskItem[] = []) {
    this.items = initial
  }

  getState(): TaskItem[] {
    return this.items
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 通知订阅者（bindStore → 重渲染 → 宿主提交）/ notify subscribers */
  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  /** 批量替换（服务端状态演化）/ wholesale replacement */
  commit(next: TaskItem[]): void {
    this.items = next
    this.emit()
  }

  /** 按钮语义：接取任务（open → taken）/ take-task button */
  takeTask(id: string, ownerId: string): ToolOutcome {
    const item = this.items.find((task) => task.id === id)
    if (!item) return { ok: false, code: 'task_not_found', detail: `no task ${id}` }
    if (item.status !== 'open') {
      return { ok: false, code: 'invalid_transition', detail: `${id} is ${item.status}, not open` }
    }
    this.replace({ ...item, status: 'taken', ownerId })
    return { ok: true, detail: `${id} taken by ${ownerId}` }
  }

  /** 按钮语义：完成任务（taken → done）/ complete-task button */
  completeTask(id: string): ToolOutcome {
    const item = this.items.find((task) => task.id === id)
    if (!item) return { ok: false, code: 'task_not_found', detail: `no task ${id}` }
    if (item.status !== 'taken') {
      return { ok: false, code: 'invalid_transition', detail: `${id} is ${item.status}, not taken` }
    }
    this.replace({ ...item, status: 'done' })
    return { ok: true, detail: `${id} completed` }
  }

  /** 不可变替换一条并通知 / immutably replace one item and notify */
  private replace(next: TaskItem): void {
    this.items = this.items.map((task) => (task.id === next.id ? next : task))
    this.emit()
  }
}
