/**
 * Task lifecycle segment: send, subtask creation, reads, and the app-orphan
 * sweep-in, plus the draft validation and the sender check they share.
 *
 * A task targets the canonical URL only; session attribution is the page
 * runtime's job. Completion and failure are idempotent elsewhere; this segment
 * creates and reads.
 *
 * 任务生命周期段：send、子任务创建、读取与应用孤儿扫入，外加它们共用的草稿校验与发送方校验。
 *
 * 任务目标只存规范 URL；会话归属由页面运行时解析。幂等的 complete/fail 在终态段；本段负责
 * 创建与读取。
 *
 * @module @veren/task-center/service-tasks
 */

import { view } from './storage.ts'
import type { DeliveryRecord, TaskCenterStore } from './storage.ts'
import { TaskError, TERMINAL_STATUSES, checkSubtreeLimits, rootIdOf, treePathOf } from './tree.ts'
import type { TaskTreeIndex } from './tree.ts'
import { TaskErrorCode } from './types.ts'
import type { TaskDraft, TaskId, TaskQuery, TaskRecord } from './types.ts'
import { newId, newTaskId } from './service-storage.ts'
import type { TaskOps } from './service-tree.ts'
import { requireTask } from './service-tree.ts'

/** Title limit (§4.2) / 标题长度上限 */
export const MAX_TITLE_CHARS = 200
/** Body limit; the full body belongs to the app's own storage. / 正文上限；完整正文放应用自己的存储 */
export const MAX_BODY_CHARS = 4000

/** Send one task: sweep first, dedup by idempotency key, then check the sender. */
export async function sendTask(ops: TaskOps, draft: TaskDraft): Promise<TaskRecord> {
  return ops.storage.write(async (domain) => {
    await ops.tree.sweep(domain, ops)
    validateDraft(draft)
    const seen = idempotentDuplicateOf(ops, domain, draft)
    if (seen !== undefined) return seen
    await checkSender(ops, draft.target.appId)
    const snapshot = await ops.appResolver()?.(draft.target.appId)
    const record = rootRecordOf(draft, snapshot?.version ?? 'unknown')
    await ops.tree.save(domain, record)
    await deliverRoot(ops, domain, record)
    return record
  })
}

/** 幂等键查重：同应用同键的既有记录原样返回（§4.2 去重）/ the idempotency-key dedup: an existing same-app same-key record returns unchanged. */
function idempotentDuplicateOf(ops: TaskOps, domain: TaskCenterStore, draft: TaskDraft): TaskRecord | undefined {
  if (draft.idempotencyKey === undefined) return undefined
  return ops.tree.tasks(domain).all().find(row =>
    row.appId === draft.target.appId && row.idempotencyKey === draft.idempotencyKey)
}

/** 组装根任务记录（v2：所有记录带树字段；send 只创建根任务）/ assemble the root record (v2: tree fields on every record; send creates roots only). */
function rootRecordOf(draft: TaskDraft, appVersion: string): TaskRecord {
  const now = new Date().toISOString()
  return {
    id: newTaskId(),
    appId: draft.target.appId,
    kind: draft.kind,
    title: draft.title.trim(),
    ...(draft.body === undefined ? {} : { body: draft.body }),
    target: draft.target,
    appVersion,
    assignee: 'local',
    status: 'open',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    ...(draft.dueAt === undefined ? {} : { dueAt: draft.dueAt }),
    ...(draft.expiresAt === undefined ? {} : { expiresAt: draft.expiresAt }),
    ...(draft.origin === undefined ? {} : { origin: draft.origin }),
    ...(draft.idempotencyKey === undefined ? {} : { idempotencyKey: draft.idempotencyKey }),
    ancestorIds: [],
    schemaVersion: 2,
  }
}

/** 根任务的收件箱投递行 + changed 事件（§4.7.5：收件箱只出现根任务）/ the root's inbox delivery row + changed event (§4.7.5: the inbox shows roots only). */
async function deliverRoot(ops: TaskOps, domain: TaskCenterStore, record: TaskRecord): Promise<void> {
  const delivery: DeliveryRecord = {
    id: newId('notice'),
    taskId: record.id,
    recipient: 'local',
    mode: 'inbox',
    state: 'pending',
    attempts: 0,
    createdAt: record.createdAt,
  }
  await view(domain.table('deliveries')).put(delivery.id, delivery)
  ops.host.emit('task-center/changed', { taskId: record.id, action: 'sent' })
}

/**
 * 在 `parentId` 下新建一条子任务（§4.7.6）。校验顺序：父存在且未终结 →
 * 调用会话确为整树唯一活跃接取者（可选）→ target.url 与父一致 → 三条安全上限。
 * 子任务只落任务表，不产生投递行（§4.7.5：收件箱只出现根任务）。
 * / Create one subtask under `parentId` (§4.7.6). Order of checks: parent
 * exists and is non-terminal → the calling session is the tree's one active
 * claimant (optional) → target.url equals the parent's → the three safety
 * limits. A subtask only lands in the task table; it never creates a
 * delivery row (§4.7.5: the inbox shows roots only).
 */
export async function createSubtask(
  ops: TaskOps,
  parentId: TaskId,
  draft: TaskDraft,
  opts: { readonly claimantSessionId?: string } = {},
): Promise<TaskRecord> {
  return ops.storage.write(async (domain) => {
    await ops.tree.sweep(domain, ops)
    const index = ops.tree.tasks(domain)
    const parent = requireOpenParent(index, parentId)
    if (opts.claimantSessionId !== undefined) ops.tree.assertTreeClaimant(index, parent, opts.claimantSessionId)
    validateDraft(draft)
    assertSubtaskTarget(parent, draft)
    const root = requireTask(index.get(rootIdOf(parent)))
    checkSubtreeLimits(parent, index.directChildren(parent.id).length, index.subtree(root.id).length)
    const record = subtaskRecordOf(parentId, parent, draft)
    await ops.tree.save(domain, record)
    ops.host.emit('task-center/changed', { taskId: record.id, action: 'subtask-added' })
    return record
  })
}

/** 父任务存在且未终结（§4.7.6 的前两条校验）/ the parent exists and is non-terminal (§4.7.6's first two checks). */
function requireOpenParent(index: TaskTreeIndex, parentId: TaskId): TaskRecord {
  const parent = index.get(parentId)
  if (parent === undefined) {
    throw new TaskError(TaskErrorCode.ParentGone, `parent task ${parentId} does not exist`)
  }
  if (TERMINAL_STATUSES.has(parent.status)) {
    throw new TaskError(TaskErrorCode.InvalidState,
      `parent task ${parentId} is ${parent.status}; subtasks attach to non-terminal parents only`)
  }
  return parent
}

/** 子任务 target.url 必须与父一致（§4.7.6）/ the subtask's target.url must equal the parent's (§4.7.6). */
function assertSubtaskTarget(parent: TaskRecord, draft: TaskDraft): void {
  if (draft.target.url !== parent.target.url) {
    throw new TaskError(TaskErrorCode.SubtaskTargetMismatch,
      `subtask target ${draft.target.url} must equal the parent target ${parent.target.url}`)
  }
}

/** 组装子任务记录：父指针只在这里写一次，ancestorIds = 父的树路径，随创建定型（§4.7.1）。
 * / Assemble the subtask record: the parent pointer is written once here;
 * ancestorIds = the parent's tree path, fixed at creation (§4.7.1). */
function subtaskRecordOf(parentId: TaskId, parent: TaskRecord, draft: TaskDraft): TaskRecord {
  const now = new Date().toISOString()
  return {
    id: newTaskId(),
    appId: draft.target.appId,
    kind: draft.kind,
    title: draft.title.trim(),
    ...(draft.body === undefined ? {} : { body: draft.body }),
    target: draft.target,
    appVersion: parent.appVersion,
    assignee: 'local',
    status: 'open',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    ...(draft.dueAt === undefined ? {} : { dueAt: draft.dueAt }),
    ...(draft.expiresAt === undefined ? {} : { expiresAt: draft.expiresAt }),
    ...(draft.origin === undefined ? {} : { origin: draft.origin }),
    ...(draft.idempotencyKey === undefined ? {} : { idempotencyKey: draft.idempotencyKey }),
    parentId,
    ancestorIds: treePathOf(parent),
    schemaVersion: 2,
  }
}

/** List tasks by the query filters, after a lazy sweep. */
export async function listTasks(ops: TaskOps, query: TaskQuery): Promise<readonly TaskRecord[]> {
  return ops.storage.write(async (domain) => {
    await ops.tree.sweep(domain, ops)
    return ops.tree.tasks(domain).all().filter(row =>
      (query.appId === undefined || row.appId === query.appId)
      && (query.status === undefined || row.status === query.status)
      && (query.assignee === undefined || row.assignee === query.assignee)
      && (query.claimedBySession === undefined || row.claimedBy?.sessionId === query.claimedBySession))
  })
}

/** Read one task by id, after a lazy sweep. */
export async function getTask(ops: TaskOps, id: TaskId): Promise<TaskRecord | undefined> {
  return ops.storage.write(async (domain) => {
    await ops.tree.sweep(domain, ops)
    return ops.tree.tasks(domain).get(id)
  })
}

/**
 * Uninstall semantics (§7.4): mark every open/taken task of `appId`
 * `orphaned` — records are kept, never deleted. Disable needs no storage
 * action: `send` is refused via the resolver and leases recycle lazily.
 * 卸载语义（§7.4）：该应用的 open/taken 任务全部标 `orphaned`——只保留，不删除。禁用不需要
 * 存储动作：send 走 resolver 拒绝，租约懒回收。
 */
export async function orphanAppTasks(ops: TaskOps, appId: string, reason: string): Promise<readonly TaskRecord[]> {
  return ops.storage.write(async (domain) => {
    const index = ops.tree.tasks(domain)
    const now = new Date().toISOString()
    const changed: TaskRecord[] = []
    // 整树口径（§4.7.7 场景 8）：一棵树共享同一个 target/appId，所以遍历到的每个
    // 非终态节点就是完整的树；每条仍走自己的 CAS revision。
    // Whole-tree semantics (§4.7.7 scenario 8): a tree shares one target/appId,
    // so every non-terminal node visited is the complete set; each row still
    // moves through its own CAS revision.
    for (const row of index.all()) {
      if (row.appId !== appId || (row.status !== 'open' && row.status !== 'taken')) continue
      // claimedBy 是 readonly：用解构摘除该键，不用 as 断言 / destructure to drop the key, no cast
      const { claimedBy: _dropped, ...kept } = row
      const next: TaskRecord = { ...kept, status: 'orphaned', revision: row.revision + 1, updatedAt: now }
      await ops.tree.save(domain, next)
      changed.push(next)
    }
    ops.host.emit('task-center/changed', {
      taskId: changed[0]?.id ?? ('' as TaskId),
      action: `orphaned:${reason}`,
    })
    return changed
  })
}

/** Validate title, body, target, and the optional instants of one draft. */
function validateDraft(draft: TaskDraft): void {
  const title = draft.title.trim()
  if (title.length === 0 || title.length > MAX_TITLE_CHARS) {
    throw new TaskError(TaskErrorCode.DraftInvalid, `title must be 1..${MAX_TITLE_CHARS} chars`)
  }
  if (draft.body !== undefined && draft.body.length > MAX_BODY_CHARS) {
    throw new TaskError(TaskErrorCode.DraftInvalid, `body exceeds ${MAX_BODY_CHARS} chars`)
  }
  const { url, appId, page } = draft.target
  if (url.length === 0 || appId.length === 0 || page.length === 0) {
    throw new TaskError(TaskErrorCode.DraftInvalid, 'target.url/appId/page are required')
  }
  for (const key of ['expiresAt', 'dueAt'] as const) {
    const value = draft[key]
    if (value === undefined) continue
    if (Number.isNaN(Date.parse(value))) {
      throw new TaskError(TaskErrorCode.DraftInvalid, `${key} is not a valid ISO instant`)
    }
  }
  if (draft.expiresAt !== undefined && Date.parse(draft.expiresAt) <= Date.now()) {
    throw new TaskError(TaskErrorCode.DraftInvalid, 'expiresAt must be in the future')
  }
}

/** Sender check via the lazily wired resolver; without a resolver we only warn. */
async function checkSender(ops: TaskOps, appId: string): Promise<void> {
  const resolver = ops.appResolver()
  if (resolver === undefined) {
    ops.host.logger.warn(`taskCenter: no app resolver wired; sender "${appId}" accepted without registry check`)
    return
  }
  const snapshot = await resolver(appId)
  if (snapshot === undefined) {
    throw new TaskError(TaskErrorCode.SendForbidden, `app "${appId}" is not registered`)
  }
  if (snapshot.state !== 'active') {
    throw new TaskError(TaskErrorCode.SendForbidden, `app "${appId}" is ${snapshot.state}`)
  }
}
