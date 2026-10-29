/**
 * 队列动作体（docs/task-workbench-modes-dispatch §3/§5）：盘点（策略视图）、
 * 接取/完成/放弃（中心优先）、发布（target 来自注册表目录）、退回/改派
 * （requeue 两步一致性）、导航（openUrl 正门）。写动作全部过同意门。
 * Queue action bodies (§3/§5 of the design doc): the strategy-view inventory,
 * center-first take/complete/release, publish (the target from the registry
 * catalog), return/re-file (requeue's two-step consistency), and navigation
 * (the openUrl front door). Every write goes through the consent gate.
 * @module @veren/task-workbench
 */
import type { AppRecord } from '@veren/app-registry'
import type { PageInstanceKey } from '@veren/prompt-page'
import { patternParamsOf } from '@veren/prompt-page'
import type { TaskDraft, TaskRecord } from '@veren/task-center'
import { gateWrite } from './consent.ts'
import type { ConsentBook, DriveLedger } from './consent.ts'
import { activeRecordOf, catalogRows, itemKeyOf, strategyView, WORKBENCH_KEY_PREFIX } from './strategy.ts'
import { leaseAhead, outcomeOf, requireTaskId, sessionIdOf } from './actions.ts'
import type { TaskChannel } from './channel.ts'
import type { ToolCallContext, ToolOutcome } from './types.ts'
import type { TaskStore } from './store.ts'

/** 导航端口（pageRegistry.openUrl 的最小面）/ the navigation port (openUrl's minimal face) */
export interface OpenUrlPort {
  openUrl(url: string, options?: { readonly taskId?: string; readonly callerSessionId?: string }): Promise<{
    readonly sessionId: string
    readonly url: string
    readonly title: string
  }>
}

/** 队列动作共享的端口 / the ports the queue actions share */
export interface QueuePorts {
  readonly store: TaskStore
  readonly channel: TaskChannel
  readonly book: ConsentBook
  readonly ledger: DriveLedger
  /** 注册表目录快照（发布/改派 target 校验 + 跨应用地图）/ the registry catalog snapshot (target validation + the cross-app map) */
  readonly catalog: () => readonly AppRecord[]
  readonly openUrl: OpenUrlPort['openUrl']
}

/**
 * 解析一个 task_id 引用（单一事实源 = 中心记录集，不走可能陈旧的投影）：
 * 先按工作单 id 匹配根记录，再按记录 id 直配；顺手刷新投影。
 * Resolve a task_id reference (the single fact source is the center's record
 * set, never a possibly-stale projection): match roots by work-order id first,
 * then by record id; refreshes the projection in passing.
 */
export async function resolveTaskRef(
  ports: Pick<QueuePorts, 'store' | 'channel'>,
  taskId: string,
): Promise<{ readonly item: string; readonly record: TaskRecord } | undefined> {
  const records = await ports.channel.list()
  ports.store.rebuildFrom(records)
  // 按工作单 id 聚齐根记录后取活跃载体（与策略视图同口径），再按记录 id 直配
  // / gather the work order's roots and take the active vehicle (the strategy
  // view's own rule), then a direct record-id match
  const roots = records.filter((entry) => entry.parentId === undefined && itemKeyOf(entry) === taskId)
  const record = roots.length > 0
    ? activeRecordOf(roots)
    : records.find((entry) => entry.id === taskId)
      ?? records.find((entry) => `wb-${entry.id}` === taskId)
  if (record === undefined) return undefined
  return { item: itemKeyOf(record), record }
}

/** 盘点（list_tasks 动作体）：策略视图 + 跨应用目录行 + 闭集计数。零改动。 */
export function listTasksView(ports: Pick<QueuePorts, 'store' | 'channel' | 'catalog'>, records: readonly TaskRecord[]): Record<string, unknown> {
  const view = strategyView(records)
  ports.store.rebuildFrom(records)
  return {
    ok: true,
    counts: view.counts,
    rows: view.rows,
    catalog: catalogRows(ports.catalog(), records),
  }
}

/** 接取（take_task 动作体）：门 → 中心 CAS 接取 → 投影同步。 */
export async function takeTaskAction(ports: QueuePorts, exec: ToolCallContext, args: { task_id?: string }): Promise<ToolOutcome> {
  const taskId = requireTaskId(args)
  const ref = await resolveTaskRef(ports, taskId)
  if (ref === undefined) return outcomeOf('not-found')
  const gated = gateWrite(ports.book, ports.ledger, exec.agent, ref.record.id, 'take_task')
  if (gated !== undefined) return gated
  if (ref.record.status !== 'open' && ref.record.status !== 'taken') {
    return outcomeOf('bad-state', `task is ${ref.record.status}, not claimable`)
  }
  const sessionId = sessionIdOf(exec)
  if (sessionId === undefined) return { ok: false, code: 'page-task-unresolvable', detail: 'the tool ran outside any page session' }
  const leased = await ports.channel.take(ref.record.id, { sessionId, leaseUntil: leaseAhead() })
  ports.store.syncRecord(leased)
  return { ok: true, detail: `task ${leased.id} taken (lease 30 min)` }
}

/** 完成（complete_task 动作体）：门 → 接取者校验 → 中心 complete（子树非终态后代由中心拒绝）。 */
export async function completeTaskAction(
  ports: QueuePorts,
  exec: ToolCallContext,
  args: { task_id?: string; summary?: string },
): Promise<ToolOutcome> {
  const taskId = requireTaskId(args)
  const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
  if (summary.length === 0) return { ok: false, code: 'draft-invalid', detail: 'summary is required' }
  const ref = await resolveTaskRef(ports, taskId)
  if (ref === undefined) return outcomeOf('not-found')
  const gated = gateWrite(ports.book, ports.ledger, exec.agent, ref.record.id, 'complete_task')
  if (gated !== undefined) return gated
  // 本地前置守卫：只有 taken 能完成（结构化拒绝；中心的 children-active 仍 fail loud）
  // / the local pre-guard: taken only (a structured refusal; the center's
  // children-active still fails loud)
  if (ref.record.status !== 'taken') return outcomeOf('bad-state', `task is ${ref.record.status}; only taken tasks can complete`)
  const done = await ports.channel.completeAsClaimant(ref.record.id, { summary }, sessionIdOf(exec))
  ports.store.syncRecord(done)
  return { ok: true, detail: `task ${done.id} done: ${summary}` }
}

/** 放弃（abandon_task 动作体）：门 → 接取者校验 → 中心 release（回 open 队列）。 */
export async function abandonTaskAction(ports: QueuePorts, exec: ToolCallContext, args: { task_id?: string }): Promise<ToolOutcome> {
  const taskId = requireTaskId(args)
  const ref = await resolveTaskRef(ports, taskId)
  if (ref === undefined) return outcomeOf('not-found')
  const gated = gateWrite(ports.book, ports.ledger, exec.agent, ref.record.id, 'abandon_task')
  if (gated !== undefined) return gated
  if (ref.record.status !== 'taken') return outcomeOf('bad-state', `task is ${ref.record.status}; only taken tasks can be released`)
  const released = await ports.channel.releaseAsClaimant(ref.record.id, 'abandoned by the claimant', sessionIdOf(exec))
  ports.store.syncRecord(released)
  return { ok: true, detail: `task ${released.id} released back to open` }
}

/** 派发/发布目标（注册表目录校验）：page 缺省 = entry；带 :param 的显式页拒绝。 */
export function dispatchTargetOf(
  catalog: readonly AppRecord[],
  args: { target_app?: string; page?: string },
  selfUrl: string,
): { readonly url: string; readonly appId: string; readonly page: string; readonly params: Record<string, string> } | ToolOutcome {
  const appId = args.target_app ?? 'task-workbench'
  if (appId === 'task-workbench') {
    return { url: selfUrl, appId, page: 'detail', params: {} }
  }
  const app = catalog.find((record) => record.definition.id === appId)
  if (app === undefined || app.state !== 'active') {
    return { ok: false, code: 'dispatch/target-invalid', detail: `app "${appId}" is not an active app in the registry` }
  }
  const pageKey = args.page ?? app.definition.entry
  const page = app.pages?.get(pageKey)
  if (page === undefined) {
    return { ok: false, code: 'dispatch/target-invalid', detail: `app "${appId}" has no page "${pageKey}"` }
  }
  if (patternParamsOf(page.url).length > 0) {
    return { ok: false, code: 'dispatch/target-invalid', detail: `page "${appId}/${pageKey}" carries :params; the workbench does not invent other apps' params` }
  }
  return { url: page.url, appId, page: pageKey, params: {} }
}

/** 发布（publish_task 动作体）：门 → 目录校验 → 中心 send（幂等键内嵌工作单 id）→ 投影。 */
export async function publishTaskAction(
  ports: QueuePorts,
  exec: ToolCallContext,
  args: { title?: string; body?: string; target_app?: string; page?: string },
): Promise<ToolOutcome> {
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (title.length === 0) return { ok: false, code: 'draft-invalid', detail: 'title is required' }
  const gated = gateWrite(ports.book, ports.ledger, exec.agent, undefined, 'publish_task')
  if (gated !== undefined) return gated
  ports.store.rebuildFrom(await ports.channel.list())
  const itemId = ports.store.nextItemId()
  const detailUrl = `/apps/task-workbench/task/${itemId}`
  const target = dispatchTargetOf(ports.catalog(), args, detailUrl)
  if ('ok' in target) return target
  const sessionId = sessionIdOf(exec)
  const record = await ports.channel.send({
    kind: 'task-workbench/publish' as TaskDraft['kind'],
    title,
    ...(typeof args.body === 'string' && args.body.length > 0 ? { body: args.body } : {}),
    target: {
      url: target.url as PageInstanceKey,
      appId: target.appId,
      page: target.page,
      params: target.appId === 'task-workbench' ? { taskId: itemId } : target.params,
    },
    idempotencyKey: `${WORKBENCH_KEY_PREFIX}${itemId}/${target.appId}-a1`,
    ...(sessionId === undefined ? {} : { origin: { sessionId } }),
  })
  ports.store.syncRecord(record)
  return { ok: true, detail: `task ${record.id} published at ${target.appId} (work order ${itemId})` }
}

/**
 * 退回/改派（requeue_task 动作体，§3.3 两步一致性）：returned/open 的载体才
 * 合法；先 send 新记录再 cancel 旧 open 载体——失败整步无副作用。
 * Return/re-file (requeue_task's body, §3.3): only a returned/open vehicle
 * qualifies; send the new record FIRST, then cancel the old open vehicle — any
 * failure leaves zero side effects.
 */
export async function requeueTaskAction(
  ports: QueuePorts,
  exec: ToolCallContext,
  args: { task_id?: string; target_app?: string; page?: string },
): Promise<ToolOutcome> {
  const taskId = requireTaskId(args)
  const ref = await resolveTaskRef(ports, taskId)
  if (ref === undefined) return outcomeOf('not-found')
  const gated = gateWrite(ports.book, ports.ledger, exec.agent, ref.record.id, 'requeue_task')
  if (gated !== undefined) return gated
  const lane = ref.record.status
  if (lane !== 'failed' && lane !== 'orphaned' && lane !== 'open') {
    return { ok: false, code: 'queue/not-returnable', detail: `task is ${lane}; only failed/orphaned/open orders can be requeued` }
  }
  if (lane === 'open' && ref.record.target.appId !== 'task-workbench') {
    // 改派在途派发单：接取者已在干的单子不许从下面抽走 / re-filing an in-flight
    // dispatch: an order someone is working must not be yanked away
    return { ok: false, code: 'dispatch/conflict', detail: 'the dispatched order is still open at the target; cancel it there first' }
  }
  const itemId = ref.item
  const detailUrl = `/apps/task-workbench/task/${itemId}`
  const target = dispatchTargetOf(ports.catalog(), args, detailUrl)
  if ('ok' in target) return target
  const sessionId = sessionIdOf(exec)
  const record = await ports.channel.send({
    kind: ref.record.kind,
    title: ref.record.title,
    ...(ref.record.body === undefined ? {} : { body: ref.record.body }),
    target: {
      url: target.url as PageInstanceKey,
      appId: target.appId,
      page: target.page,
      params: target.appId === 'task-workbench' ? { taskId: itemId } : target.params,
    },
    idempotencyKey: `${WORKBENCH_KEY_PREFIX}${itemId}/${target.appId}-a${Date.now().toString(36)}`,
    ...(sessionId === undefined ? {} : { origin: { sessionId } }),
  })
  if (lane === 'open') {
    await ports.channel.cancel(ref.record.id, `requeued as ${record.id}`)
      .catch(() => undefined)
  }
  ports.store.syncRecord(record)
  return { ok: true, detail: `work order ${itemId} requeued as ${record.id} at ${target.appId}` }
}

/** 导航（open_task_page 动作体）：门 → openUrl 正门（taskId 接取 + 自开守卫在宿主侧）。 */
export async function openTaskPageAction(
  ports: Pick<QueuePorts, 'channel' | 'book' | 'ledger' | 'openUrl' | 'store'>,
  exec: ToolCallContext,
  args: { task_id?: string },
): Promise<ToolOutcome> {
  const taskId = requireTaskId(args)
  const ref = await resolveTaskRef(ports, taskId)
  if (ref === undefined) return outcomeOf('not-found')
  const gated = gateWrite(ports.book, ports.ledger, exec.agent, ref.record.id, 'open_task_page')
  if (gated !== undefined) return gated
  const callerSessionId = sessionIdOf(exec)
  const receipt = await ports.openUrl(ref.record.target.url, {
    taskId: ref.record.id,
    ...(callerSessionId === undefined ? {} : { callerSessionId }),
  })
  return { ok: true, detail: `opened ${receipt.url} as session ${receipt.sessionId} (${receipt.title}); the page session takes the task` }
}
