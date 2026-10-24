/**
 * The forum's use cases over one open domain: the read projections the panel
 * sees, and the write paths that guard, store, and notify.
 *
 * Every function here takes the open domain (or its projected tables) plus its
 * clock and wake hook as explicit parameters, so the Remote surface in
 * `./service.ts` stays a thin queue-and-transport shell and each rule stays
 * testable without a running service.
 *
 * 论坛在已打开域之上的用例层：面板所见的读取投影，以及先守卫、再落库、后通知的写入路径。
 *
 * 这里的每个函数都以打开的域（或其投影表）加时钟与唤醒钩子为显式参数，因此 `./service.ts`
 * 的远端面只剩排队与传输的薄壳，每条规则都可以在没有运行中服务的情况下测试。
 *
 * @module @veren/forum/operations
 */

import type { PostRecord } from './domain.ts'
import {
  buildComment, buildTree, commentTablesOf, commentsOf, countComments, resolveParent,
} from './comments.ts'
import {
  buildPost, listBoards, listPosts, listTags, postView, requireBoard, requirePost, validatePost,
} from './posts.ts'
import { counterLookup, voteTablesOf } from './votes.ts'
import { announce } from './notifications.ts'
import type { NotificationWaker } from './notifications.ts'
import type { ForumStore, ForumTables } from './storage.ts'
import { notificationTablesOf } from './notifications.ts'
import type {
  CatalogQuery, CatalogView, CreateCommentInput, CreatePostInput, PersonView,
  PostCounters, PostDetailView, PostView, WriteOutcome,
} from './types.ts'

/** Largest catalog page the panel ever receives. 面板单页目录的最大条数。 */
const HOT_LIMIT = 200

/** The clock and wake hook every write operation runs with. 写操作共用的时钟与唤醒钩子。 */
export interface WriteDeps {
  /** One ISO instant per read, from the service's single clock. 每次读取产生一个 ISO 时刻，来自服务的唯一时钟。 */
  readonly now: () => string
  /** Delivery hook used by `wake` mode notifications. `wake` 模式通知使用的投递钩子。 */
  readonly wake: NotificationWaker
}

/** Project every table the service touches. 投影服务会触达的全部表。 */
export function forumTablesOf(domain: ForumStore): ForumTables {
  return { ...commentTablesOf(domain), ...notificationTablesOf(domain) }
}

/** A post-counter lookup bound to one reading preset. 绑定到某个阅读预设的帖子计数查询。 */
export function countersOf(domain: ForumStore, reader?: string): (post: PostRecord) => PostCounters {
  const tables = forumTablesOf(domain)
  const lookup = counterLookup(voteTablesOf(domain), reader)
  return post => ({ ...lookup('post', post.id), commentCount: countComments(tables, post.id) })
}

/** Build one post's detail view. 构建一个帖子的详情视图。 */
export function detailOf(domain: ForumStore, post: PostRecord, reader?: string): PostDetailView {
  const tables = forumTablesOf(domain)
  const lookup = counterLookup(voteTablesOf(domain), reader)
  const records = commentsOf(tables, post.id)
  return {
    post: postView(post, { ...lookup('post', post.id), commentCount: records.length }, Date.now()),
    body: post.body,
    comments: buildTree(records, comment => lookup('comment', comment.id)),
  }
}

/** Build the catalog for one query. 为一次查询构建目录。 */
export function catalogOf(
  domain: ForumStore, request: CatalogQuery, people: readonly PersonView[],
): CatalogView {
  const tables = forumTablesOf(domain)
  const boardId = request.boardId ?? listBoards(tables)[0]?.id
  const posts = boardId === undefined
    ? []
    : listPosts(tables, boardId, countersOf(domain), {
      nowMs: Date.now(),
      ...request.query === undefined ? {} : { query: request.query },
      ...request.tag === undefined ? {} : { tag: request.tag },
      ...request.sort === undefined ? {} : { sort: request.sort },
    })
  return {
    boards: listBoards(tables),
    posts: posts.slice(0, HOT_LIMIT),
    people,
    ...boardId === undefined ? {} : { boardId },
  }
}

/** Every tag in use across every board. 所有板块用到的全部标签。 */
export function tagsOf(tables: ForumTables): readonly string[] {
  const tags = new Set<string>()
  for (const board of listBoards(tables)) for (const tag of listTags(tables, board.id)) tags.add(tag)
  return [...tags].sort()
}

/**
 * Read one post, counting one view.
 * @param domain - the opened forum domain.
 * @param postId - the post to open.
 * @param reader - the reading preset, for its own vote attitude.
 * @param now - the service clock, stamping the view bump.
 * @returns the post, its body, and its comment tree.
 */
export async function openPost(
  domain: ForumStore, postId: string, reader: string | undefined, now: () => string,
): Promise<PostDetailView> {
  const tables = forumTablesOf(domain)
  const post = requirePost(tables, postId)
  const bumped: PostRecord = { ...post, views: post.views + 1, updatedAt: now() }
  await tables.posts.put(bumped.id, bumped)
  return detailOf(domain, bumped, reader)
}

/**
 * Publish one post, then notify the presets it mentions.
 * @param domain - the opened forum domain.
 * @param request - board, author, title, body, tags, and notification mode.
 * @param deps - the service clock and the wake hook.
 * @returns the stored post view and what the notifications did.
 */
export async function publishPost(
  domain: ForumStore, request: CreatePostInput, deps: WriteDeps,
): Promise<WriteOutcome<PostView>> {
  const tables = forumTablesOf(domain)
  const fields = validatePost(request)
  requireBoard(tables, request.boardId)
  const record = buildPost({ ...fields, boardId: request.boardId, author: request.author }, deps.now())
  await tables.posts.put(record.id, record)
  const deliveries = await announce(
    tables, record, undefined, record.mentions, request.notifyMode ?? 'inbox', deps.now, deps.wake,
  )
  return { value: postView(record, countersOf(domain, request.author)(record), Date.now()), deliveries }
}

/**
 * Write one comment or reply, then notify the parent's author and any mention.
 * @param domain - the opened forum domain.
 * @param request - post, optional parent comment, author, and body.
 * @param deps - the service clock and the wake hook.
 * @returns the stored comment's id and what the notifications did.
 */
export async function writeComment(
  domain: ForumStore, request: CreateCommentInput, deps: WriteDeps,
): Promise<WriteOutcome<{ readonly id: string }>> {
  const tables = forumTablesOf(domain)
  const post = requirePost(tables, request.postId)
  const parent = resolveParent(tables, request.postId, request.parentCommentId)
  const record = buildComment(request, post.boardId, parent, deps.now())
  await tables.comments.put(record.id, record)
  const deliveries = await announce(
    tables, post, record, record.mentions, request.notifyMode ?? 'inbox', deps.now, deps.wake,
  )
  return { value: { id: record.id }, deliveries }
}

/**
 * Pin or unpin one post; pinned posts lead every sort.
 * @param domain - the opened forum domain.
 * @param postId - the post to update.
 * @param pinned - the wanted pin state.
 * @param reader - the reading preset, for its own vote attitude.
 * @param now - the service clock, stamping the update.
 * @returns the updated post view.
 */
export async function setPinned(
  domain: ForumStore, postId: string, pinned: boolean, reader: string | undefined, now: () => string,
): Promise<PostView> {
  const tables = forumTablesOf(domain)
  const post = requirePost(tables, postId)
  const updated: PostRecord = { ...post, pinned, updatedAt: now() }
  await tables.posts.put(updated.id, updated)
  return postView(updated, countersOf(domain, reader)(updated), Date.now())
}
