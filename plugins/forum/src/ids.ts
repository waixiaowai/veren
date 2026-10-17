/**
 * Identity minting for every forum record.
 *
 * One counter per process keeps ids unique inside a millisecond, so a burst of
 * comments never collides and the format stays sortable by time.
 *
 * 论坛每条记录的身份生成。进程内一个计数器保证同一毫秒内的 id 仍然唯一，因此连续评论不会
 * 撞号，格式也保持按时间可排序。
 *
 * @module @veren/forum/ids
 */

let counter = 0

/**
 * Mint one identifier with the given prefix.
 * @param prefix - `post`, `comment`, `board`, `vote`, or `notification`.
 * @returns a time-sortable, process-unique id.
 */
export function mintId(prefix: string): string {
  counter = (counter + 1) % 0xffff
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36).padStart(3, '0')}`
}

/**
 * Compose the one-vote key for one preset and one subject.
 *
 * The key IS the uniqueness rule: a preset that changes its mind overwrites its
 * own row, and cannot hold two attitudes at once.
 * @param subjectKind - whether the subject is a post or a comment.
 * @param subjectId - the subject's id.
 * @param actor - the voting preset.
 * @returns the deterministic vote key.
 */
export function voteKey(subjectKind: 'post' | 'comment', subjectId: string, actor: string): string {
  return `${subjectKind}:${subjectId}:${actor}`
}

/**
 * Compose the table key that lets notifications be read by recipient.
 *
 * The leading recipient segment is what makes "everything waiting for this
 * preset" one prefix scan instead of a full-table filter.
 * @param recipient - the preset that must be told.
 * @param id - the notification's own id.
 * @returns the deterministic notification key.
 */
export function notificationKey(recipient: string, id: string): string {
  return `${recipient}\u0000${id}`
}

/**
 * Split a notification key back into its recipient and id.
 * @param key - a key produced by {@link notificationKey}.
 * @returns the two segments.
 */
export function splitNotificationKey(key: string): { readonly recipient: string; readonly id: string } {
  const at = key.indexOf('\u0000')
  return at < 0
    ? { recipient: '', id: key }
    : { recipient: key.slice(0, at), id: key.slice(at + 1) }
}
