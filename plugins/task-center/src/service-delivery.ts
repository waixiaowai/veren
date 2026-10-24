/**
 * Delivery segment: the inbox seam session C consumes. Returns every pending
 * notice whose task is still deliverable, each with the rendered inbox text;
 * notices whose task reached a terminal state flip to `read` here.
 *
 * A task's lifecycle status and a notice's delivery state are two independent
 * axes: a delivery failure is not a task failure, and delivery attempts are
 * counted, not judged.
 *
 * 投递段：会话 C 消费的收件箱接缝。返回所有仍可投递任务的 pending 通知（含渲染好的注入文本）；
 * 任务已到终态的通知在此翻成 `read`。
 *
 * 任务状态与通知投递状态是两条独立的轴：投递失败不是任务失败，投递只计数、不做评判。
 *
 * @module @veren/task-center/service-delivery
 */

import { view } from './storage.ts'
import type { DeliveryRecord, InboxNotice, TaskCenterStore } from './storage.ts'
import type { TaskId, TaskRecord } from './types.ts'
import type { TaskOps } from './service-tree.ts'
import { MAX_BODY_CHARS } from './service-tasks.ts'

/**
 * 投递接缝（会话 C 调这里）/ Delivery seam for session C.
 *
 * Returns every `pending` inbox notice whose task is still deliverable
 * (`open`/`taken`), each with the rendered inbox text to inject as a user
 * message on session start or the next pre-step. Notices whose task reached
 * `done`/`cancelled`/`expired` are flipped to `read` here (§4.5); `orphaned`
 * tasks stay `pending` but are no longer returned (不再投递).
 * 返回所有可投递的 pending 收件箱通知（含渲染好的注入文本），供 C 在会话启动或下一轮
 * pre-step 时作为用户消息注入。终态任务的通知在此翻成 `read`；`orphaned` 的保持 pending
 * 但不再返回。
 */
export async function collectPendingDeliveries(ops: TaskOps): Promise<readonly InboxNotice[]> {
  return ops.storage.write(async (domain: TaskCenterStore) => {
    await ops.tree.sweep(domain, ops)
    const index = ops.tree.tasks(domain)
    const deliveries = view(domain.table('deliveries'))
    const notices: InboxNotice[] = []
    for (const row of deliveries.all()) {
      if (row.state !== 'pending') continue
      const task = index.get(row.taskId as TaskId)
      if (task === undefined) continue
      // 收件箱只出现根任务（§4.7.5）；addSubtask 不写投递行，这里是防御性兜底。
      // The inbox shows roots only (§4.7.5); addSubtask writes no delivery row,
      // this skip is a defensive belt.
      if (task.parentId !== undefined) continue
      if (task.status === 'done' || task.status === 'cancelled' || task.status === 'expired') {
        await deliveries.put(row.id, { ...row, state: 'read', lastAt: new Date().toISOString() })
        continue
      }
      if (task.status !== 'open' && task.status !== 'taken') continue
      notices.push({ deliveryId: row.id, task, text: noticeText(task) })
    }
    return notices
  })
}

/**
 * Session C reports the outcome of one delivery attempt: success flips the
 * row to `delivered`; a failure keeps it `pending` with attempts + 1
 * (§4.5: 投递失败不等于任务失败).
 * 会话 C 回报一次投递的结果：成功翻 `delivered`；失败保持 `pending` 并把 attempts + 1。
 */
export async function markDelivered(
  ops: TaskOps,
  deliveryId: string,
  error?: string,
): Promise<DeliveryRecord | undefined> {
  return ops.storage.write(async (domain) => {
    const deliveries = view(domain.table('deliveries'))
    const row = deliveries.get(deliveryId)
    if (row === undefined) return undefined
    const now = new Date().toISOString()
    const next: DeliveryRecord = error === undefined
      ? { ...row, state: 'delivered', attempts: row.attempts + 1, lastAt: now }
      : { ...row, attempts: row.attempts + 1, lastAt: now, lastError: error }
    await deliveries.put(deliveryId, next)
    return next
  })
}

/** Render the model-facing inbox text for one task (§5.1 template). */
export function noticeText(task: TaskRecord): string {
  const lines = [
    `[task-center] ${task.title}`,
    `来源：${task.appId} · kind ${task.kind}`,
    `页面：${task.target.url}`,
    `参数：${JSON.stringify(task.target.params)}`,
    // 投递泵只把通知注进新建的页面会话（§5.2），而页面会话屏蔽 app_open——
    // 指引必须落在真实可用的工具上：本页即目标页就直接开工，否则 page_send 转投。
    // / The pump only injects notices into fresh page sessions (§5.2), which
    // mask app_open — the guidance must name tools that actually exist there:
    // work in place when this page is the target, else forward via page_send.
    '要求：接取用 task_take。目标 URL 就是本页时直接开工；不是本页时用 page_send 把该 URL 与任务要求投给对应页面会话'
      + '（页面会话里 app_open 不可用）。完成后调用 task_complete，失败调用 task_fail。',
  ]
  if (task.dueAt !== undefined) lines.push(`期限：${task.dueAt}`)
  if (task.body !== undefined) lines.push(`说明：${task.body.slice(0, MAX_BODY_CHARS)}`)
  return lines.join('\n')
}
