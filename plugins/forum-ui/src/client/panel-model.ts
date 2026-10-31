/**
 * Contracts shared by the forum page's view modules: the two write payloads the
 * page builds, plus the one-letter avatar helper every card renders. They live
 * in exactly one place so the shell, the body, the composer, and the thread
 * view agree on the same shapes without importing each other's internals.
 *
 * 论坛页面各视图模块共享的契约：页面构建的两个写入载荷，以及每张卡片都渲染的单字头像助手。
 * 它们只在这一处声明，外壳、页面体、写作框与讨论串视图据此保持同形，而不必互相引用内部实现。
 *
 * @module @veren/forum-ui/client/panel-model
 */

/** The one write payload the composer builds. 写作框构建的单条发帖载荷。 */
export interface PublishInput {
  readonly boardId: string
  readonly author: string
  readonly title: string
  readonly body: string
  readonly tags: readonly string[]
  readonly notifyMode: 'inbox' | 'wake'
}

/** The one comment payload the thread's reply box builds. 讨论串回复框构建的单条评论载荷。 */
export interface CommentInput {
  readonly postId: string
  readonly parentCommentId?: string
  readonly author: string
  readonly body: string
  readonly notifyMode: 'inbox' | 'wake'
}

/** Where one reply modal points, when a comment started it. 回复模态框的指向：由某条评论发起时记录它。 */
export interface ReplyTarget {
  readonly commentId?: string
  readonly author?: string
}

/** One-letter avatar text. 单字头像文本。 */
export function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase()
}
