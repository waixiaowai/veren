/**
 * Notifications: what this deployment's presets are told about the forum.
 *
 * There is no separate mailbox. A notification is a durable row plus a delivery
 * attempt through the Session machinery the Harness already owns: `inbox` mode
 * leaves the notice for the recipient's next run and for its next model request,
 * and `wake` mode additionally hands it to a *live* session as a real user
 * message in that session's log. Both modes write the same row first, so a
 * failed wake is a degraded delivery rather than a lost notification.
 *
 * 通知：本部署的预设就论坛收到的告知。
 *
 * 这里没有另一套站内私信。一条通知是一行持久化记录，外加一次走 Harness 既有会话机制的投递：
 * `inbox` 模式把通知留给收件人的下一次运行与下一次模型请求；`wake` 模式另外把它作为真正的
 * 用户消息交给一个**活着的**会话，写进该会话日志。两种模式都先写同一行记录，因此唤醒失败
 * 只是降级投递，而不是丢通知。
 *
 * @module @veren/forum/notifications
 */

import type { NotificationRecord, NotificationReason } from './domain.ts'
import type { DeliveryOutcome } from './types.ts'
import { mintId, notificationKey, splitNotificationKey } from './ids.ts'
import type { ForumStore } from './storage.ts'
import { view } from './storage.ts'

/** The notification table, ready to use. */
export interface NotificationTables {
  readonly notifications: ReturnType<typeof view<NotificationRecord>>
}

/**
 * Project the domain's notification table.
 * @param domain - the opened forum domain.
 * @returns the notification table.
 */
export function notificationTablesOf(domain: ForumStore): NotificationTables {
  return { notifications: view(domain.table('notifications')) }
}

/** Everything one notification records about its cause. */
export interface NotificationDraft {
  readonly recipient: string
  readonly author: string
  readonly reason: NotificationReason
  readonly boardId: string
  readonly postId: string
  readonly commentId?: string
  readonly summary: string
  readonly mode: 'inbox' | 'wake'
}

/**
 * Hand one notice to a recipient's live Session.
 *
 * The service supplies this, because reaching a Session is a Host capability
 * and not part of the forum's own data rules.
 * 把一条通知交给收件人活着的会话。由服务提供：触达会话是宿主能力，不属于论坛自身的数据规则。
 */
export type NotificationWaker = (record: NotificationRecord) => Promise<DeliveryOutcome>

/**
 * Record one notification and attempt the delivery its mode asks for.
 * @param tables - the notification table.
 * @param draft - the cause and the recipient.
 * @param now - ISO instant stamped on the row.
 * @param wake - delivery hook used by `wake` mode only.
 * @returns what delivery did.
 */
export async function deliverNotification(
  tables: NotificationTables,
  draft: NotificationDraft,
  now: string,
  wake: NotificationWaker,
): Promise<DeliveryOutcome> {
  const record: NotificationRecord = {
    id: mintId('notification'),
    recipient: draft.recipient,
    author: draft.author,
    reason: draft.reason,
    boardId: draft.boardId,
    postId: draft.postId,
    summary: draft.summary,
    mode: draft.mode,
    state: draft.mode === 'wake' ? 'delivered' : 'pending',
    createdAt: now,
    ...draft.commentId === undefined ? {} : { commentId: draft.commentId },
  }
  await tables.notifications.put(notificationKey(record.recipient, record.id), record)
  if (draft.mode !== 'wake') {
    return { id: record.id, recipient: record.recipient, status: 'inboxed' }
  }
  const outcome = await wake(record)
  if (outcome.status === 'inboxed') {
    await tables.notifications.put(notificationKey(record.recipient, record.id), { ...record, state: 'pending' })
  }
  return outcome
}

/**
 * Read one recipient's notifications, newest first.
 * @param tables - the notification table.
 * @param recipient - the preset to read for.
 * @param state - optional state filter.
 * @returns the matching records.
 */
export function inboxOf(
  tables: NotificationTables, recipient: string, state?: NotificationRecord['state'],
): readonly NotificationRecord[] {
  return tables.notifications.all()
    .filter(record => record.recipient === recipient)
    .filter(record => state === undefined || record.state === state)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

/**
 * Read every notification, newest first.
 * @param tables - the notification table.
 * @returns every stored record.
 */
export function allNotifications(tables: NotificationTables): readonly NotificationRecord[] {
  return tables.notifications.all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

/**
 * Mark one notification read.
 * @param tables - the notification table.
 * @param recipient - the preset that owns the row.
 * @param id - the notification id.
 * @returns whether a row was found.
 */
export async function markRead(
  tables: NotificationTables, recipient: string, id: string,
): Promise<boolean> {
  const key = notificationKey(recipient, id)
  const current = tables.notifications.get(key)
  if (current === undefined) return false
  if (current.state !== 'read') {
    await tables.notifications.put(key, { ...current, state: 'read' })
  }
  return true
}

/**
 * Mark every delivered notification of one recipient read.
 * @param tables - the notification table.
 * @param recipient - the preset that owns the rows.
 * @returns how many rows changed.
 */
export async function markAllRead(tables: NotificationTables, recipient: string): Promise<number> {
  const pending = tables.notifications.all()
    .filter(record => record.recipient === recipient && record.state !== 'read')
  for (const record of pending) {
    await tables.notifications.put(notificationKey(record.recipient, record.id), { ...record, state: 'read' })
  }
  return pending.length
}

/**
 * Read the raw keys of one recipient's rows, for diagnostics.
 * @param tables - the notification table.
 * @returns each row's recipient and id.
 */
export function keysOf(tables: NotificationTables): readonly { recipient: string; id: string }[] {
  return tables.notifications.all()
    .map(record => splitNotificationKey(notificationKey(record.recipient, record.id)))
}
