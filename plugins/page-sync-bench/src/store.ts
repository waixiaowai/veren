/**
 * 任务存储（page-sync-core 的领域消费方）/ Task store (domain consumer of page-sync-core)
 *
 * 版本化、补丁日志、压实、同步协议全部委托内核 PageStore；
 * 本文件只有任务领域语义：条目集合、按钮状态迁移、领域 diff 包装。
 */
import { PageStore, diffKeyed, keyedNode } from '@veren/page-sync-core'
import type { Op, StoreOptions, Sync } from '@veren/page-sync-core'
import type { TaskItem, ToolOutcome } from './types.ts'

/** 任务集合在页面树中的固定路径 / fixed tree path of the task collection */
export const TASKS_PATH = 'tasks'

function clone(items: TaskItem[]): TaskItem[] {
  return items.map((item) => ({ ...item }))
}

/** key-based diff（委托内核，canonical 相等性）/ keyed diff delegated to core */
export function diffItems(prev: TaskItem[], next: TaskItem[]): Op[] {
  return diffKeyed(TASKS_PATH, prev, next)
}

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
  private readonly page: PageStore

  constructor(initial: TaskItem[] = [], options: StoreOptions = {}) {
    this.items = clone(initial)
    // 树内快照与工作数组必须隔离：内核 diff 靠内容比较，别名会让“旧状态”跟着被改
    this.page = new PageStore([keyedNode(TASKS_PATH, clone(this.items))], options)
  }

  get currentVersion(): number {
    return this.page.currentVersion
  }

  /** 批量写：服务端 diff，一次 commit 版本 +1（batching）*/
  commit(next: TaskItem[]): number {
    if (diffItems(this.items, next).length === 0) return this.currentVersion
    this.items = clone(next)
    this.commitTree()
    return this.currentVersion
  }

  /** 按钮语义：接取任务（open → taken）/ take-task button */
  takeTask(id: string, ownerId: string): ToolOutcome {
    const item = this.items.find((task) => task.id === id)
    if (!item) return { ok: false, code: 'task_not_found', detail: `no task ${id}` }
    if (item.status !== 'open') {
      return { ok: false, code: 'invalid_transition', detail: `${id} is ${item.status}, not open` }
    }
    item.status = 'taken'
    item.ownerId = ownerId
    this.commitTree()
    return { ok: true, detail: `${id} taken by ${ownerId}` }
  }

  /** 按钮语义：完成任务（taken → done）/ complete-task button */
  completeTask(id: string): ToolOutcome {
    const item = this.items.find((task) => task.id === id)
    if (!item) return { ok: false, code: 'task_not_found', detail: `no task ${id}` }
    if (item.status !== 'taken') {
      return { ok: false, code: 'invalid_transition', detail: `${id} is ${item.status}, not taken` }
    }
    item.status = 'done'
    this.commitTree()
    return { ok: true, detail: `${id} completed` }
  }

  /** 同步协议（委托内核：增量优先，缺口/压实前/游标超前回落全量）*/
  sync(sinceVersion?: number): Sync {
    return this.page.sync(sinceVersion)
  }

  /** 用当前条目重建页面树并提交（克隆数组：内核 diff 靠内容比较，原地变更也要可见）*/
  private commitTree(): void {
    this.page.update([keyedNode(TASKS_PATH, clone(this.items))])
  }
}
