/**
 * The wire kit of the hand-built `forum` Remote contribution: the loose Zod
 * schemas for every request and result, and the small builders that turn them
 * into typert codec/parameter/method specs.
 *
 * Result and parameter schemas stay loose on purpose: the Host owns the
 * fields, and the page must keep rendering after the Host adds one. A strict
 * schema here would turn an additive Host change into a client-side parse
 * failure.
 *
 * 手工构造的 `forum` 远端 contribution 的线路套件：每个请求与结果的宽松 Zod schema，
 * 以及把它们变成 typert codec/parameter/method 规格的小构建器。
 *
 * 结果与参数 schema 刻意保持宽松：字段归宿主所有，宿主新增字段后页面必须照常渲染。
 * 这里若写严格 schema，宿主一次增量变更就会变成客户端解析失败。
 *
 * @module @veren/forum-ui/client/remote-schemas
 */

import { z } from 'zod'
import type { TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'

export const BOARD_SCHEMA = z.looseObject({
  id: z.string(),
  path: z.string(),
  title: z.string(),
  postCount: z.number(),
})

export const PERSON_SCHEMA = z.looseObject({ name: z.string(), autoPost: z.boolean() })

export const POST_SCHEMA = z.looseObject({
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

export const COMMENT_SCHEMA: z.ZodType = z.lazy(() => z.looseObject({
  id: z.string(),
  author: z.string(),
  body: z.string(),
  depth: z.number(),
  up: z.number(),
  down: z.number(),
  createdAt: z.string(),
  replies: z.array(COMMENT_SCHEMA),
}))

export const DELIVERY_SCHEMA = z.looseObject({
  id: z.string(),
  recipient: z.string(),
  status: z.union([z.literal('woken'), z.literal('inboxed')]),
})

export const CATALOG_SCHEMA = z.looseObject({
  boards: z.array(BOARD_SCHEMA),
  posts: z.array(POST_SCHEMA),
  people: z.array(PERSON_SCHEMA),
})

export const DETAIL_SCHEMA = z.looseObject({
  post: POST_SCHEMA,
  body: z.string(),
  comments: z.array(COMMENT_SCHEMA),
})

export const WRITE_SCHEMA = z.looseObject({
  value: z.looseObject({ id: z.string() }),
  deliveries: z.array(DELIVERY_SCHEMA),
})

export const PUBLISH_SCHEMA = z.looseObject({
  value: z.looseObject({ id: z.string() }),
  deliveries: z.array(DELIVERY_SCHEMA),
})

export const VOTE_SCHEMA = z.looseObject({ up: z.number(), down: z.number(), cleared: z.boolean() })

export const NOTIFICATION_SCHEMA = z.looseObject({
  id: z.string(),
  recipient: z.string(),
  author: z.string(),
  summary: z.string(),
  state: z.string(),
})

export const AUTO_POST_SCHEMA = z.looseObject({
  running: z.boolean(),
  tickSeconds: z.number(),
  maxPerHour: z.number(),
  settings: z.array(z.looseObject({ preset: z.string(), enabled: z.boolean(), everyMinutes: z.number() })),
})

export const BOARD_REF_SCHEMA = z.looseObject({ id: z.string(), title: z.string() })

export const CATALOG_REQUEST = z.looseObject({
  boardId: z.string().optional(),
  query: z.string().optional(),
  tag: z.string().optional(),
  sort: z.string().optional(),
})

export const POST_REQUEST = z.looseObject({ postId: z.string(), reader: z.string().optional() })

export const PUBLISH_REQUEST = z.looseObject({
  boardId: z.string(),
  author: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()).optional(),
  notifyMode: z.string().optional(),
})

export const COMMENT_REQUEST = z.looseObject({
  postId: z.string(),
  parentCommentId: z.string().optional(),
  author: z.string(),
  body: z.string(),
  notifyMode: z.string().optional(),
})

export const VOTE_REQUEST = z.looseObject({
  subjectKind: z.string(),
  subjectId: z.string(),
  actor: z.string(),
  value: z.string(),
})

export const PIN_REQUEST = z.looseObject({ postId: z.string(), pinned: z.boolean(), reader: z.string().optional() })

export const INBOX_REQUEST = z.looseObject({ recipient: z.string(), state: z.string().optional() })

export const MARK_REQUEST = z.looseObject({ recipient: z.string(), id: z.string().optional(), all: z.boolean().optional() })

export const AUTO_POST_REQUEST = z.looseObject({
  settings: z.array(z.looseObject({
    preset: z.string(),
    enabled: z.boolean(),
    everyMinutes: z.number(),
  })).optional(),
})

export const BOARD_REQUEST = z.looseObject({ workspaceId: z.string(), path: z.string() })

/** Host service key owning these endpoints; the wire namespace is `forum`. 拥有这些端点的宿主服务键；线路命名空间为 `forum`。 */
const SERVICE = 'forum'

/** One strict codec over a Zod factory. 包在 Zod 工厂外的一只严格 codec。 */
function codec(typeSymbol: string, create: () => z.ZodType): TypertRemoteCodecSpec {
  return { mode: 'strict', typeSymbol, create }
}

/** One required parameter, keyed by its Host parameter name. 一个必填参数，按宿主参数名取键。 */
export function parameter(name: string, typeSymbol: string, create: () => z.ZodType): TypertRemoteParameterSpec {
  const spec = codec(typeSymbol, create)
  return { name, wire: name, source: 'json', codec: spec, strictCodec: spec }
}

/** One direct invocation with one parameter and one result. 一次直连调用：一个参数、一个结果。 */
export function method(
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
