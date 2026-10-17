/**
 * Posts and boards: publishing, reading, ordering, and search.
 *
 * A board is a workspace, so the board table is a registry of the workspaces
 * this deployment has actually seen — a workspace the user creates later
 * becomes a board the first time the panel reads the catalog, which is what
 * makes new boards appear without any registration step.
 *
 * 帖子与板块：发布、读取、排序与搜索。
 *
 * 板块就是工作区，因此板块表是「本部署真正见过的工作区」的登记簿——用户之后新建的工作区
 * 会在面板第一次读目录时成为板块，这正是新板块无需任何注册步骤就会出现的原因。
 *
 * @module @veren/forum/posts
 */

import {
  MAX_BODY_CHARS, MAX_TAGS, MAX_TAG_CHARS, MAX_TITLE_CHARS,
  extractMentions, normalizeTags,
} from './domain.ts'
import type { BoardRecord, PostRecord } from './domain.ts'
import { ForumError } from './types.ts'
import type { BoardView, PostCounters, PostSort, PostView } from './types.ts'
import { mintId } from './ids.ts'
import type { ForumStore } from './storage.ts'
import { view } from './storage.ts'

/** Characters of the body a list row shows. */
const EXCERPT_CHARS = 160

/** How many characters a body excerpt keeps. */
export { EXCERPT_CHARS }

/** The five tables one forum store exposes, already projected. */
export interface Tables {
  readonly boards: ReturnType<typeof view<BoardRecord>>
  readonly posts: ReturnType<typeof view<PostRecord>>
}

/**
 * Project the domain's board and post tables.
 * @param domain - the opened forum domain.
 * @returns both tables in the three-method view the operations use.
 */
export function tablesOf(domain: ForumStore): Tables {
  return {
    boards: view(domain.table('boards')),
    posts: view(domain.table('posts')),
  }
}

/** Display title of a workspace path: its last non-empty segment. */
export function boardTitleFromPath(path: string): string {
  const segments = path.replaceAll('\\', '/').split('/').filter(segment => segment !== '')
  return segments.at(-1) ?? path
}

/**
 * Register one workspace as a board, or refresh its recorded path.
 * @param tables - board and post tables.
 * @param workspaceId - the workspace identity, used as the board id.
 * @param path - the workspace's current absolute path.
 * @param now - ISO instant stamped on a newly created board.
 * @returns the stored board.
 */
export async function ensureBoard(
  tables: Tables, workspaceId: string, path: string, now: string,
): Promise<BoardRecord> {
  const existing = tables.boards.get(workspaceId)
  if (existing !== undefined) {
    if (existing.path === path) return existing
    const moved: BoardRecord = { ...existing, path, title: boardTitleFromPath(path) }
    await tables.boards.put(workspaceId, moved)
    return moved
  }
  const created: BoardRecord = { id: workspaceId, path, title: boardTitleFromPath(path), createdAt: now }
  await tables.boards.put(workspaceId, created)
  return created
}

/**
 * Validate and normalize one post's fields.
 * @param input - caller-supplied title, body, and tags.
 * @returns the fields as stored.
 * @throws ForumError `input_invalid` naming the first rejected field.
 */
export function validatePost(input: {
  readonly title: string
  readonly body: string
  readonly tags?: readonly string[]
}): { readonly title: string; readonly body: string; readonly tags: readonly string[] } {
  const title = input.title.trim()
  if (title === '') throw new ForumError('forum/input-invalid', 'a post needs a title.')
  if (title.length > MAX_TITLE_CHARS) {
    throw new ForumError('forum/input-invalid', `a title is at most ${String(MAX_TITLE_CHARS)} characters.`)
  }
  const body = input.body.trim()
  if (body.length > MAX_BODY_CHARS) {
    throw new ForumError('forum/input-invalid', `a body is at most ${String(MAX_BODY_CHARS)} characters.`)
  }
  const tags = normalizeTags(input.tags ?? [])
  if (tags.length > MAX_TAGS) {
    throw new ForumError('forum/input-invalid', `a post carries at most ${String(MAX_TAGS)} tags.`)
  }
  const long = tags.find(tag => tag.length > MAX_TAG_CHARS)
  if (long !== undefined) {
    throw new ForumError('forum/input-invalid', `the tag "${long}" is longer than ${String(MAX_TAG_CHARS)} characters.`)
  }
  return { title, body, tags }
}

/** Build one post record. */
export function buildPost(
  input: { readonly boardId: string; readonly author: string; readonly title: string; readonly body: string; readonly tags: readonly string[] },
  now: string,
): PostRecord {
  return {
    id: mintId('post'),
    boardId: input.boardId,
    author: input.author,
    title: input.title,
    body: input.body,
    tags: input.tags,
    mentions: extractMentions(input.body, input.author),
    pinned: false,
    views: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/** Counters a post view carries; supplied by the caller so this module owns no other table. */
export type { PostCounters }

/**
 * Compute a post's heat: engagement weighted against how old it is.
 *
 * Views are compressed logarithmically because a single viral post would
 * otherwise outrank every discussion forever; the age term is what lets a
 * newer thread overtake an older one with the same engagement.
 * @param post - the stored post.
 * @param counters - its vote and comment counters.
 * @param nowMs - the instant the ranking is evaluated at.
 * @returns the heat value, higher first.
 */
export function heatOf(post: PostRecord, counters: PostCounters, nowMs: number): number {
  const engagement = counters.up * 3 + counters.commentCount * 2 - counters.down * 2
  const reach = Math.log2(post.views + 1) * 4
  const ageHours = Math.max(0, nowMs - Date.parse(post.createdAt)) / 3_600_000
  return (engagement + reach) / Math.pow(ageHours + 2, 0.6)
}

/**
 * Project one stored post onto the row the panel renders.
 * @param post - the stored post.
 * @param counters - its vote and comment counters.
 * @param nowMs - the instant the heat is evaluated at.
 * @returns the post view.
 */
export function postView(post: PostRecord, counters: PostCounters, nowMs: number): PostView {
  return {
    id: post.id,
    boardId: post.boardId,
    author: post.author,
    title: post.title,
    excerpt: post.body.length > EXCERPT_CHARS ? `${post.body.slice(0, EXCERPT_CHARS)}…` : post.body,
    tags: post.tags,
    mentions: post.mentions,
    pinned: post.pinned,
    views: post.views,
    up: counters.up,
    down: counters.down,
    commentCount: counters.commentCount,
    heat: heatOf(post, counters, nowMs),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    ...counters.myVote === undefined ? {} : { myVote: counters.myVote },
  }
}

/**
 * Match one post against a keyword and a tag filter.
 *
 * Search is a case-insensitive substring test over the four things a reader
 * remembers about a post: its title, its body, its tags, and who wrote it.
 * @param post - the stored post.
 * @param query - lowercased keyword, or `''` for no keyword filter.
 * @param tag - exact tag, or `''` for no tag filter.
 * @returns whether the post matches both filters.
 */
export function matches(post: PostRecord, query: string, tag: string): boolean {
  if (tag !== '' && !post.tags.includes(tag)) return false
  if (query === '') return true
  return post.title.toLowerCase().includes(query)
    || post.body.toLowerCase().includes(query)
    || post.author.toLowerCase().includes(query)
    || post.tags.some(value => value.includes(query))
}

/**
 * Order post views by the requested key.
 *
 * Pinned posts always lead, whatever the sort: a pinned post is a decision the
 * reader made about the board, and a sort is only a view of the rest.
 * @param posts - the post views to order.
 * @param sort - `heat`, `new`, or `views`.
 * @returns a new, ordered array.
 */
export function orderPosts(posts: readonly PostView[], sort: PostSort): readonly PostView[] {
  const rank = (a: PostView, b: PostView): number => {
    switch (sort) {
      case 'heat': return b.heat - a.heat
      case 'views': return b.views - a.views
      case 'new': return b.createdAt.localeCompare(a.createdAt)
    }
  }
  return [...posts].sort((a, b) => Number(b.pinned) - Number(a.pinned) || rank(a, b) || a.id.localeCompare(b.id))
}

/**
 * List one board's posts as the panel renders them.
 * @param tables - board and post tables.
 * @param boardId - the board to read.
 * @param counters - supplies the vote and comment counters of one post.
 * @param options - keyword, tag, sort, and the evaluation instant.
 * @returns ordered post views.
 */
export function listPosts(
  tables: Tables,
  boardId: string,
  counters: (post: PostRecord) => PostCounters,
  options: { readonly query?: string; readonly tag?: string; readonly sort?: PostSort; readonly nowMs: number },
): readonly PostView[] {
  const query = (options.query ?? '').trim().toLowerCase()
  const tag = (options.tag ?? '').trim().toLowerCase()
  const rows = tables.posts.all().filter(post => post.boardId === boardId && matches(post, query, tag))
  return orderPosts(rows.map(post => postView(post, counters(post), options.nowMs)), options.sort ?? 'heat')
}

/**
 * List the boards the panel offers, with their post counts.
 * @param tables - board and post tables.
 * @returns boards ordered by title.
 */
export function listBoards(tables: Tables): readonly BoardView[] {
  const counts = new Map<string, number>()
  for (const post of tables.posts.all()) {
    counts.set(post.boardId, (counts.get(post.boardId) ?? 0) + 1)
  }
  return tables.boards.all()
    .map(board => ({ id: board.id, path: board.path, title: board.title, postCount: counts.get(board.id) ?? 0 }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}

/**
 * Every tag in use across a board's posts, most used first.
 * @param tables - board and post tables.
 * @param boardId - the board to read.
 * @returns the tag vocabulary.
 */
export function listTags(tables: Tables, boardId: string): readonly string[] {
  const counts = new Map<string, number>()
  for (const post of tables.posts.all()) {
    if (post.boardId !== boardId) continue
    for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
}

/**
 * Resolve one stored post, or refuse.
 * @param tables - board and post tables.
 * @param postId - the post to find.
 * @returns the stored post.
 * @throws ForumError `post_not_found`.
 */
export function requirePost(tables: Tables, postId: string): PostRecord {
  const post = tables.posts.get(postId)
  if (post === undefined) throw new ForumError('forum/post-not-found', `no post with id "${postId}".`)
  return post
}
