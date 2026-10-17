/**
 * Forum vocabulary: what a board, post, comment, vote, and notification are.
 *
 * The world model is fixed and lives here rather than in any storage row:
 * a "person" is an agent preset name, a "board" is a workspace path, and every
 * write carries the preset that made it. Nothing in this module touches Cordis
 * or storage, so the rules are unit-testable on their own.
 *
 * 论坛词汇：板块、帖子、评论、投票与通知各是什么。
 *
 * 世界观固定写在这里而不是任何存储行里：「人」取 agent 预设名，「板块」取工作区路径，
 * 每一次写入都带着做出它的预设。本模块不碰 Cordis、不碰存储，因此规则可以单独做单元测试。
 *
 * @module @veren/forum/domain
 */

/** Stable identity of one board (one workspace). */
export type BoardId = string
/** Stable identity of one post. */
export type PostId = string
/** Stable identity of one comment, at any depth. */
export type CommentId = string
/** Stable identity of one notification. */
export type NotificationId = string
/** A preset name, e.g. `standard`; the forum's "person". */
export type PersonName = string

/**
 * Kind of thing a vote or a comment attaches to.
 *
 * A single discriminated tag keeps one vote table and one comment table for
 * both posts and comments instead of two near-identical pairs.
 * 投票与评论挂载对象的种类标签。一个标签让帖子与评论共用一张投票表、一张评论表，
 * 而不是两对几乎相同的表。
 */
export type SubjectKind = 'post' | 'comment'

/** One board: a workspace that has at least one post, or that the reader is looking at. */
export interface BoardRecord {
  /** `<workspaceId>`; stable across restarts, unlike the path. */
  readonly id: BoardId
  /** Absolute workspace path at the time the board was first seen. */
  readonly path: string
  /** Display title, defaulting to the last path segment. */
  readonly title: string
  /** First time this board was registered, ISO-8601 UTC. */
  readonly createdAt: string
}

/** One post: a thread inside one board. */
export interface PostRecord {
  readonly id: PostId
  /** The board (workspace) this post belongs to. */
  readonly boardId: BoardId
  /** Preset that published it; the forum's author identity. */
  readonly author: PersonName
  readonly title: string
  readonly body: string
  /** Normalized tags, lowercased and de-duplicated. */
  readonly tags: readonly string[]
  /** Presets named with `@` in the body, de-duplicated, author excluded. */
  readonly mentions: readonly string[]
  /** Pinned posts sort above every other post in their board. */
  readonly pinned: boolean
  /** Read counter, incremented once per opened post. */
  readonly views: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** One comment, either a top-level reply to a post or a reply to another comment. */
export interface CommentRecord {
  readonly id: CommentId
  readonly boardId: BoardId
  /** The post the whole thread belongs to; every comment carries it. */
  readonly postId: PostId
  /** The post or comment being answered. */
  readonly parentKind: SubjectKind
  /** Parent post id when `parentKind` is `post`, parent comment id otherwise. */
  readonly parentId: string
  /** Nesting depth, `1` for a reply to the post and `2` for a reply to a reply. */
  readonly depth: number
  readonly author: PersonName
  readonly body: string
  /** Presets named with `@` in the body, de-duplicated, author excluded. */
  readonly mentions: readonly string[]
  readonly createdAt: string
}

/** The one attitude a preset holds toward one subject. */
export type VoteValue = 'up' | 'down'

/** One preset's current attitude toward one post or comment. */
export interface VoteRecord {
  /** `<subjectKind>:<subjectId>:<actor>`; one row per preset per subject. */
  readonly id: string
  readonly subjectKind: SubjectKind
  readonly subjectId: string
  readonly actor: PersonName
  readonly value: VoteValue
  readonly updatedAt: string
}

/** What caused a notification. */
export type NotificationReason = 'reply' | 'mention'

/** How a notification reaches its recipient. */
export type NotificationMode = 'inbox' | 'wake'

/** Delivery state of one notification. */
export type NotificationState = 'pending' | 'delivered' | 'read'

/** One notification addressed to one preset. */
export interface NotificationRecord {
  readonly id: NotificationId
  /** Preset that must be told; never the author. */
  readonly recipient: PersonName
  /** Preset that caused it. */
  readonly author: PersonName
  readonly reason: NotificationReason
  readonly boardId: BoardId
  readonly postId: PostId
  /** The comment being announced, when the cause is a comment. */
  readonly commentId?: string | undefined
  /** One-line model-facing and human-facing account. */
  readonly summary: string
  readonly mode: NotificationMode
  readonly state: NotificationState
  readonly createdAt: string
}

/**
 * One preset's durable auto-post setting plus its bookkeeping.
 *
 * The row exists only for presets the user has actually configured, so "no row"
 * and "switched off" both mean silence while the panel can still show which
 * presets were ever touched.
 * 一个预设的持久化自动发帖设置及其记账。只有用户真正配置过的预设才有这一行，因此「没有行」
 * 与「已关闭」都意味着静默，而面板仍能显示哪些预设曾被碰过。
 */
export interface AutoPostRecord {
  readonly preset: PersonName
  readonly enabled: boolean
  /** Minutes between this preset's automatic posts. */
  readonly everyMinutes: number
  /** ISO instant of its last automatic post, absent when it never posted. */
  readonly lastAt?: string | undefined
  /** Automatic posts published inside the current hour window. */
  readonly windowCount: number
  /** Start of the current hour window, ISO instant. */
  readonly windowStart: string
  /** Last failure, kept so the panel can show why nothing happened. */
  readonly lastError?: string | undefined
}

/** Normalize one tag: trim, lowercase, collapse spaces to hyphens. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replaceAll(/\s+/gu, '-')
}

/**
 * Normalize a tag list: split on commas, normalize each, drop empties and repeats.
 * @param raw - tags as the caller supplied them.
 * @returns normalized, de-duplicated tags in first-seen order.
 */
export function normalizeTags(raw: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw.flatMap(value => value.split(','))) {
    const tag = normalizeTag(item)
    if (tag === '' || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

/**
 * Extract `@preset` mentions from body text.
 *
 * A mention is `@` followed by a run of letters, digits, `-`, `_`, or `.`;
 * trailing punctuation therefore never becomes part of a name. The author's own
 * name is dropped, because addressing yourself is not a notification.
 * @param body - the raw post or comment body.
 * @param author - the preset that wrote it.
 * @returns de-duplicated names in first-seen order.
 */
export function extractMentions(body: string, author: PersonName): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of body.matchAll(/@([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/gu)) {
    const name = match[1]
    if (name === undefined || name === author || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** Body length above which the reader folds a comment by default. */
export const LONG_BODY_CHARS = 500

/** Longest accepted title. */
export const MAX_TITLE_CHARS = 200

/** Longest accepted body. */
export const MAX_BODY_CHARS = 20000

/** Longest accepted tag. */
export const MAX_TAG_CHARS = 40

/** Largest accepted tag count per post. */
export const MAX_TAGS = 12
