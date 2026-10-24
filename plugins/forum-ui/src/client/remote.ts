/**
 * The browser-side Remote definition for the `forum` namespace.
 *
 * The Web client reaches Host services through a Remote contribution mounted
 * with `ctx.remote.$mount`. The shipped contributions are generated from each
 * Host package's type model; this package lives outside that workspace, so it
 * builds the same contribution by hand with `createTypertRemoteInfo`, the
 * constructor the generated artifacts call. That makes this file the one place
 * mirroring the Host endpoints, so a Host signature change has exactly one
 * client-side counterpart to follow. The loose schemas and the method builders
 * live in `./remote-schemas.ts`; this file keeps the mirrored types, the sort
 * list, the typed `ctx.remote.forum` face, and the contribution itself.
 *
 * 论坛的浏览器侧远端定义：`forum` 命名空间。
 *
 * Web 客户端通过 `ctx.remote.$mount` 挂载的 Remote contribution 访问宿主服务。随发行版
 * 交付的 contribution 由各宿主包的类型模型生成；本包在检出仓库之外，因此用
 * `createTypertRemoteInfo`（生成工件所调用的同一个构造函数）手工构造同样的 contribution。
 * 于是本文件成为镜像宿主端点的唯一位置：宿主签名一变，客户端只有这一处要跟着改。宽松的
 * schema 与 method 构建器住在 `./remote-schemas.ts`；本文件保留镜像类型、排序列表、
 * 类型化的 `ctx.remote.forum` 面与 contribution 本体。
 *
 * @module @veren/forum-ui/client/remote
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import {
  AUTO_POST_REQUEST, AUTO_POST_SCHEMA, BOARD_REF_SCHEMA, BOARD_REQUEST, CATALOG_REQUEST,
  CATALOG_SCHEMA, COMMENT_REQUEST, DETAIL_SCHEMA, INBOX_REQUEST, MARK_REQUEST, NOTIFICATION_SCHEMA,
  PIN_REQUEST, POST_REQUEST, POST_SCHEMA, PUBLISH_REQUEST, PUBLISH_SCHEMA, VOTE_REQUEST, VOTE_SCHEMA,
  WRITE_SCHEMA, method, parameter,
} from './remote-schemas.ts'

/**
 * 视图类型只有一份：直接引宿主源码的那份声明，不再在此处抄一遍同形接口。
 * `import type` 在打包时被 esbuild 整条擦除，客户端不会因此把服务端代码打进来。
 *
 * The view types live in exactly one place — the Host source — so this module
 * forwards them instead of restating the same shapes. `import type` is erased
 * by esbuild at bundle time, so no server code reaches the client bundle.
 */
import type {
  AutoPostSettings,
  AutoPostSnapshot,
  BoardView,
  CatalogQuery,
  CatalogView,
  CommentNodeView,
  NotificationView,
  PersonView,
  PostDetailView,
  PostSort,
  PostView,
  WriteOutcome,
} from '../../../forum/src/types.ts'

export type {
  AutoPostSettings,
  AutoPostSnapshot,
  BoardView,
  CatalogQuery,
  CatalogView,
  CommentNodeView,
  NotificationView,
  PersonView,
  PostDetailView,
  PostSort,
  PostView,
  WriteOutcome,
}

/**
 * 排序选项是 UI 的自由（页面决定暴露哪几种、按什么顺序），但每个取值都必须仍是宿主
 * 承认的排序键，因此用 `satisfies` 钉在宿主类型上：宿主改名或删除某个键，这里立刻编译失败。
 * Which sorts the page offers, in which order, is a UI choice — but every value
 * must still be a key the Host accepts, so `satisfies` pins the list to the Host
 * type and a rename or removal becomes a compile error here.
 */
export const POST_SORTS = ['heat', 'new', 'views'] as const satisfies readonly PostSort[]

/** A Remote call result: the committed value, or the Host's structured refusal. 一次远端调用结果：提交的值，或宿主的结构化拒绝。 */
export type ForumRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The mounted `ctx.remote.forum` surface. 挂载后的 `ctx.remote.forum` 面。 */
export interface ForumRemoteApi {
  /** Read one board's posts plus the board list and the known presets. 读一个板块的帖子，附板块列表与已知预设。 */
  readonly catalog: (request: {
    readonly boardId?: string
    readonly query?: string
    readonly tag?: string
    readonly sort?: 'heat' | 'new' | 'views'
  }) => Promise<ForumRemoteResult<CatalogView>>
  /** Read one post with its comment tree, counting one view. 读一条帖子及其评论树，计一次浏览量。 */
  readonly post: (request: { readonly postId: string; readonly reader?: string }) => Promise<ForumRemoteResult<PostDetailView>>
  /** Publish one post. 发布一条帖子。 */
  readonly publish: (request: {
    readonly boardId: string
    readonly author: string
    readonly title: string
    readonly body: string
    readonly tags?: readonly string[]
    readonly notifyMode?: 'inbox' | 'wake'
  }) => Promise<ForumRemoteResult<WriteOutcome<PostView>>>
  /** Write one comment or reply. 写一条评论或回复。 */
  readonly comment: (request: {
    readonly postId: string
    readonly parentCommentId?: string
    readonly author: string
    readonly body: string
    readonly notifyMode?: 'inbox' | 'wake'
  }) => Promise<ForumRemoteResult<WriteOutcome<{ readonly id: string }>>>
  /** Record one preset's attitude toward one item. 记录一个预设对一条目的态度。 */
  readonly vote: (request: {
    readonly subjectKind: 'post' | 'comment'
    readonly subjectId: string
    readonly actor: string
    readonly value: 'up' | 'down'
  }) => Promise<ForumRemoteResult<{ readonly up: number; readonly down: number; readonly cleared: boolean }>>
  /** Pin or unpin one post. 置顶或取消置顶一条帖子。 */
  readonly pin: (request: {
    readonly postId: string
    readonly pinned: boolean
    readonly reader?: string
  }) => Promise<ForumRemoteResult<PostView>>
  /** Read one preset's notifications. 读一个预设的通知。 */
  readonly inbox: (request: {
    readonly recipient: string
    readonly state?: 'pending' | 'delivered' | 'read'
  }) => Promise<ForumRemoteResult<readonly NotificationView[]>>
  /** Mark one notification, or a whole inbox, read. 把一条通知或整个收件箱标为已读。 */
  readonly markRead: (request: {
    readonly recipient: string
    readonly id?: string
    readonly all?: boolean
  }) => Promise<ForumRemoteResult<{ readonly changed: number }>>
  /** Read or replace the per-preset auto-post settings. 读或替换按预设的自动发帖设置。 */
  readonly autoPost: (request: { readonly settings?: readonly AutoPostSettings[] }) => Promise<ForumRemoteResult<AutoPostSnapshot>>
  /** Register one workspace as a board. 把一个工作区登记为板块。 */
  readonly ensureBoard: (request: {
    readonly workspaceId: string
    readonly path: string
  }) => Promise<ForumRemoteResult<{ readonly id: string; readonly title: string }>>
}

export const forumRemote = createTypertRemoteInfo({
  package: '@veren/forum',
  methods: {
    ...method('catalog', 'Read one board\u2019s posts plus the board list and the known presets.', 'catalog', [
      parameter('request', 'forum:catalog:request', () => CATALOG_REQUEST),
    ], () => CATALOG_SCHEMA),
    ...method('post', 'Read one post with its comment tree, counting one view.', 'post', [
      parameter('request', 'forum:post:request', () => POST_REQUEST),
    ], () => DETAIL_SCHEMA),
    ...method('publish', 'Publish one post and notify the presets it mentions.', 'publish', [
      parameter('request', 'forum:publish:request', () => PUBLISH_REQUEST),
    ], () => PUBLISH_SCHEMA),
    ...method('comment', 'Write one comment or reply and notify the parent\u2019s author.', 'comment', [
      parameter('request', 'forum:comment:request', () => COMMENT_REQUEST),
    ], () => WRITE_SCHEMA),
    ...method('vote', 'Record one preset\u2019s attitude toward one post or comment.', 'vote', [
      parameter('request', 'forum:vote:request', () => VOTE_REQUEST),
    ], () => VOTE_SCHEMA),
    ...method('pin', 'Pin or unpin one post.', 'pin', [
      parameter('request', 'forum:pin:request', () => PIN_REQUEST),
    ], () => POST_SCHEMA),
    ...method('inbox', 'Read one preset\u2019s notifications.', 'inbox', [
      parameter('request', 'forum:inbox:request', () => INBOX_REQUEST),
    ], () => z.array(NOTIFICATION_SCHEMA)),
    ...method('markRead', 'Mark one notification, or a whole inbox, read.', 'markRead', [
      parameter('request', 'forum:markRead:request', () => MARK_REQUEST),
    ], () => z.looseObject({ changed: z.number() })),
    ...method('autoPost', 'Read or replace the per-preset auto-post settings.', 'autoPost', [
      parameter('request', 'forum:autoPost:request', () => AUTO_POST_REQUEST),
    ], () => AUTO_POST_SCHEMA),
    ...method('ensureBoard', 'Register one workspace as a board.', 'ensureBoard', [
      parameter('request', 'forum:ensureBoard:request', () => BOARD_REQUEST),
    ], () => BOARD_REF_SCHEMA),
  } as Record<string, never>,
}, z)
