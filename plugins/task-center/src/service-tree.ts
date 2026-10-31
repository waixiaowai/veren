/**
 * The task-tree machinery: the lazily rebuilt index, the single write path
 * (storage first, then index), the lazy sweep pump, subtree cascades, and the
 * tree-level guards (mutex and claimant).
 *
 * 存储域是键值表，这里在其上维护惰性重建的任务树索引，并收敛唯一写入口（先落存储，再同步
 * 索引）、懒清扫泵、子树级联与树级守卫（互斥与拆分权限）。
 *
 * @module @veren/task-center/service-tree
 */

import type { Context } from '@deepseek-ai/cordis'
import { view } from './storage.ts'
import type { TaskCenterStore } from './storage.ts'
import { TaskTreeIndex, TaskError, cascadeStatusOf, rootIdOf } from './tree.ts'
import { TERMINAL_STATUSES } from './tree.ts'
import type { CascadeKind } from './tree.ts'
import { TaskErrorCode } from './types.ts'
import type { TaskId, TaskRecord } from './types.ts'
import { isPast } from './service-storage.ts'
import type { TaskStorage } from './service-storage.ts'
import type { AppResolver } from './service.ts'

/** Collaborators every task operation runs through; owned by the service. */
export interface TaskOps {
  readonly host: Context
  /** Lazily wired app-registry lookup; `send` degrades when unset. */
  readonly appResolver: () => AppResolver | undefined
  /** The FIFO write chain every mutation queues on (§4.4). */
  readonly storage: TaskStorage
  readonly tree: TaskTree
}

/** Resolve one record or fail with task/not-found. */
export function requireTask(record: TaskRecord | undefined): TaskRecord {
  if (record === undefined) throw new TaskError(TaskErrorCode.NotFound, 'task not found')
  return record
}

/**
 * 任务树索引（§4.7.1）：随首次访问从存储重建，之后随每次写入增量维护。
 * 重建时机：索引挂在服务实例上，进程重启 = 新实例 = treeIndex 为 undefined =
 * 首个操作前从 KV 全量重建一次——持久化数据永远先于索引查询落进内存，不存在
 * “重启后索引为空、静默算错子树”的窗口。成本 O(全部任务数)（含终态），一次性；
 * 只在激活后首个操作发生。任务总量上万（远超单树 200 上限可积累的常规规模）才需要
 * 关注；不过滤终态行，因为级联/进度口径都要看到终态后代才能“保留/计数”。
 * The task-tree index: builds lazily; every tree query afterwards (subtree /
 * direct children / mutex / cascade) goes through it. Rebuild timing: the index
 * hangs off the service instance, so a process restart means a fresh instance
 * which rebuilds once from the KV rows before its first operation — persisted
 * data always lands in memory ahead of any index query; there is no "empty
 * index after restart, silently wrong subtree" window. Cost is O(all tasks,
 * terminal included), once per activation. Terminal rows are kept because
 * cascades and progress must still see terminal descendants to preserve/count
 * them.
 */
export class TaskTree {
  private treeIndex: TaskTreeIndex | undefined

  /** 任务表访问口：惰性建索引 / the task-table access point with a lazy index */
  tasks(domain: TaskCenterStore): TaskTreeIndex {
    if (this.treeIndex === undefined) {
      const index = new TaskTreeIndex()
      index.rebuild(view(domain.table('tasks')).all())
      this.treeIndex = index
    }
    return this.treeIndex
  }

  /** 唯一的任务写入口：先落存储，再同步索引 / the single task write path: storage first, then the index */
  async save(domain: TaskCenterStore, record: TaskRecord): Promise<void> {
    await view(domain.table('tasks')).put(record.id, record)
    this.tasks(domain).put(record)
  }

  /**
   * 树级互斥（§4.7.3）：sweep 之后任何 `taken` 节点的租约都还活着，所以判定就是
   * 两次索引查询——①同树（ancestorIds 前缀一次查询）内有无被别的会话持有的 taken →
   * `task/already-taken`；②同 URL 上其它树有无活跃接取者 → `task/another-active`。
   * Tree mutex (§4.7.3): after the sweep every `taken` lease is live, so the
   * check is exactly two index queries — ① a taken node held by another session
   * inside the same tree (one ancestorIds prefix query) → `task/already-taken`;
   * ② an active claimant on another tree of the same url → `task/another-active`.
   */
  assertTreeMutex(index: TaskTreeIndex, record: TaskRecord, sessionId: string | undefined): void {
    const root = requireTask(index.get(rootIdOf(record)))
    for (const row of index.subtree(root.id)) {
      if (row.status === 'taken' && row.claimedBy?.sessionId !== sessionId) {
        throw new TaskError(TaskErrorCode.AlreadyTaken,
          `task tree ${root.id} is already held by session ${row.claimedBy?.sessionId ?? 'unknown'} (task ${row.id})`)
      }
    }
    // 跨树：同 URL 上其它树（与本树根不同的整棵树）的活跃接取者
    // / cross-tree: active claimants on other trees of the same url (every tree
    // whose root differs from ours)
    const crossTree = index.all().find(row =>
      row.target.url === record.target.url && row.status === 'taken'
      && rootIdOf(row) !== root.id)
    if (crossTree !== undefined) {
      throw new TaskError(TaskErrorCode.AnotherActive,
        `another task tree (${crossTree.id}) is already active on ${record.target.url}`)
    }
  }

  /**
   * 拆分权限（§4.7.6）：调用会话必须是整棵树当前的唯一活跃接取者。
   * Split permission (§4.7.6): the calling session must be the tree's one
   * active claimant.
   */
  assertTreeClaimant(index: TaskTreeIndex, node: TaskRecord, sessionId: string): void {
    const root = requireTask(index.get(rootIdOf(node)))
    const holder = index.subtree(root.id).find(row => row.status === 'taken')
    if (holder === undefined || holder.claimedBy?.sessionId !== sessionId) {
      throw new TaskError(TaskErrorCode.NotClaimant,
        `task tree ${root.id} is not held by session ${sessionId}`)
    }
  }

  /**
   * 级联（§4.7.2 规则二）：一次子树查询取全部非终态后代，逐条迁移到目标终态，
   * 每条走自己的 CAS revision，取消理由写进每条记录的 failure。
   * Cascade (§4.7.2 rule 2): one subtree query for every non-terminal descendant,
   * migrate each to the target terminal status through its own CAS revision,
   * writing the reason into each row's failure.
   */
  async cascadeSubtree(
    domain: TaskCenterStore,
    ops: TaskOps,
    ancestor: TaskRecord,
    kind: CascadeKind | 'expired',
    reason: string,
  ): Promise<void> {
    const index = this.tasks(domain)
    for (const row of index.activeDescendants(ancestor.id)) {
      const status = cascadeStatusOf(row.status, kind)
      // claimedBy 是 readonly：用解构摘除该键，不用 as 断言 / destructure to drop the key, no cast
      const { claimedBy: _dropped, ...kept } = row
      const next: TaskRecord = {
        ...kept,
        status,
        failure: {
          code: TaskErrorCode.CascadeCancelled,
          message: `ancestor ${ancestor.id} ${kind}: ${reason}`,
        },
        revision: row.revision + 1,
        updatedAt: new Date().toISOString(),
      }
      await this.save(domain, next)
      ops.host.emit('task-center/changed', { taskId: row.id, action: `cascaded:${status}` })
    }
  }

  /**
   * Lazy sweep: expire past-deadline opens (cascading into their subtrees),
   * recycle past-lease takens (§4.4, §7.5), and mark open/taken tasks of an
   * unregistered app `orphaned` together with their whole subtrees (§7.4,
   * §4.7.7 场景 8).
   * 懒清扫：过期到点的 open（并向子树级联）、回收过租的 taken（§4.4、§7.5），
   * 以及把注册表里已查不到应用的任务连同整棵子树标孤儿（§7.4、§4.7.7 场景 8）。
   */
  async sweep(domain: TaskCenterStore, ops: TaskOps): Promise<void> {
    const index = this.tasks(domain)
    const resolver = ops.appResolver()
    const now = Date.now()
    // 快照 id 后逐条取最新：级联会在遍历中途改写后代，避免拿旧对象回写。
    // Snapshot ids and re-read each row: the cascade rewrites descendants
    // mid-iteration, so never write back a stale object.
    for (const id of index.all().map(row => row.id)) {
      const row = index.get(id)
      if (row === undefined) continue
      if (await this.sweepOrphan(domain, ops, row, resolver)) continue
      await this.sweepExpiry(domain, ops, row, now)
    }
  }

  /**
   * 孤儿扫入（§7.4、§4.7.7 场景 8）：注册表里已查不到应用 → 本行连同整棵子树标
   * 孤儿。返回 true = 本行已处理，调用方跳过后续到期判定。
   * / Orphan sweep-in (§7.4, §4.7.7 scenario 8): an app the registry no longer
   * knows → orphan this row and its whole subtree. True = handled; the caller
   * skips the deadline checks.
   */
  private async sweepOrphan(
    domain: TaskCenterStore,
    ops: TaskOps,
    row: TaskRecord,
    resolver: AppResolver | undefined,
  ): Promise<boolean> {
    if ((row.status !== 'open' && row.status !== 'taken') || resolver === undefined) return false
    if (await resolver(row.appId) !== undefined) return false
    // claimedBy 是 readonly：用解构摘除该键，不用 as 断言 / destructure to drop the key, no cast
    const { claimedBy: _dropped, ...kept } = row
    const next: TaskRecord = { ...kept, status: 'orphaned', revision: row.revision + 1, updatedAt: new Date().toISOString() }
    await this.save(domain, next)
    await this.cascadeSubtree(domain, ops, next, 'orphaned', 'app uninstalled')
    ops.host.emit('task-center/changed', { taskId: row.id, action: 'orphaned' })
    return true
  }

  /**
   * 到期清扫（§4.4、§7.5）：到点的 open → expired 并向子树级联；过租的 taken → 回 open。
   * / Deadline sweep (§4.4, §7.5): a due open expires and cascades; a past-lease
   * taken returns to open.
   */
  private async sweepExpiry(domain: TaskCenterStore, ops: TaskOps, row: TaskRecord, now: number): Promise<void> {
    if (row.status === 'open' && isPast(row.expiresAt, now)) {
      const next: TaskRecord = { ...row, status: 'expired', revision: row.revision + 1, updatedAt: new Date().toISOString() }
      await this.save(domain, next)
      // 父过期 → 子树里 open 后代 expired、taken 后代 cancelled（§4.7.2 规则二）
      // / an expired parent expires open descendants and cancels taken ones
      await this.cascadeSubtree(domain, ops, next, 'expired', 'ancestor expired')
      ops.host.emit('task-center/changed', { taskId: row.id, action: 'expired' })
    } else if (row.status === 'taken' && isPast(row.claimedBy?.leaseUntil, now)) {
      // claimedBy 是 readonly：用解构摘除该键，不用 as 断言 / destructure to drop the key, no cast
      const { claimedBy: _dropped, ...kept } = row
      const next: TaskRecord = {
        ...kept, status: 'open', revision: row.revision + 1, updatedAt: new Date().toISOString(),
      }
      await this.save(domain, next)
      ops.host.emit('task-center/changed', { taskId: row.id, action: 'lease-expired' })
    }
  }
}
