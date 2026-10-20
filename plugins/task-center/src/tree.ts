/**
 * 任务树索引与整树操作（§4.7.1–§4.7.3 的纯逻辑部分）。
 * The task-tree index and whole-tree operations (the pure logic of §4.7.1–§4.7.3).
 *
 * 存储域是键值表，这里在其上维护两份内存索引，随每次写入增量更新：
 * - `byParent`：直接子节点查询（单值索引，O(直接子数)）；
 * - `byAncestor`：`ancestorIds` 数组包含谓词的多值索引——每条记录把自己的每个祖先
 *   映射到自身，于是“取整棵子树”是一次精确查找，不做全表扫描。
 * The storage domain is a key/value table; this keeps two in-memory indexes over
 * it, updated incrementally on every write:
 * - `byParent`: direct-children lookup (single-value index, O(direct children));
 * - `byAncestor`: the multi-value index behind the "ancestorIds containment"
 *   predicate — every record maps each of its ancestors to itself, so "fetch the
 *   whole subtree" is one exact lookup, never a full table scan.
 *
 * @module @veren/task-center/tree
 */
import { TaskErrorCode } from './types.ts'
import type { SubtreeLimitDetail, TaskId, TaskRecord } from './types.ts'

/** 深度安全上限 / depth safety limit (§4.7.1) */
export const MAX_TREE_DEPTH = 8
/** 单节点直接子节点上限 / direct-children-per-node limit */
export const MAX_TREE_WIDTH = 32
/** 单棵树节点总数上限 / nodes-per-tree limit */
export const MAX_TREE_SIZE = 200

/** 树上全部终态（级联与完成校验都以此为准）/ every terminal status */
export const TERMINAL_STATUSES: ReadonlySet<TaskRecord['status']>
  = new Set(['done', 'failed', 'expired', 'cancelled', 'orphaned'])

/** 级联目标：祖先进入 `cancelled`/`expired`/`orphaned` 时子树的归宿（§4.7.2 规则二）。 */
export type CascadeKind = 'cancelled' | 'orphaned'

/** 从 `expired` 祖先级联时，`open` 后代 → `expired`，`taken` 后代 → `cancelled`（§4.7.2）。 */
export function cascadeStatusOf(status: TaskRecord['status'], kind: CascadeKind | 'expired'): TaskRecord['status'] {
  if (kind !== 'expired') return kind
  return status === 'taken' ? 'cancelled' : 'expired'
}

/** 一条记录所在的树根 id：祖先链第一个，没有祖先就是它自己 / the tree root of a record */
export function rootIdOf(record: TaskRecord): TaskId {
  return record.ancestorIds[0] ?? record.id
}

/** 一条记录的深度：根为 1 / the depth of a record (root = 1) */
export function depthOf(record: TaskRecord): number {
  return record.ancestorIds.length + 1
}

/** 记录及其全部后代构成的“树路径” / the record's id plus its whole ancestor chain */
export function treePathOf(record: TaskRecord): readonly TaskId[] {
  return [...record.ancestorIds, record.id]
}

/**
 * 任务树索引：服务每次写任务都同步 `put`，读侧的树查询全部走索引。
 * The task-tree index: the service `put`s on every write, and every read-side
 * tree query goes through the index.
 */
export class TaskTreeIndex {
  private readonly rows = new Map<string, TaskRecord>()
  /** parentId → 直接子节点 id / parentId → direct child ids */
  private readonly byParent = new Map<string, string[]>()
  /** 祖先 id → 以它为祖先的全部后代 id（含各层）/ ancestor id → all descendant ids */
  private readonly byAncestor = new Map<string, Set<string>>()

  /** 用当前全部记录重建（打开存储域时一次）/ rebuild from every record (once per domain open) */
  rebuild(records: readonly TaskRecord[]): void {
    this.rows.clear()
    this.byParent.clear()
    this.byAncestor.clear()
    for (const record of records) this.insert(record)
  }

  get(id: TaskId): TaskRecord | undefined {
    return this.rows.get(id)
  }

  /** 全部记录（列表页等无树语义的查询用）/ every record (for tree-less queries like list) */
  all(): readonly TaskRecord[] {
    return [...this.rows.values()]
  }

  /** 写入/更新一条记录并维护两份索引 / upsert one record and maintain both indexes */
  put(record: TaskRecord): void {
    this.insert(record)
  }

  /** 整棵子树：`ancestorIds` 包含 rootId 的全部记录 + 根自己（一次索引查询）。 */
  subtree(rootId: TaskId): TaskRecord[] {
    const ids = this.byAncestor.get(rootId) ?? new Set<string>()
    return [this.rows.get(rootId), ...[...ids].map(id => this.rows.get(id))]
      .filter((record): record is TaskRecord => record !== undefined)
  }

  /** 直接子节点 / direct children */
  directChildren(parentId: TaskId): TaskRecord[] {
    return (this.byParent.get(parentId) ?? []).map(id => this.rows.get(id))
      .filter((record): record is TaskRecord => record !== undefined)
  }

  /** 树内仍非终态的后代（不含 root 自己）/ non-terminal descendants in the subtree (root excluded) */
  activeDescendants(rootId: TaskId): TaskRecord[] {
    return this.subtree(rootId).filter(record =>
      record.id !== rootId && !TERMINAL_STATUSES.has(record.status))
  }

  private insert(record: TaskRecord): void {
    this.rows.set(record.id, record)
    if (record.parentId !== undefined) {
      const siblings = this.byParent.get(record.parentId) ?? []
      if (!siblings.includes(record.id)) siblings.push(record.id)
      this.byParent.set(record.parentId, siblings)
    }
    for (const ancestor of record.ancestorIds) {
      const bucket = this.byAncestor.get(ancestor) ?? new Set<string>()
      bucket.add(record.id)
      this.byAncestor.set(ancestor, bucket)
    }
  }
}

/**
 * 子任务创建前的三条安全上限校验（§4.7.1），超限 fail loud。
 * The three safety-limit checks before creating a subtask; over-limit is fail loud.
 */
export function checkSubtreeLimits(
  parent: TaskRecord,
  existingDirectChildren: number,
  existingTreeSize: number,
): void {
  const depth = depthOf(parent) + 1
  if (depth > MAX_TREE_DEPTH) {
    throwLimit({ kind: 'depth', limit: MAX_TREE_DEPTH, actual: depth })
  }
  if (existingDirectChildren + 1 > MAX_TREE_WIDTH) {
    throwLimit({ kind: 'width', limit: MAX_TREE_WIDTH, actual: existingDirectChildren + 1 })
  }
  if (existingTreeSize + 1 > MAX_TREE_SIZE) {
    throwLimit({ kind: 'size', limit: MAX_TREE_SIZE, actual: existingTreeSize + 1 })
  }
}

/**
 * One structured refusal: a stable code plus a readable account, optionally
 * carrying the machine-readable limit detail of `task/subtree-limit`.
 * One structured refusal：稳定 code + 可读说明；`task/subtree-limit` 额外带机器可读明细。
 *
 * 类声明在 tree.ts（service 反向依赖它），全仓只有这一份 TaskError。
 */
export class TaskError extends Error {
  constructor(readonly code: string, message: string, readonly details?: SubtreeLimitDetail) {
    super(message)
    this.name = 'TaskError'
  }
}

function throwLimit(detail: SubtreeLimitDetail): never {
  throw new TaskError(TaskErrorCode.SubtreeLimit,
    `subtree limit exceeded: ${detail.kind} ${detail.actual} > ${detail.limit}`, detail)
}
