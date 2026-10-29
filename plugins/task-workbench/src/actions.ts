/**
 * 工具动作体：共享助手 + 页面作用域动作（get_page_task / take_page_task /
 * split_task）。队列动作在 actions-queue.ts（单一职责：本文件只管"本页那条"）。
 * Tool-action bodies: shared helpers plus the page-scoped actions
 * (get_page_task / take_page_task / split_task). Queue actions live in
 * actions-queue.ts (single responsibility: this file owns "this page's task").
 *
 * 写动作的统一前置是同意门（§2）：先切片同意、再 drive 台账、后范围覆盖；
 * 互斥权威在任务中心租约（§4.4），本文件的门槛只管"谁授权的这一轮"。
 * Every write action is fronted by the consent gate (§2): slice consent, then
 * the drive ledger, then scope cover. The mutex authority is the task center's
 * lease (§4.4); this file's gate only answers "who authorized this turn".
 * @module @veren/task-workbench
 */
import type { PageParams } from '@veren/prompt-page'
import type { TaskId, TaskRecord } from '@veren/task-center'
import { gateWrite } from './consent.ts'
import type { ConsentBook, DriveLedger } from './consent.ts'
import { itemKeyOf, subtreeProgressLabel } from './strategy.ts'
import type { TaskChannel } from './channel.ts'
import type { PageTaskScope, ToolCallContext, ToolOutcome } from './types.ts'
import type { TaskStore } from './store.ts'

/** 页面作用域接取缺省租约时长（与 task-center 全局工具同口径）/ the default lease span (same as the center's global tools) */
export const LEASE_MINUTES = 30

/** 详情页 URL / the detail-page url for one task */
export function detailUrl(params: PageParams): string {
  return `/apps/task-workbench/task/${String(params.taskId ?? '')}`
}

/** 校验 task_id 参数 / validate the task_id argument */
export function requireTaskId(args: { task_id?: string }): string {
  const id = args?.task_id
  if (typeof id !== 'string' || id.length === 0) throw new Error('[task-workbench] task_id is required')
  return id
}

/** 把本地校验结果翻成 ToolOutcome / map a local verdict to a ToolOutcome */
export function outcomeOf(outcome: 'ok' | 'not-found' | 'bad-state', detail?: string): ToolOutcome {
  if (outcome === 'ok') return { ok: true }
  return outcome === 'not-found'
    ? { ok: false, code: 'task-not-found', detail: detail ?? 'no such task' }
    : { ok: false, code: 'bad-task-state', detail: detail ?? 'task is not in the required state' }
}

/** 通用 pending 卡片 / the generic pending card */
export function presentTaskCall(title: string, args?: unknown): { card: 'generic'; title: string; kind: 'other'; rawInput?: unknown } {
  return { card: 'generic' as const, title, kind: 'other' as const, ...(args === undefined ? {} : { rawInput: args }) }
}

/** 租约到期时刻 / the lease deadline */
export function leaseAhead(): string {
  return new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString()
}

/** 会话 id（工具执行上下文里的接取者身份）/ the session id (the claimant identity) */
export function sessionIdOf(exec: ToolCallContext): string | undefined {
  return exec.agent?.session?.id as string | undefined
}

/** 页面作用域拒绝（稳定 code，模型能推出下一步：这不是能接任务的那一页）/ the page-scope refusal */
export function pageScopeRefusal(detail: string): ToolOutcome {
  return { ok: false, code: 'page-task-unresolvable', detail }
}

/**
 * 只读读取本页那条（get_page_task 动作体）：中心优先——按目标 URL 找根记录，
 * 返回记录字段 + 中心子树进度；没有中心记录时如实返回 not-found。
 * The page-scoped read (get_page_task's body): center-first — find the root
 * record by target url, return its fields plus the center subtree progress;
 * no record renders as an honest not-found.
 */
export async function getPageTask(
  channel: TaskChannel,
  scope: PageTaskScope,
  exec: ToolCallContext,
): Promise<ToolOutcome | Record<string, unknown>> {
  const sessionId = sessionIdOf(exec)
  if (sessionId === undefined) return pageScopeRefusal('the tool ran outside any page session')
  const page = await scope.liveDetailTaskOf(sessionId)
  if (page === undefined) return pageScopeRefusal('the calling session is not a live task-workbench detail page')
  const record = await channel.findByTarget(page.url)
  if (record === undefined) return { ok: false, code: 'task-not-found', detail: 'no task-center record targets this page' }
  const records = await channel.list()
  return {
    ok: true,
    task: {
      id: record.id,
      workOrderId: itemKeyOf(record),
      title: record.title,
      status: record.status,
      ...(record.claimedBy?.sessionId === undefined ? {} : { ownerId: record.claimedBy.sessionId }),
      progress: subtreeProgressLabel(records, record.id),
    },
    subtree: records
      .filter((entry) => entry.ancestorIds.includes(record.id))
      .map((entry) => ({ id: entry.id, title: entry.title, status: entry.status, depth: entry.ancestorIds.length })),
  }
}

/**
 * 页面作用域接取（take_page_task 动作体）：同意门 → 解析"本页那条"→ 先问
 * 任务中心（互斥权威在租约，§4.4）→ 同步投影 → 接 30 分钟租约。
 * The page-scoped take (take_page_task's body): the consent gate → resolve
 * "this page's task" → consult the center first (the mutex authority is the
 * lease, §4.4) → sync the projection → lease for 30 minutes.
 */
export async function takePageTask(
  store: TaskStore,
  channel: TaskChannel,
  scope: PageTaskScope,
  book: ConsentBook,
  ledger: DriveLedger,
  exec: ToolCallContext,
): Promise<ToolOutcome> {
  const sessionId = sessionIdOf(exec)
  if (sessionId === undefined) return pageScopeRefusal('the tool ran outside any page session')
  const page = await scope.liveDetailTaskOf(sessionId)
  if (page === undefined) return pageScopeRefusal('the calling session is not a live task-workbench detail page')
  // 同意门在解析出具体任务之后跑：投递同意按记录 id 收窄（§2）
  // / the gate runs after the concrete task is resolved: delivery consent narrows by record id (§2)
  const record = await channel.findByTarget(page.url)
  const gated = gateWrite(book, ledger, exec.agent, record?.id, 'take_page_task')
  if (gated !== undefined) return gated
  // 先问任务中心：被别的会话持有着就原样拒绝，不动投影 / ask the center first:
  // refuse verbatim when another session holds it, never touching the projection
  if (record !== undefined && record.status === 'taken' && record.claimedBy?.sessionId !== sessionId) {
    return {
      ok: false,
      code: 'task/already-taken',
      detail: `task ${record.id} is held by session ${record.claimedBy?.sessionId ?? 'unknown'}`,
    }
  }
  if (record === undefined) {
    // 无中心记录的纯本地工作单：只动投影（权威缺席时互斥退化为本地）
    // / a pure-local order with no center record: projection only (the mutex degrades locally when the authority is absent)
    store.claimLocal(page.taskId, sessionId)
    return { ok: true, detail: 'local work order taken; no task-center record targets this page' }
  }
  // open → 首次接取；taken（到此必是本会话持有）→ 续租（§4.4：每次调任务工具续租）
  if (record.status === 'open' || record.status === 'taken') {
    const leased = await channel.take(record.id, { sessionId, leaseUntil: leaseAhead() })
    store.syncRecord(leased)
  }
  return { ok: true, detail: outcomeDetail(record) }
}

/** 成功详情如实区分三条路径 / the honest success detail across three paths */
function outcomeDetail(record: TaskRecord): string {
  if (record.status === 'open') return 'task taken and leased in the task center (30 min)'
  if (record.status === 'taken') return 'task-center lease renewed (30 min)'
  return `task-center record already ${record.status}`
}

/**
 * 拆分（split_task 动作体）：同意门 → 本地门槛（只有被接取的任务能拆）→
 * 任务中心建真正的子任务（target 继承受中心校验）→ 投影同步子任务行。
 * Split (split_task's body): the consent gate → the local gate (only a taken
 * order splits) → a real center subtask (target inheritance center-validated)
 * → the subtask row synced into the projection.
 */
export async function splitTask(
  store: TaskStore,
  channel: TaskChannel,
  book: ConsentBook,
  ledger: DriveLedger,
  exec: ToolCallContext,
  args: { task_id?: string; title?: string },
): Promise<ToolOutcome> {
  const workOrderId = requireTaskId({ task_id: args?.task_id })
  const title = typeof args?.title === 'string' ? args.title.trim() : ''
  if (title.length === 0) return { ok: false, code: 'draft-invalid', detail: 'title is required' }
  const records = await channel.list()
  const parent = records.find((record) => record.parentId === undefined && itemKeyOf(record) === workOrderId)
    ?? records.find((record) => record.id === workOrderId)
  if (parent === undefined) return outcomeOf('not-found')
  const gated = gateWrite(book, ledger, exec.agent, parent.id, 'split_task')
  if (gated !== undefined) return gated
  if (parent.status !== 'taken') return outcomeOf('bad-state', 'only a taken task can be split')
  const subtask = await channel.addSubtask(parent.id, title, { claimantSessionId: sessionIdOf(exec) })
  // 子任务行带父链（ancestorIds），整表重建是唯一不出错的投影路径
  // / a subtask row carries the parent chain; a whole-table rebuild is the one projection path that cannot err
  store.rebuildFrom(await channel.list())
  return { ok: true, detail: `subtask ${subtask.id} created under ${parent.id}` }
}
