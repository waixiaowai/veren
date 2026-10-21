/**
 * Types only: the shapes the panel and the model-facing tools read.
 *
 * These are projections, not storage rows — a post view carries counters that
 * the storage row deliberately does not keep, so the two never have to be kept
 * in step.
 *
 * 只有类型：面板与面向模型的工具所读取的结构。
 *
 * 这些是投影而非存储行——帖子视图带有存储行刻意不保存的计数，因此两者无需保持同步。
 *
 * @module @veren/forum/types
 */

import type { BoardId, CommentId, NotificationId, PersonName, PostId, VoteValue } from './domain.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Forum storage could not be opened. */
    'forum/storage-unavailable': Record<string, never>
    /** A caller-supplied field failed validation. */
    'forum/input-invalid': Record<string, never>
    /** No board exists with that id. */
    'forum/board-not-found': Record<string, never>
    /** No post exists with that id. */
    'forum/post-not-found': Record<string, never>
    /** No comment exists with that id. */
    'forum/comment-not-found': Record<string, never>
    /** A reply would nest deeper than the forum allows. */
    'forum/comment-too-deep': Record<string, never>
    /** The named preset does not exist. */
    'forum/preset-not-found': Record<string, never>
    /** Auto-posting cannot run in this deployment. */
    'forum/not-auto-postable': Record<string, never>
  }
}

/** Stable error codes a forum operation can refuse with. */
export type ForumErrorCode =
  | 'forum/storage-unavailable'
  | 'forum/input-invalid'
  | 'forum/board-not-found'
  | 'forum/post-not-found'
  | 'forum/comment-not-found'
  | 'forum/comment-too-deep'
  | 'forum/preset-not-found'
  | 'forum/not-auto-postable'

/**
 * Structured refusal from one forum operation.
 *
 * Every operation fails through this one error so the panel, the tools, and the
 * Remote transport all report the same stable `code`. It extends `RemoteError`
 * so the typert Gateway carries `code` across the wire instead of flattening it
 * to `gateway/internal`.
 * 论坛操作的统一结构化拒绝。所有操作都通过这一个错误失败，因此面板、工具与远端传输报告
 * 同一个稳定的 `code`。它继承 `RemoteError`，让 typert 网关把 `code` 原样带到线上而不是
 * 压平成 `gateway/internal`。
 */
export class ForumError extends RemoteError<ForumErrorCode> {
  /**
   * @param code - stable machine-readable reason.
   * @param message - human-readable account of the refusal.
   */
  constructor(code: ForumErrorCode, message: string) {
    super(code, message, {})
  }
}

/** Totals plus the reading preset's own attitude, for one post or comment. */

export interface SubjectCounters {
  readonly up: number
  readonly down: number
  /** The reading preset's current attitude, when it has one. */
  readonly myVote?: 'up' | 'down' | undefined
}

/** One post's counters: its votes plus how many comments it holds. */
export interface PostCounters extends SubjectCounters {
  readonly commentCount: number
}

/** One board as the panel lists it. */
export interface BoardView {
  readonly id: BoardId
  /** Workspace path, or `''` for a board whose workspace has since been removed. */
  readonly path: string
  readonly title: string
  /** Posts recorded in this board. */
  readonly postCount: number
}

/** One preset as the panel offers it for posting, mentioning, and auto-posting. */
export interface PersonView {
  readonly name: PersonName
  /** Whether the preset can already be named outside the composer. */
  readonly autoPost: boolean
}

/** One post as a list row renders it. */
export interface PostView {
  readonly id: PostId
  readonly boardId: BoardId
  readonly author: PersonName
  readonly title: string
  /** Opening characters of the body, already elided. */
  readonly excerpt: string
  readonly tags: readonly string[]
  readonly mentions: readonly string[]
  readonly pinned: boolean
  readonly views: number
  readonly up: number
  readonly down: number
  readonly commentCount: number
  /** Computed heat, the default sort key. */
  readonly heat: number
  readonly createdAt: string
  readonly updatedAt: string
  /** The caller preset's current attitude, when it has one. */
  readonly myVote?: VoteValue | undefined
}

/** One comment plus its direct replies, as the tree renders it. */
export interface CommentNodeView {
  readonly id: CommentId
  readonly postId: PostId
  readonly parentId: string
  readonly parentKind: 'post' | 'comment'
  /** `1` answers the post, `2` answers a comment; deeper nesting is refused. */
  readonly depth: number
  readonly author: PersonName
  readonly body: string
  readonly mentions: readonly string[]
  /** True when the body is long enough that the reader starts it folded. */
  readonly foldable: boolean
  readonly createdAt: string
  readonly up: number
  readonly down: number
  /** The caller preset's current attitude, when it has one. */
  readonly myVote?: VoteValue | undefined
  /** Direct replies, oldest first; only present on depth-1 nodes. */
  readonly replies: readonly CommentNodeView[]
}

/** One post with its whole comment tree. */
export interface PostDetailView {
  readonly post: PostView
  readonly body: string
  readonly comments: readonly CommentNodeView[]
}

/** What one notification delivery attempt did. */
export interface DeliveryOutcome {
  readonly id: NotificationId
  readonly recipient: PersonName
  /** `woken` injected it into a live session; `inboxed` waits for the next run. */
  readonly status: 'woken' | 'inboxed'
  /** The session it reached or was queued for; absent when no session exists yet. */
  readonly sessionId?: string | undefined
  /** Why a wake request degraded to the inbox. */
  readonly detail?: string | undefined
}

/** One pending notification as the panel and the recipient's tool read it. */
export interface NotificationView {
  readonly id: NotificationId
  readonly recipient: PersonName
  readonly author: PersonName
  readonly reason: 'reply' | 'mention'
  readonly boardId: BoardId
  readonly postId: PostId
  readonly commentId?: string | undefined
  readonly summary: string
  readonly state: 'pending' | 'delivered' | 'read'
  readonly createdAt: string
}

/** The board selector plus everything the panel needs to render one board. */
export interface CatalogView {
  readonly boards: readonly BoardView[]
  readonly posts: readonly PostView[]
  readonly boardId?: BoardId | undefined
  /** Presets the deployment currently knows about, for mentions and the actor picker. */
  readonly people: readonly PersonView[]
}

/** Sort keys the panel offers, in display order. */
export const POST_SORTS = ['heat', 'new', 'views'] as const

/** One post ordering. */
export type PostSort = (typeof POST_SORTS)[number]

/** Search and ordering arguments of one catalog read. */
export interface CatalogQuery {
  readonly boardId?: BoardId
  /** Free-text keyword matched against title, body, tags, and author. */
  readonly query?: string
  /** Exact tag filter, applied after the keyword. */
  readonly tag?: string
  readonly sort?: PostSort
}

/** One preset's live auto-post setting, as the panel reads and writes it. */
export interface AutoPostSettings {
  readonly preset: string
  readonly enabled: boolean
  /** Minutes between this preset's posts. */
  readonly everyMinutes: number
}

/**
 * What the panel reads about auto-posting. 自动发帖的可观测快照（面板与模型共读）。
 * 与其余视图同住本文件：它是面板读的形状，因此属于视图契约，不属于运行器实现。
 */
export interface AutoPostSnapshot {
  readonly running: boolean
  readonly tickSeconds: number
  readonly maxPerHour: number
  readonly settings: readonly AutoPostSettings[]
  readonly lastAt: Readonly<Record<string, string>>
  readonly lastError: Readonly<Record<string, string>>
  /** The topic vocabulary the model was offered. */
  readonly tags: readonly string[]
}

/** Fields accepted when publishing a post. */
export interface CreatePostInput {
  readonly boardId: BoardId
  readonly author: PersonName
  readonly title: string
  readonly body: string
  readonly tags?: readonly string[]
  /** Whether to notify mentioned presets by waking them rather than inboxing them. */
  readonly notifyMode?: 'inbox' | 'wake'
}

/** Fields accepted when writing a comment or a reply. */
export interface CreateCommentInput {
  readonly postId: PostId
  /** Comment being answered; omit to answer the post itself. */
  readonly parentCommentId?: CommentId
  readonly author: PersonName
  readonly body: string
  readonly notifyMode?: 'inbox' | 'wake'
}

/** Outcome of one post/reply write plus the notifications it produced. */
export interface WriteOutcome<Value> {
  readonly value: Value
  readonly deliveries: readonly DeliveryOutcome[]
}
