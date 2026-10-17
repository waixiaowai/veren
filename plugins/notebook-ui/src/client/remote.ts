/**
 * The browser-side Remote definition for the `notebook` namespace.
 *
 * The Web client reaches Host services through a Remote contribution mounted
 * with `ctx.remote.$mount`. The shipped contributions are generated from each
 * Host package's type model; this package lives outside that workspace, so it
 * builds the same contribution by hand with `createTypertRemoteInfo`. This file
 * is therefore the one client-side counterpart of the Host endpoints.
 *
 * 记事本的浏览器侧远端定义：`notebook` 命名空间。
 *
 * Web 客户端通过 `ctx.remote.$mount` 挂载的 Remote contribution 访问宿主服务。随发行版
 * 交付的 contribution 由各宿主包的类型模型生成；本包在检出仓库之外，因此用
 * `createTypertRemoteInfo` 手工构造同样的 contribution。于是本文件是宿主端点的唯一客户端
 * 对应物。
 *
 * @module @veren/notebook-ui/client/remote
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'

/** Longest title the Host accepts; keep in step with `@veren/notebook`. */
export const MAX_TITLE_CHARS = 200

/** Longest body the Host accepts; keep in step with `@veren/notebook`. */
export const MAX_BODY_CHARS = 100_000

/** One preset that owns a notebook, declared or remembered by its notes. */
export interface OwnerView {
  readonly id: string
  readonly declared: boolean
  readonly noteCount: number
}

/** One note as the page reads it. */
export interface NoteView {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** A Remote call result: the committed value, or the Host's structured refusal. */
export type NotebookRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The mounted `ctx.remote.notebook` surface. */
export interface NotebookRemoteApi {
  /** List every preset with a notebook. */
  readonly owners: (request: Record<string, never>) => Promise<NotebookRemoteResult<readonly OwnerView[]>>
  /** Read one preset's notes, newest update first. */
  readonly list: (request: { readonly owner: string }) => Promise<NotebookRemoteResult<readonly NoteView[]>>
  /** Write one note into one preset's notebook. */
  readonly create: (request: {
    readonly owner: string
    readonly title: string
    readonly body: string
  }) => Promise<NotebookRemoteResult<NoteView>>
  /** Replace fields of one note in one preset's notebook. */
  readonly update: (request: {
    readonly owner: string
    readonly id: string
    readonly title?: string
    readonly body?: string
    readonly expectedUpdatedAt?: string
  }) => Promise<NotebookRemoteResult<NoteView>>
  /** Delete one note from one preset's notebook. */
  readonly remove: (request: {
    readonly owner: string
    readonly id: string
  }) => Promise<NotebookRemoteResult<{ readonly deleted: boolean }>>
}

/**
 * Result and parameter schemas stay loose on purpose: the Host owns the fields,
 * and the page must keep rendering after the Host adds one. A strict schema
 * here would turn an additive Host change into a client-side parse failure.
 */
const OWNER_SCHEMA = z.looseObject({
  id: z.string(),
  declared: z.boolean(),
  noteCount: z.number(),
})

const NOTE_SCHEMA = z.looseObject({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const OWNERS_REQUEST = z.looseObject({})
const LIST_REQUEST = z.looseObject({ owner: z.string() })
const CREATE_REQUEST = z.looseObject({ owner: z.string(), title: z.string(), body: z.string() })
const UPDATE_REQUEST = z.looseObject({
  owner: z.string(),
  id: z.string(),
  title: z.string().optional(),
  body: z.string().optional(),
  expectedUpdatedAt: z.string().optional(),
})
const REMOVE_REQUEST = z.looseObject({ owner: z.string(), id: z.string() })

/** Host service key owning these endpoints; the wire namespace is `notebook`. */
const SERVICE = 'notebook'

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
    [`notebook/${exportName}`]: {
      service: SERVICE,
      description,
      invocation: { kind: 'direct' },
      parameters: [...parameters],
      result: codec(`notebook:${typeSymbol}:result`, result),
    },
  }
}

export const notebookRemote = createTypertRemoteInfo({
  package: '@veren/notebook',
  methods: {
    ...method('owners', 'List every preset with a notebook.', 'owners', [
      parameter('request', 'notebook:owners:request', () => OWNERS_REQUEST),
    ], () => z.array(OWNER_SCHEMA)),
    ...method('list', 'Read one preset\u2019s notes, newest update first.', 'list', [
      parameter('request', 'notebook:list:request', () => LIST_REQUEST),
    ], () => z.array(NOTE_SCHEMA)),
    ...method('create', 'Write one note into one preset\u2019s notebook.', 'create', [
      parameter('request', 'notebook:create:request', () => CREATE_REQUEST),
    ], () => NOTE_SCHEMA),
    ...method('update', 'Replace fields of one note in one preset\u2019s notebook.', 'update', [
      parameter('request', 'notebook:update:request', () => UPDATE_REQUEST),
    ], () => NOTE_SCHEMA),
    ...method('remove', 'Delete one note from one preset\u2019s notebook.', 'remove', [
      parameter('request', 'notebook:remove:request', () => REMOVE_REQUEST),
    ], () => z.looseObject({ deleted: z.boolean() })),
  } as Record<string, never>,
}, z)
