/**
 * Comments: replies to posts, replies to replies, and the tree the panel shows.
 *
 * Depth is capped at two, which is what the reader asked for and what keeps the
 * tree readable: a top-level comment answers the post, and one more level
 * answers a comment. A reply aimed below that is refused rather than silently
 * flattened, so a writer always knows where its words landed.
 *
 * 评论：对帖子的回复、对回复的回复，以及面板展示的树。
 *
 * 层级限制为两层，这既是阅读者的要求，也让树保持可读：顶层评论回答帖子，再深一层回答
 * 评论。指向更深处的回复会被拒绝而不是被悄悄压平，因此写入方总能知道自己的话落在了哪里。
 *
 * @module @veren/forum/comments
 */

import { LONG_BODY_CHARS, extractMentions } from './domain.ts'
import type { CommentRecord } from './domain.ts'
import type { CreateCommentInput, SubjectCounters } from './types.ts'
import { ForumError } from './types.ts'
import type { CommentNodeView } from './types.ts'
import { mintId } from './ids.ts'
import type { ForumStore, ForumTables } from './storage.ts'
import { view } from './storage.ts'
import type { Tables } from './posts.ts'
import { requirePost } from './posts.ts'

/** Deepest accepted nesting: `1` answers the post, `2` answers a comment. */
export const MAX_COMMENT_DEPTH = 2

/** The comment table plus the post and board tables, ready to use. */
export interface CommentTables extends Tables {
  readonly comments: ReturnType<typeof view<CommentRecord>>
}

/**
 * Project the domain's comment table alongside the post tables.
 * @param domain - the opened forum domain.
 * @returns the board, post, and comment tables.
 */
export function commentTablesOf(domain: ForumStore): CommentTables {
  return {
    boards: view(domain.table('boards')),
    posts: view(domain.table('posts')),
    comments: view(domain.table('comments')),
  }
}

/**
 * Validate one comment body.
 * @param body - the caller-supplied text.
 * @returns the trimmed body.
 * @throws ForumError `input_invalid` when it is empty.
 */
export function validateComment(body: string): string {
  const trimmed = body.trim()
  if (trimmed === '') throw new ForumError('forum/input-invalid', 'a comment needs a body.')
  return trimmed
}

/**
 * Resolve the parent a comment answers and the depth that follows from it.
 * @param tables - the comment tables.
 * @param postId - the post the writer is replying inside.
 * @param parentCommentId - the comment being answered, when there is one.
 * @returns the stored parent identity and the new comment's depth.
 * @throws ForumError for a missing post, a missing parent, or a parent at the depth limit.
 */
export function resolveParent(
  tables: CommentTables, postId: string, parentCommentId: string | undefined,
): { readonly parentKind: 'post' | 'comment'; readonly parentId: string; readonly depth: number } {
  requirePost(tables, postId)
  if (parentCommentId === undefined) return { parentKind: 'post', parentId: postId, depth: 1 }
  const parent = tables.comments.get(parentCommentId)
  if (parent === undefined || parent.postId !== postId) {
    throw new ForumError('forum/comment-not-found', `no comment with id "${parentCommentId}" in post "${postId}".`)
  }
  const depth = parent.depth + 1
  if (depth > MAX_COMMENT_DEPTH) {
    throw new ForumError(
      'forum/comment-too-deep',
      `comments nest ${String(MAX_COMMENT_DEPTH)} levels deep; reply to the top-level comment instead.`,
    )
  }
  return { parentKind: 'comment', parentId: parent.id, depth }
}

/**
 * Build one comment record from resolved input.
 * @param input - the writer's request.
 * @param boardId - the board the post belongs to.
 * @param parent - the resolved parent identity and depth.
 * @param now - ISO instant stamped on the record.
 * @returns the comment record.
 */
export function buildComment(
  input: CreateCommentInput,
  boardId: string,
  parent: { readonly parentKind: 'post' | 'comment'; readonly parentId: string; readonly depth: number },
  now: string,
): CommentRecord {
  const body = validateComment(input.body)
  return {
    id: mintId('comment'),
    boardId,
    postId: input.postId,
    parentKind: parent.parentKind,
    parentId: parent.parentId,
    depth: parent.depth,
    author: input.author,
    body,
    mentions: extractMentions(body, input.author),
    createdAt: now,
  }
}

/**
 * Every comment of one post, oldest first.
 * @param tables - the comment tables.
 * @param postId - the post to read.
 * @returns the stored comments.
 */
export function commentsOf(tables: CommentTables, postId: string): readonly CommentRecord[] {
  return tables.comments.all()
    .filter(comment => comment.postId === postId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

/** Count the comments of one post. */
export function countComments(tables: CommentTables, postId: string): number {
  return commentsOf(tables, postId).length
}

/**
 * Resolve one stored comment, or refuse.
 * @param tables - the full forum tables (comments included).
 * @param commentId - the comment to find.
 * @returns the stored comment.
 * @throws ForumError `comment_not_found`.
 */
export function requireComment(tables: ForumTables, commentId: string): CommentRecord {
  const comment = tables.comments.get(commentId)
  if (comment === undefined) throw new ForumError('forum/comment-not-found', `no comment with id "${commentId}".`)
  return comment
}

/**
 * Build one comment node, with its vote counters attached and replies empty.
 * 构建一个评论节点：附上投票计数，回复先留空。
 * @param record - the stored comment.
 * @param replies - the node's direct replies (empty until they are attached).
 * @param counters - supplies the comment's vote counters.
 * @returns the view node.
 */
function toCommentNode(
  record: CommentRecord,
  replies: readonly CommentNodeView[],
  counters: (comment: CommentRecord) => SubjectCounters,
): CommentNodeView {
  const counts = counters(record)
  return {
    id: record.id,
    postId: record.postId,
    parentId: record.parentId,
    parentKind: record.parentKind,
    depth: record.depth,
    author: record.author,
    body: record.body,
    mentions: record.mentions,
    foldable: record.body.length > LONG_BODY_CHARS,
    createdAt: record.createdAt,
    up: counts.up,
    down: counts.down,
    ...counts.myVote === undefined ? {} : { myVote: counts.myVote },
    replies,
  }
}

/**
 * Attach every reply to its root, dropping replies whose parent is absent.
 *
 * Every node is built before any is attached, so a reply whose parent is
 * missing can be dropped instead of inventing a place for it: the tree must
 * show what was written, and inventing a parent would misreport the
 * conversation.
 * 把每条回复挂到根评论，父评论缺失的回复直接丢弃——所有节点先构建后挂接，树只呈现真实
 * 写下的话，凭空补一个父评论会错报对话。
 * @param nodes - every comment of one post as flat nodes.
 * @returns the depth-1 nodes, each carrying its direct replies.
 */
function attachReplies(nodes: readonly CommentNodeView[]): readonly CommentNodeView[] {
  const byId = new Map(nodes.map(item => [item.id, item]))
  const roots: CommentNodeView[] = []
  const replies = new Map<string, CommentNodeView[]>()
  for (const item of nodes) {
    if (item.parentKind === 'post') {
      roots.push(item)
      continue
    }
    if (!byId.has(item.parentId)) continue
    const siblings = replies.get(item.parentId) ?? []
    siblings.push(item)
    replies.set(item.parentId, siblings)
  }
  return roots.map(root => ({ ...root, replies: replies.get(root.id) ?? [] }))
}

/**
 * Fold one flat comment list into the two-level tree the panel renders.
 * @param records - one post's comments, oldest first.
 * @param counters - supplies each comment's vote counters.
 * @returns the depth-1 nodes, each carrying its direct replies.
 */
export function buildTree(
  records: readonly CommentRecord[],
  counters: (comment: CommentRecord) => SubjectCounters,
): readonly CommentNodeView[] {
  const nodes = records.map(record => toCommentNode(record, [], counters))
  return attachReplies(nodes)
}
