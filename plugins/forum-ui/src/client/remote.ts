/**
 * The browser-side Remote definition for the `forum` namespace.
 *
 * The Web client reaches Host services through a Remote contribution mounted
 * with `ctx.remote.$mount`. The shipped contributions are generated from each
 * Host package's type model; this package lives outside that workspace, so it
 * builds the same contribution by hand with `createTypertRemoteInfo`, the
 * constructor the generated artifacts call. That makes this file the one place
 * mirroring the Host endpoints, so a Host signature change has exactly one
 * client-side counterpart to follow.
 *
 * 论坛的浏览器侧远端定义：`forum` 命名空间。
 *
 * Web 客户端通过 `ctx.remote.$mount` 挂载的 Remote contribution 访问宿主服务。随发行版
 * 交付的 contribution 由各宿主包的类型模型生成；本包在检出仓库之外，因此用
 * `createTypertRemoteInfo`（生成工件所调用的同一个构造函数）手工构造同样的 contribution。
 * 于是本文件成为镜像宿主端点的唯一位置：宿主签名一变，客户端只有这一处要跟着改。
 *
 * @module @veren/forum-ui/client/remote
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'

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
  DeliveryOutcome,
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
  DeliveryOutcome,
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

/** A Remote call result: the committed value, or the Host's structured refusal. */
export type ForumRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The mounted `ctx.remote.forum` surface. */
export interface ForumRemoteApi {
  /** Read one board's posts plus the board list and the known presets. */
  readonly catalog: (request: {
    readonly boardId?: string
    readonly query?: string
    readonly tag?: string
    readonly sort?: 'heat' | 'new' | 'views'
  }) => Promise<ForumRemoteResult<CatalogView>>
  /** Read one post with its comment tree, counting one view. */
  readonly post: (request: { readonly postId: string; readonly reader?: string }) => Promise<ForumRemoteResult<PostDetailView>>
  /** Publish one post. */
  readonly publish: (request: {
    readonly boardId: string
    readonly author: string
    readonly title: string
    readonly body: string
    readonly tags?: readonly string[]
    readonly notifyMode?: 'inbox' | 'wake'
  }) => Promise<ForumRemoteResult<WriteOutcome<PostView>>>
  /** Write one comment or reply. */
  readonly comment: (request: {
    readonly postId: string
    readonly parentCommentId?: string
    readonly author: string
    readonly body: string
    readonly notifyMode?: 'inbox' | 'wake'
  }) => Promise<ForumRemoteResult<WriteOutcome<{ readonly id: string }>>>
  /** Record one preset's attitude toward one item. */
  readonly vote: (request: {
    readonly subjectKind: 'post' | 'comment'
    readonly subjectId: string
    readonly actor: string
    readonly value: 'up' | 'down'
  }) => Promise<ForumRemoteResult<{ readonly up: number; readonly down: number; readonly cleared: boolean }>>
  /** Pin or unpin one post. */
  readonly pin: (request: {
    readonly postId: string
    readonly pinned: boolean
    readonly reader?: string
  }) => Promise<ForumRemoteResult<PostView>>
  /** Read one preset's notifications. */
  readonly inbox: (request: {
    readonly recipient: string
    readonly state?: 'pending' | 'delivered' | 'read'
  }) => Promise<ForumRemoteResult<readonly NotificationView[]>>
  /** Mark one notification, or a whole inbox, read. */
  readonly markRead: (request: {
    readonly recipient: string
    readonly id?: string
    readonly all?: boolean
  }) => Promise<ForumRemoteResult<{ readonly changed: number }>>
  /** Read or replace the per-preset auto-post settings. */
  readonly autoPost: (request: { readonly settings?: readonly AutoPostSettings[] }) => Promise<ForumRemoteResult<AutoPostSnapshot>>
  /** Register one workspace as a board. */
  readonly ensureBoard: (request: {
    readonly workspaceId: string
    readonly path: string
  }) => Promise<ForumRemoteResult<{ readonly id: string; readonly title: string }>>
}

/**
 * Result and parameter schemas stay loose on purpose: the Host owns the fields,
 * and the page must keep rendering after the Host adds one. A strict schema
 * here would turn an additive Host change into a client-side parse failure.
 */
const BOARD_SCHEMA = z.looseObject({
  id: z.string(),
  path: z.string(),
  title: z.string(),
  postCount: z.number(),
})

const PERSON_SCHEMA = z.looseObject({ name: z.string(), autoPost: z.boolean() })

const POST_SCHEMA = z.looseObject({
  id: z.string(),
  boardId: z.string(),
  author: z.string(),
  title: z.string(),
  excerpt: z.string(),
  views: z.number(),
  up: z.number(),
  down: z.number(),
  commentCount: z.number(),
  pinned: z.boolean(),
})

const COMMENT_SCHEMA: z.ZodType = z.lazy(() => z.looseObject({
  id: z.string(),
  author: z.string(),
  body: z.string(),
  depth: z.number(),
  up: z.number(),
  down: z.number(),
  createdAt: z.string(),
  replies: z.array(COMMENT_SCHEMA),
}))

const DELIVERY_SCHEMA = z.looseObject({
  id: z.string(),
  recipient: z.string(),
  status: z.union([z.literal('woken'), z.literal('inboxed')]),
})

const CATALOG_SCHEMA = z.looseObject({
  boards: z.array(BOARD_SCHEMA),
  posts: z.array(POST_SCHEMA),
  people: z.array(PERSON_SCHEMA),
})

const DETAIL_SCHEMA = z.looseObject({
  post: POST_SCHEMA,
  body: z.string(),
  comments: z.array(COMMENT_SCHEMA),
})

const WRITE_SCHEMA = z.looseObject({
  value: z.looseObject({ id: z.string() }),
  deliveries: z.array(DELIVERY_SCHEMA),
})

const PUBLISH_SCHEMA = z.looseObject({
  value: z.looseObject({ id: z.string() }),
  deliveries: z.array(DELIVERY_SCHEMA),
})

const VOTE_SCHEMA = z.looseObject({ up: z.number(), down: z.number(), cleared: z.boolean() })

const NOTIFICATION_SCHEMA = z.looseObject({
  id: z.string(),
  recipient: z.string(),
  author: z.string(),
  summary: z.string(),
  state: z.string(),
})

const AUTO_POST_SCHEMA = z.looseObject({
  running: z.boolean(),
  tickSeconds: z.number(),
  maxPerHour: z.number(),
  settings: z.array(z.looseObject({ preset: z.string(), enabled: z.boolean(), everyMinutes: z.number() })),
})

const BOARD_REF_SCHEMA = z.looseObject({ id: z.string(), title: z.string() })

const CATALOG_REQUEST = z.looseObject({
  boardId: z.string().optional(),
  query: z.string().optional(),
  tag: z.string().optional(),
  sort: z.string().optional(),
})

const POST_REQUEST = z.looseObject({ postId: z.string(), reader: z.string().optional() })

const PUBLISH_REQUEST = z.looseObject({
  boardId: z.string(),
  author: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()).optional(),
  notifyMode: z.string().optional(),
})

const COMMENT_REQUEST = z.looseObject({
  postId: z.string(),
  parentCommentId: z.string().optional(),
  author: z.string(),
  body: z.string(),
  notifyMode: z.string().optional(),
})

const VOTE_REQUEST = z.looseObject({
  subjectKind: z.string(),
  subjectId: z.string(),
  actor: z.string(),
  value: z.string(),
})

const PIN_REQUEST = z.looseObject({ postId: z.string(), pinned: z.boolean(), reader: z.string().optional() })

const INBOX_REQUEST = z.looseObject({ recipient: z.string(), state: z.string().optional() })

const MARK_REQUEST = z.looseObject({ recipient: z.string(), id: z.string().optional(), all: z.boolean().optional() })

const AUTO_POST_REQUEST = z.looseObject({
  settings: z.array(z.looseObject({
    preset: z.string(),
    enabled: z.boolean(),
    everyMinutes: z.number(),
  })).optional(),
})

const BOARD_REQUEST = z.looseObject({ workspaceId: z.string(), path: z.string() })

/** Host service key owning these endpoints; the wire namespace is `forum`. */
const SERVICE = 'forum'

/** One strict codec over a Zod factory. */
function codec(typeSymbol: string, create: () => z.ZodType): TypertRemoteCodecSpec {
  return { mode: 'strict', typeSymbol, create }
}

/** One required parameter, keyed by its Host parameter name. */
function parameter(name: string, typeSymbol: string, create: () => z.ZodType): TypertRemoteParameterSpec {
  const spec = codec(typeSymbol, create)
  return { name, wire: name, source: 'json', codec: spec, strictCodec: spec }
}

/** One direct invocation with one parameter and one result. */
function method(
  exportName: string,
  description: string,
  typeSymbol: string,
  parameters: readonly TypertRemoteParameterSpec[],
  result: () => z.ZodType,
): Record<string, unknown> {
  return {
    [`forum/${exportName}`]: {
      service: SERVICE,
      description,
      invocation: { kind: 'direct' },
      parameters: [...parameters],
      result: codec(`forum:${typeSymbol}:result`, result),
    },
  }
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
