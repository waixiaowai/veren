/**
 * 工具动作实现（app.ts 的工具定义只声明，动作体都在这里）。
 * Tool-action bodies (the definitions in app.ts declare; the bodies live here).
 *
 * 本文件的重点是 {@link takePageTask}：详情页的页面作用域接取（§3.10.1 把
 * "接取"划给详情页；§5.3 的闭环在"投递 → 详情页接取"这一步断裂过——详情页
 * 曾按矩阵没有接取工具，任务落 failed/task-not-taken）。接取的形态不是把
 * 带参 take_task 加回来：URL 里已有 taskId（§3.10.3 参数进上下文），接取被
 * {@link PageTaskScope} 天然限定在"本页那条"，模型没有可伪造的任意 id 参数；
 * 防抢由任务中心的 CAS + 租约承担（§4.4），不是矩阵的职责。
 * The centerpiece is {@link takePageTask}: the detail page's page-scoped take
 * (§3.10.1 assigns "take" to the detail archetype; the §5.3 loop once broke at
 * "delivered → the detail page takes it" because the matrix gave the page no
 * take tool and the task landed failed/task-not-taken). The form is NOT the
 * parametered take_task re-added: the url already carries the taskId (§3.10.3),
 * so {@link PageTaskScope} naturally scopes the take to "this page's task" and
 * the model has no forgeable arbitrary-id parameter; anti-contention belongs to
 * the task center's CAS + lease (§4.4), never to the tool matrix.
 * @module @veren/task-workbench
 */
import type { TaskDraft, TaskRecord, TaskId } from '@veren/task-center'
import type { PageParams } from '@veren/prompt-page'
import type { TaskChannel } from './app.ts'
import type { TaskStore } from './store.ts'
import type { PageTaskScope, ToolCallContext, ToolOutcome } from './types.ts'

/** 页面作用域接取缺省租约时长（与 task-center 全局工具同口径）/ the default lease span (same as task-center's global tools) */
const LEASE_MINUTES = 30

/** 详情页 URL / the detail-page url for one task */
export function detailUrl(params: PageParams): string {
  return `/apps/task-workbench/task/${String(params.taskId ?? '')}`
}

/** 入口 URL（应用下拉 / 任务通知共用）/ the entry url */
export function entryUrlOf(pages: readonly { name: string; url: string }[], entry: string): string | undefined {
  return pages.find((page) => page.name === entry)?.url
}

/** 校验 task_id 参数 / validate the task_id argument */
export function requireTaskId(args: { task_id?: string }): string {
  const id = args?.task_id
  if (typeof id !== 'string' || id.length === 0) throw new Error('[task-workbench] task_id is required')
  return id
}

/** 把 store 迁移结果翻成 ToolOutcome / map a Transition to a ToolOutcome */
export async function runGuarded(run: () => 'ok' | 'not-found' | 'bad-state'): Promise<ToolOutcome> {
  const outcome = run()
  if (outcome === 'ok') return { ok: true }
  return outcome === 'not-found'
    ? { ok: false, code: 'task-not-found', detail: 'no such task' }
    : { ok: false, code: 'bad-task-state', detail: 'task is not in the required state' }
}

/** 通用 pending 卡片 / the generic pending card */
export function presentTaskCall(title: string, args?: unknown): { card: 'generic'; title: string; kind: 'other'; rawInput?: unknown } {
  return { card: 'generic' as const, title, kind: 'other' as const, ...(args === undefined ? {} : { rawInput: args }) }
}

/** 拆分：本地 store 记树形事实，任务中心同步建真正的子任务 / split: local facts plus a real subtask */
export async function splitTask(
  store: TaskStore,
  channel: TaskChannel,
  args: { task_id?: string; title?: string },
  exec: ToolCallContext,
): Promise<ToolOutcome> {
  const parentId = requireTaskId({ task_id: args?.task_id })
  const title = typeof args?.title === 'string' ? args.title.trim() : ''
  if (title.length === 0) return { ok: false, code: 'draft-invalid', detail: 'title is required' }
  // 本地门槛：只有被接取的节点能拆（工具跑在接取者页面会话里，即树级互斥下的唯一活跃者）
  // / local gate: only a taken node splits (the tool runs in the claimant's page
  // session — the tree mutex's one active claimant)
  const local = store.splitTask(parentId, title)
  if (local.outcome !== 'ok') {
    return local.outcome === 'not-found'
      ? { ok: false, code: 'task-not-found', detail: 'no such task' }
      : { ok: false, code: 'bad-task-state', detail: 'only a taken task can be split' }
  }
  // 任务中心是硬 inject：addSubtask 失败（上限/互斥等）原样抛给工具执行器。
  // taskCenter is a hard inject: addSubtask failures (limits, mutex) propagate
  // to the tool executor.
  await channel.addSubtask(parentId, title, {
    claimantSessionId: exec.agent?.session?.id,
  })
  return { ok: true }
}

/** 发布：先落本地列表，再投递任务中心；失败原样抛出（fail loud）/ publish locally then forward; failures propagate */
export async function publishTask(store: TaskStore, channel: TaskChannel, args: { title: string }): Promise<ToolOutcome> {
  const title = typeof args?.title === 'string' ? args.title.trim() : ''
  if (title.length === 0) return { ok: false, code: 'draft-invalid', detail: 'title is required' }
  const item = store.publishLocal(title)
  await channel.send({
    kind: 'task-workbench/publish' as TaskDraft['kind'],
    title,
    target: {
      url: detailUrl({ taskId: item.id }) as TaskDraft['target']['url'],
      appId: 'task-workbench',
      page: 'detail',
      params: { taskId: item.id },
    },
  })
  return { ok: true }
}

/**
 * 页面作用域接取（take_page_task 的动作体）：解析"本页那条"→ 先问任务中心
 * （互斥权威在租约，§4.4）→ 同步本地投影 → open 记录接 30 分钟租约。
 * The page-scoped take (take_page_task's body): resolve "this page's task" →
 * consult the task center first (the mutex authority is the lease, §4.4) →
 * sync the local projection → lease an open record for 30 minutes.
 */
export async function takePageTask(
  store: TaskStore,
  channel: TaskChannel,
  scope: PageTaskScope,
  exec: ToolCallContext,
): Promise<ToolOutcome> {
  const sessionId = exec.agent?.session?.id
  if (sessionId === undefined) return pageScopeRefusal('the tool ran outside any page session')
  // 页面作用域的唯一事实：本会话在详情页上绑定的那条实例（无需、也不收参数）
  // / the one page-scope fact: the detail instance this session is bound to
  // (no parameter needed, none accepted)
  const page = await scope.liveDetailTaskOf(sessionId)
  if (page === undefined) return pageScopeRefusal('the calling session is not a live task-workbench detail page')
  // 先问任务中心：被别的会话持有着就原样拒绝，不动本地投影 / ask the task
  // center first: refuse verbatim when another session holds it
  const record = await channel.findByTarget(page.url)
  if (record !== undefined && record.status === 'taken' && record.claimedBy?.sessionId !== sessionId) {
    return {
      ok: false,
      code: 'task/already-taken',
      detail: `task ${record.id} is held by session ${record.claimedBy?.sessionId ?? 'unknown'}`,
    }
  }
  const local = claimLocal(store, page.taskId, sessionId)
  if (local !== undefined) return local
  // open → 首次接取；taken（到此必是本会话持有）→ 续租（§4.4：每次调任务工具续租）
  // / open → first take; taken (by this session only, others refused above) → renew
  // the lease (§4.4: every task-tool call renews it)
  if (record !== undefined && (record.status === 'open' || record.status === 'taken')) {
    await channel.take(record.id, { sessionId, leaseUntil: leaseAhead() })
  }
  return { ok: true, detail: outcomeDetail(record) }
}

/** 本地投影同步到 taken（幂等）；本地没有这条（外部投来的 id）→ 只走任务中心 */
function claimLocal(store: TaskStore, taskId: string, sessionId: string): ToolOutcome | undefined {
  if (!store.getState().some((entry) => entry.id === taskId)) return undefined
  const claimed = store.claimTask(taskId, sessionId)
  return claimed === 'ok'
    ? undefined
    : { ok: false, code: 'bad-task-state', detail: 'task is already done' }
}

/** 页面作用域拒绝（稳定 code，模型能推出下一步：这不是能接任务的那一页）/ the page-scope refusal */
function pageScopeRefusal(detail: string): ToolOutcome {
  return { ok: false, code: 'page-task-unresolvable', detail }
}

/** 租约到期时刻 / the lease deadline */
function leaseAhead(): string {
  return new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString()
}

/** 成功详情如实区分三条路径 / the honest success detail across three paths */
function outcomeDetail(record: TaskRecord | undefined): string {
  if (record === undefined) return 'local task taken; no task-center record targets this page'
  if (record.status === 'open') return 'task taken locally and leased in the task center (30 min)'
  if (record.status === 'taken') return 'task-center lease renewed (30 min); local projection synced'
  return `task-center record already ${record.status}; local projection synced`
}
