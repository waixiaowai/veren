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
 * The lossless-JSON union, spelled locally because a view must be provably
 * compatible with it at this boundary rather than by assertion. The canonical
 * union lives in `@deepseek-ai/dsh-util-values` as an object literal type, which
 * cannot be re-opened through an interface; this recursive member is the
 * structural equivalent the projection below maps onto.
 * 无损 JSON 联合，本地写出，因为视图必须在此边界上可证明地兼容它，而不是靠断言。规范联合在
 * `@deepseek-ai/dsh-util-values` 中以对象字面量类型给出，无法通过 interface 再打开；下面投影
 * 映射到的就是这个结构等价的递归成员。
 */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined }

/**
 * A view as the plain, mutable JSON a Tool result carries.
 *
 * Optional members stay optional and every array becomes mutable, because the
 * declared output schema infers exactly that. Recursion terminates on the
 * {@link Json} union, which already contains itself.
 * 视图作为 Tool 结果所携带的、可变的一般 JSON。可选成员保持可选，数组一律变为可变，因为声明
 * 的输出 schema 推导出的正是这样。递归在已经包含自身的 {@link Json} 联合处结束。
 */
export type JsonShape<T> = T extends readonly (infer Item)[]
  ? JsonShape<Item>[]
  : T extends object
    ? { [K in keyof T]: JsonShape<T[K]> }
    : T extends Json
      ? T
      : never

/**
 * Project a view onto the lossless-JSON value a Tool result carries.
 *
 * The view interfaces are readonly and highly structured; the tool registry's
 * canonical result is plain, mutable JSON. A serialize-and-parse pass performs
 * exactly that projection, and it is where a value that cannot survive a JSON
 * round trip surfaces instead of silently reaching the model.
 * 视图接口是只读且高度结构化的；工具注册表的规范结果是可变的一般 JSON。序列化再解析正好完成
 * 这一步投影，无法经受 JSON 往返的值也在这里暴露，而不是悄悄送到模型面前。
 * @param value - the view or list of views to project.
 * @returns the same data as canonical JSON.
 */
export function jsonOf<T>(value: T): JsonShape<T> {
  return JSON.parse(JSON.stringify(value)) as JsonShape<T>
}

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
    + 'Read them with forum_inbox before replying to the user.'
}

/**
 * Flatten a comment tree back to the ids it contains, depth first.
 * @param nodes - the tree roots.
 * @returns every id in the tree, parents before their replies.
 */
export function flattenCommentIds(nodes: readonly CommentNodeView[]): readonly string[] {
  return nodes.flatMap(node => [node.id, ...flattenCommentIds(node.replies)])
}
