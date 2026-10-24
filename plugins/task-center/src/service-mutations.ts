/**
 * Task mutations segment: take (lease with tree mutex), release, complete,
 * fail, and cancel (with subtree cascade).
 *
 * Take is CAS on revision with a lease; release and cancel destructure away the
 * readonly `claimedBy` instead of casting. Completion refuses while the subtree
 * still has a non-terminal descendant — a result must be written by the
 * subtask's own claimant; failing and cascading keep the subtree's facts.
 *
 * 任务迁移段：接取（带树级互斥的租约）、释放、完成、失败与取消（含子树级联）。
 *
 * 接取是对 revision 的 CAS 并写租约；释放与取消用解构摘除 readonly 的 `claimedBy`，不做断言。
 * 完成时子树仍有非终态后代就拒绝——结果必须由子任务自己的接取者写；失败与级联保留子树事实。
 *
 * @module @veren/task-center/service-mutations
 */

import { TaskError, TERMINAL_STATUSES } from './tree.ts'
import { TaskErrorCode } from './types.ts'
import type {
  TaskCenterContract, TaskFailure, TaskId, TaskRecord, TaskResult,
} from './types.ts'
import { isPast } from './service-storage.ts'
import type { TaskOps } from './service-tree.ts'
import { requireTask } from './service-tree.ts'

/** The claim this session presents; spelled through the contract's take face. */
type TakeClaim = Parameters<TaskCenterContract['take']>[1]

/**
 * 接取是 CAS（比较 revision）；写租约 / take is CAS on revision with a lease.
 * 已被懒过期判定翻成 expired 的任务不可接取；续租（同一接取者幂等续约）或首次接取。
 */
export async function takeTask(ops: TaskOps, id: TaskId, claim: TakeClaim): Promise<TaskRecord> {
  return ops.storage.write(async (domain) => {
    await ops.tree.sweep(domain, ops)
    const index = ops.tree.tasks(domain)
    const record = requireTask(index.get(id))
    const sameClaimant = record.status === 'taken' && record.claimedBy !== undefined
      && record.claimedBy.actor === claim.actor && record.claimedBy.sessionId === claim.sessionId
    if (record.status === 'taken' && !sameClaimant && !isPast(record.claimedBy?.leaseUntil, Date.now())) {
      throw new TaskError(TaskErrorCode.AlreadyTaken, `task ${id} is taken until ${record.claimedBy?.leaseUntil}`)
    }
    if (record.status === 'orphaned') {
      throw new TaskError(TaskErrorCode.Orphaned, `task ${id} belongs to an uninstalled app`)
    }
    // 已被懒过期判定翻成 expired 的任务不可接取 / a lazily expired task is not claimable
    if (record.status === 'expired') {
      throw new TaskError(TaskErrorCode.Expired, `task ${id} expired at ${record.expiresAt}`)
    }
    // 续租（同一接取者幂等续约）或首次接取；其余状态不可接取 / renew (idempotent) or first take
    if (record.status !== 'open' && !sameClaimant) {
      throw new TaskError(TaskErrorCode.InvalidState, `task ${id} is ${record.status}, not claimable`)
    }
    if (!sameClaimant) ops.tree.assertTreeMutex(index, record, claim.sessionId)
    const next: TaskRecord = {
      ...record,
      status: 'taken',
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
      claimedBy: { sessionId: claim.sessionId, actor: claim.actor, leaseUntil: claim.leaseUntil },
    }
    await ops.tree.save(domain, next)
    ops.host.emit('task-center/changed', { taskId: id, action: sameClaimant ? 'renewed' : 'taken' })
    return next
  })
}

/** Release one taken task back to open, dropping its claim. */
export async function releaseTask(ops: TaskOps, id: TaskId, reason: string): Promise<TaskRecord> {
  return ops.storage.write(async (domain) => {
    await ops.tree.sweep(domain, ops)
    const index = ops.tree.tasks(domain)
    const record = requireTask(index.get(id))
    if (record.status !== 'taken') {
      throw new TaskError(TaskErrorCode.InvalidState, `task ${id} is ${record.status}; only taken tasks can be released`)
    }
    // claimedBy 是 readonly：用解构摘除该键，不用 as 断言 / destructure to drop the key, no cast
    const { claimedBy: _dropped, ...kept } = record
    const next: TaskRecord = {
      ...kept,
      status: 'open',
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
    }
    await ops.tree.save(domain, next)
    ops.host.emit('task-center/changed', { taskId: id, action: `released:${reason}` })
    return next
  })
}

/**
 * 幂等：重复 complete 返回当前结果 / idempotent completion. §4.7.2 规则一：子树里还有
 * 非终态后代就拒绝（不级联完成——结果必须由子任务自己的接取者写）。
 */
export async function completeTask(ops: TaskOps, id: TaskId, result: TaskResult): Promise<TaskRecord> {
  return ops.storage.write(async (domain) => {
    await ops.tree.sweep(domain, ops)
    const index = ops.tree.tasks(domain)
    const record = requireTask(index.get(id))
    if (record.status === 'done') return record
    if (record.status !== 'taken') {
      throw new TaskError(TaskErrorCode.InvalidState, `task ${id} is ${record.status}; only taken tasks can complete`)
    }
    if (result.summary.trim().length === 0) {
      throw new TaskError(TaskErrorCode.DraftInvalid, 'result.summary is required')
    }
    // §4.7.2 规则一：子树里还有非终态后代就拒绝（不级联完成——结果必须由子任务自己的
    // 接取者写）。校验走 ancestorIds 索引，一次子树查询。
    // §4.7.2 rule 1: refuse while the subtree has a non-terminal descendant (no
    // cascade-complete — a result must be written by the subtask's own claimant).
    // One subtree query over the ancestorIds index.
    const activeChild = index.activeDescendants(id)[0]
    if (activeChild !== undefined) {
      throw new TaskError(TaskErrorCode.ChildrenActive,
        `subtree of ${id} still has non-terminal descendant ${activeChild.id} (${activeChild.status}); resolve descendants first`)
    }
    const sessionId = record.claimedBy?.sessionId
    const next: TaskRecord = {
      ...record,
      status: 'done',
      result: {
        summary: result.summary,
        ...(result.artifacts === undefined ? {} : { artifacts: result.artifacts }),
      },
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
    }
    await ops.tree.save(domain, next)
    ops.host.emit('task-center/completed', {
      taskId: id, appId: record.appId, result: next.result ?? result, sessionId,
    })
    return next
  })
}

/** Mark one taken task failed; failing does not cascade (§4.7.2 rule 2). */
export async function failTask(ops: TaskOps, id: TaskId, failure: TaskFailure): Promise<TaskRecord> {
  return ops.storage.write(async (domain) => {
    await ops.tree.sweep(domain, ops)
    const index = ops.tree.tasks(domain)
    const record = requireTask(index.get(id))
    if (record.status === 'failed') return record
    if (record.status !== 'taken') {
      throw new TaskError(TaskErrorCode.InvalidState, `task ${id} is ${record.status}; only taken tasks can fail`)
    }
    // §4.7.2 规则二：failed 不级联——失败是接取者自己的判断，子树事实保留。
    // §4.7.2 rule 2: failing does not cascade — the claimant's own judgement;
    // the subtree's facts are preserved.
    const next: TaskRecord = {
      ...record,
      status: 'failed',
      failure,
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
    }
    await ops.tree.save(domain, next)
    ops.host.emit('task-center/changed', { taskId: id, action: `failed:${failure.code}` })
    return next
  })
}

/** Withdraw an open task; cancelling the parent cascades the whole subtree. */
export async function cancelTask(ops: TaskOps, id: TaskId, reason: string): Promise<TaskRecord> {
  return ops.storage.write(async (domain) => {
    await ops.tree.sweep(domain, ops)
    const index = ops.tree.tasks(domain)
    const record = requireTask(index.get(id))
    if (TERMINAL_STATUSES.has(record.status)) {
      throw new TaskError(TaskErrorCode.InvalidState, `task ${id} is already ${record.status}`)
    }
    if (record.status === 'taken') {
      throw new TaskError(TaskErrorCode.InvalidState, `task ${id} is taken; release it before cancelling`)
    }
    const next: TaskRecord = {
      ...record,
      status: 'cancelled',
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
    }
    await ops.tree.save(domain, next)
    // §4.7.2 规则二：父取消 → 整棵子树一次子树查询后逐条级联取消。
    // §4.7.2 rule 2: cancelling the parent cascades the whole subtree —
    // one subtree query, then row by row.
    await ops.tree.cascadeSubtree(domain, ops, next, 'cancelled', reason)
    ops.host.emit('task-center/changed', { taskId: id, action: `cancelled:${reason}` })
    return next
  })
}
