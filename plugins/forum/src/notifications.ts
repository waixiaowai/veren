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

import type { CommentRecord, NotificationRecord, NotificationReason, PostRecord } from './domain.ts'
import type { DeliveryOutcome } from './types.ts'
import { mintId, notificationKey } from './ids.ts'
import type { ForumStore, ForumTables } from './storage.ts'
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
 * Mark one notification, or a recipient's whole inbox, read.
 * @param tables - the notification table.
 * @param recipient - the preset that owns the rows.
 * @param id - the single notification id, ignored when `all` is set.
 * @param all - clear the whole inbox instead of one row.
 * @returns how many rows changed.
 */
export async function markInbox(
  tables: NotificationTables, recipient: string, id: string | undefined, all: boolean,
): Promise<number> {
  if (all) return markAllRead(tables, recipient)
  return (await markRead(tables, recipient, id ?? '')) ? 1 : 0
}

/**
 * Notify a post's parent author plus every mentioned preset.
 *
 * The parent's author is told once, as a reply; a preset that is both the
 * parent's author and mentioned gets the reply notice only, because two
 * notices for one write is noise.
 * 通知帖子的父级作者与每个被 @ 的预设。父级作者只收到一条回复通知；既是父级作者又被 @ 的
 * 预设只收到回复通知，因为一次写入两条通知只是噪音。
 * @param tables - every table the forum touches (the parent comment's author is read here).
 * @param post - the post the write belongs to.
 * @param comment - the comment that caused it, when there is one.
 * @param mentions - presets named with `@`.
 * @param mode - whether to wake a live session or leave the notice in the inbox.
 * @param now - the service clock; each notice is stamped as it is attempted.
 * @param wake - delivery hook used by `wake` mode only.
 * @returns one outcome per notice attempted.
 */
export async function announce(
  tables: ForumTables,
  post: PostRecord,
  comment: CommentRecord | undefined,
  mentions: readonly string[],
  mode: 'inbox' | 'wake',
  now: () => string,
  wake: NotificationWaker,
): Promise<readonly DeliveryOutcome[]> {
  const author = comment?.author ?? post.author
  const targets = new Map<string, 'reply' | 'mention'>()
  if (comment !== undefined) {
    const parentAuthor = comment.parentKind === 'comment'
      ? tables.comments.get(comment.parentId)?.author
      : post.author
    if (parentAuthor !== undefined && parentAuthor !== author) targets.set(parentAuthor, 'reply')
  }
  for (const name of mentions) if (!targets.has(name)) targets.set(name, 'mention')
  const outcomes: DeliveryOutcome[] = []
  for (const [recipient, reason] of targets) {
    outcomes.push(await deliverNotification(tables, {
      recipient,
      author,
      reason,
      boardId: post.boardId,
      postId: post.id,
      summary: `${author} ${reason === 'mention' ? 'mentioned you in' : 'answered you in'} "${post.title}"`,
      mode,
      ...comment === undefined ? {} : { commentId: comment.id },
    }, now(), wake))
  }
  return outcomes
}
