/**
 * Pure projections: stored forum rows to the views the panel and tools read.
 *
 * Nothing here touches Cordis, storage, or Sessions — each function takes rows
 * in and returns plain data, so the panel's rendering rules are unit-testable
 * without a running Host.
 *
 * 纯投影：论坛存储行到面板与工具所读视图。
 *
 * 这里不碰 Cordis、存储与会话——每个函数吃进数据行、吐出纯数据，因此面板的展示规则可以
 * 在没有宿主进程的情况下做单元测试。
 *
 * @module @veren/forum/views
 */

import type { NotificationRecord } from './domain.ts'
import type { CommentNodeView, NotificationView, PersonView } from './types.ts'

/**
 * 无损 JSON 联合与投影只有一份实现，位于 `@veren/core`；此处仅按原名转出，
 * 保持 `@veren/forum` 的既有公共面不变。
 * The lossless-JSON union and its projection live in one place only
 * (`@veren/core`); they are re-exported under their original names so the
 * `@veren/forum` public surface stays unchanged.
 */
export type { Json, JsonShape } from '@veren/core'
export { jsonOf } from '@veren/core'

/** Project one stored notification onto the panel's view. */
export function notificationView(record: NotificationRecord): NotificationView {
  return {
    id: record.id,
    recipient: record.recipient,
    author: record.author,
    reason: record.reason,
    boardId: record.boardId,
    postId: record.postId,
    summary: record.summary,
    state: record.state,
    createdAt: record.createdAt,
    ...record.commentId === undefined ? {} : { commentId: record.commentId },
  }
}

/**
 * Merge the presets the deployment declares with the presets that hold
 * auto-post rows, so a switched-off preset still appears in the panel.
 * @param declared - preset ids from the registry.
 * @param configured - preset names that have an auto-post row.
 * @returns one entry per preset, ordered by name.
 */
export function mergePeople(
  declared: readonly string[], configured: readonly string[],
): readonly PersonView[] {
  const autoPost = new Set(configured)
  return [...new Set([...declared, ...configured])]
    .sort()
    .map(name => ({ name, autoPost: autoPost.has(name) }))
}

/**
 * Render the one-line prompt context that announces unread notices.
 * @param preset - the preset the reading Session works for.
 * @param unread - how many notices wait in its inbox.
 * @returns the line, or `''` when there is nothing to say.
 */
export function inboxLine(preset: string | undefined, unread: number): string {
  if (preset === undefined || unread === 0) return ''
  return `Forum: ${String(unread)} unread forum notification(s) addressed to preset "${preset}". `
    + 'Read them with forum__inbox in a forum page session before replying to the user.'
}

/**
 * Flatten a comment tree back to the ids it contains, depth first.
 * @param nodes - the tree roots.
 * @returns every id in the tree, parents before their replies.
 */
export function flattenCommentIds(nodes: readonly CommentNodeView[]): readonly string[] {
  return nodes.flatMap(node => [node.id, ...flattenCommentIds(node.replies)])
}
