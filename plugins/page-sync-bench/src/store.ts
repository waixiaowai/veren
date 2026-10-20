/**
 * 版本化任务存储 / Versioned task store
 *
 * 权威状态在服务端；补丁是追加日志；快照是兜底。
 * Authoritative state lives server-side; patches are append-only log; snapshots are the fallback.
 */
import type { Op, Snapshot, Sync, TaskItem, ToolOutcome } from './types.ts'

interface Commit {
  version: number
  ops: Op[]
}

export interface StoreOptions {
  maxPatchGap?: number
}

function clone(items: TaskItem[]): TaskItem[] {
  return items.map((item) => ({ ...item }))
}

/** 内容是否相等 / structural equality */
function isEqual(a: TaskItem, b: TaskItem): boolean {
  return a.title === b.title && a.status === b.status && a.ownerId === b.ownerId
}

/** key-based diff：稳定 id 对位，产出最小 ops（顺序：先 upsert 后 remove）*/
export function diffItems(prev: TaskItem[], next: TaskItem[]): Op[] {
  const prevMap = new Map(prev.map((item) => [item.id, item]))
  const nextIds = new Set(next.map((item) => item.id))
  const ops: Op[] = []
  for (const item of next) {
    const old = prevMap.get(item.id)
    if (!old || !isEqual(old, item)) ops.push({ op: 'upsert', item: { ...item } })
  }
  for (const [id] of prevMap) {
    if (!nextIds.has(id)) ops.push({ op: 'remove', id })
  }
  return ops
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

export class TaskStore {  private items: TaskItem[]
  private version = 0
  private readonly commits: Commit[] = []
  private readonly maxPatchGap: number

  constructor(initial: TaskItem[] = [], options: StoreOptions = {}) {
    this.items = clone(initial)
    this.maxPatchGap = options.maxPatchGap ?? 20
  }

  get currentVersion(): number {
    return this.version
  }

  /** 写操作：服务端 diff，一次 commit 版本 +1（batching）*/
  commit(next: TaskItem[]): number {
    const ops = diffItems(this.items, next)
    if (ops.length === 0) return this.version
    this.items = clone(next)
    this.version += 1
    this.commits.push({ version: this.version, ops })
    return this.version
  }

  /** 同步：增量优先，缺口过大 / 游标超前回落全量（正确性兜底）*/
  sync(sinceVersion?: number): Sync {
    if (sinceVersion === undefined || sinceVersion > this.version
      || this.version - sinceVersion > this.maxPatchGap) {
      return { kind: 'snapshot', version: this.version, items: clone(this.items) }
    }
    const ops = this.commits
      .filter((commit) => commit.version > (sinceVersion ?? 0))
      .flatMap((commit) => commit.ops)
    return { kind: 'patch', fromVersion: sinceVersion, toVersion: this.version, ops }
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
    this.version += 1
    this.commits.push({ version: this.version, ops: [{ op: 'upsert', item: { ...item } }] })
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
    this.version += 1
    this.commits.push({ version: this.version, ops: [{ op: 'upsert', item: { ...item } }] })
    return { ok: true, detail: `${id} completed` }
  }
}
