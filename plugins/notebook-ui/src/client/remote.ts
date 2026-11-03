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
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Longest title the Host accepts; keep in step with `@veren/notebook`. */
export const MAX_TITLE_CHARS = 200

/** Longest body the Host accepts; keep in step with `@veren/notebook`. */
export const MAX_BODY_CHARS = 100_000

/**
 * 视图类型只有一份：直接引宿主源码的那份声明，不再在此处抄一遍同形接口。
 * `import type` 在打包时被 esbuild 整条擦除，客户端不会因此把服务端代码打进来。
 *
 * The view types live in exactly one place — the Host source — so this module
 * forwards them instead of restating the same shapes. `import type` is erased
 * by esbuild at bundle time, so no server code reaches the client bundle.
 */
import type {
  BoxGraphView, CanvasEdgeView, CanvasNodeView, CardLinkView, FleetingAging, HubView, LinkCountView,
  NoteKind, NoteView, OwnerView,
} from '../../../notebook/src/types.ts'

export type { BoxGraphView, CanvasEdgeView, CanvasNodeView, CardLinkView, FleetingAging, HubView, LinkCountView, NoteKind, NoteView, OwnerView }

/** A Remote call result: the committed value, or the Host's structured refusal. */
export type NotebookRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The create payload the page builds. */
export interface NewNoteInput {
  readonly owner: string
  readonly title: string
  readonly body: string
}

/** The update payload the page builds. */
export interface UpdateNoteInput {
  readonly owner: string
  readonly id: string
  readonly title: string
  readonly body: string
  readonly expectedUpdatedAt?: string
}

/** Everything the page renders from the Host. */
export interface NotebookSnapshot {
  /** Presets with a notebook, including ones the registry no longer declares. */
  readonly owners: readonly OwnerView[]
  /** The notebook currently on screen. */
  readonly owner: string | undefined
  /** That owner's notes, newest update first. */
  readonly notes: readonly NoteView[]
  /** That owner's whole graph face: nodes, edges, riddles, stats — the canvas's and the badges' one read. 某归属的整张图面：节点、边、谜面与读数——画布与角标的一次读。 */
  readonly graph: BoxGraphView | undefined
  /** `loading` is republished only before the first successful read. */
  readonly status: 'loading' | 'ready' | 'error'
  /** Whether an authoritative read has ever succeeded. */
  readonly settled: boolean
  /** The last failure's message, for the page's error line. */
  readonly error: string
}

/** Everything the page's inject face supplies: one observable and callbacks. */
export interface NotebookPanelInjected {
  /** The notebook observable, bound as `useNotebook`. */
  readonly hooks: {
    readonly notebook: HostObservable<NotebookSnapshot>
  }
  /** Choose whose notebook is on screen. */
  readonly onSelect: (owner: string) => void
  /** Re-read the owner list and the selected notebook. */
  readonly onRefresh: () => void
  /** Write one note into the selected notebook. */
  readonly onCreate: (input: NewNoteInput) => Promise<NoteView>
  /** Replace fields of one note in the selected notebook. */
  readonly onUpdate: (input: UpdateNoteInput) => Promise<NoteView>
  /** Delete one note from the selected notebook. */
  readonly onRemove: (input: { readonly owner: string; readonly id: string }) => Promise<{ readonly deleted: boolean }>
  /** Promote one fleeting card into a permanent card under the full write-time discipline. 按完整写入纪律把一张闪念炼成永久卡。 */
  readonly onPromote: (input: {
    readonly owner: string
    readonly id: string
  }) => Promise<NoteView>
  /** Read one card's outgoing and incoming links. 读一张卡的出链与入链。 */
  readonly onCardLinks: (input: { readonly owner: string; readonly id: string }) => Promise<CardLinkView>
  /** Export the selected notebook as one markdown download. 把选中的盒导出为一份 markdown 下载。 */
  readonly onExport: (owner: string) => Promise<{ readonly count: number }>
}

/** The mounted `ctx.remote.notebook` surface. */
export interface NotebookRemoteApi {
  /** List every preset with a notebook. */
  readonly owners: (request: Record<string, never>) => Promise<NotebookRemoteResult<readonly OwnerView[]>>
  /** Read one preset's notes, newest update first. */
  readonly list: (request: { readonly owner: string }) => Promise<NotebookRemoteResult<readonly NoteView[]>>
  /** Export one notebook as one portable markdown document. 把一本盒导出为单份可携带 markdown。 */
  readonly exportAll: (request: { readonly owner: string }) => Promise<NotebookRemoteResult<{ readonly count: number; readonly markdown: string }>>
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
  readonly deleteNote: (request: {
    readonly owner: string
    readonly id: string
  }) => Promise<NotebookRemoteResult<{ readonly deleted: boolean }>>
  /** Promote one fleeting card into a permanent card. 把一张闪念炼成永久卡。 */
  readonly promoteNote: (request: {
    readonly owner: string
    readonly id: string
  }) => Promise<NotebookRemoteResult<NoteView>>
  /** Read one owner's whole graph face in one call. 一次读出某归属的整张图面。 */
  readonly boxGraph: (request: { readonly owner: string }) => Promise<NotebookRemoteResult<BoxGraphView>>
  /** Read one card's outgoing and incoming links. 读一张卡的出链与入链。 */
  readonly cardLinks: (request: {
    readonly owner: string
    readonly id: string
  }) => Promise<NotebookRemoteResult<CardLinkView>>
  /** Read one owner's most-linked cards — the box's entry points. 读某归属被链接最多的卡片——盒的入口。 */
  readonly hubs: (request: { readonly owner: string }) => Promise<NotebookRemoteResult<readonly HubView[]>>
  /** Count inbound links per card title. 按标题统计入链数。 */
  readonly linkCounts: (request: { readonly owner: string }) => Promise<NotebookRemoteResult<readonly LinkCountView[]>>
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
  // Optional on the wire so a page can still read an older Host's roster; the
  // election treats a missing value as "no activity yet".
  // 线上可选，让页面仍能读旧宿主的归属名册；选举把缺失值当作「暂无活跃」。
  lastActiveAt: z.string().optional(),
})

const NOTE_SCHEMA = z.looseObject({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const GRAPH_NODE_SCHEMA = z.looseObject({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  inbound: z.number(),
  outbound: z.number(),
})

const BOX_GRAPH_SCHEMA = z.looseObject({
  nodes: z.array(GRAPH_NODE_SCHEMA),
  edges: z.array(z.looseObject({ sourceId: z.string(), targetId: z.string() })),
  riddles: z.array(z.looseObject({ aId: z.string(), bId: z.string(), shared: z.number() })),
  stats: z.looseObject({}),
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
const CARD_LINKS_REQUEST = z.looseObject({ owner: z.string(), id: z.string() })
const OWNER_REQUEST = z.looseObject({ owner: z.string() })

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
    ...method('deleteNote', 'Delete one note from one preset\u2019s notebook.', 'deleteNote', [
      parameter('request', 'notebook:deleteNote:request', () => REMOVE_REQUEST),
    ], () => z.looseObject({ deleted: z.boolean() })),
    ...method('promoteNote', 'Promote one fleeting card into a permanent card.', 'promoteNote', [
      parameter('request', 'notebook:promoteNote:request', () => REMOVE_REQUEST),
    ], () => NOTE_SCHEMA),
    ...method('boxGraph', 'Read one owner\u2019s whole graph face in one call.', 'boxGraph', [
      parameter('request', 'notebook:boxGraph:request', () => OWNER_REQUEST),
    ], () => BOX_GRAPH_SCHEMA),
    ...method('cardLinks', 'Read one card\u2019s outgoing and incoming links.', 'cardLinks', [
      parameter('request', 'notebook:cardLinks:request', () => CARD_LINKS_REQUEST),
    ], () => z.looseObject({
      outgoing: z.array(z.looseObject({ targetId: z.string(), targetTitle: z.string() })),
      incoming: z.array(z.looseObject({ sourceId: z.string(), sourceTitle: z.string(), excerpt: z.string() })),
    })),
    ...method('hubs', 'Read one owner\u2019s most-linked cards.', 'hubs', [
      parameter('request', 'notebook:hubs:request', () => OWNER_REQUEST),
    ], () => z.array(z.looseObject({ id: z.string(), title: z.string(), inboundCount: z.number() }))),
    ...method('linkCounts', 'Count inbound links per card title.', 'linkCounts', [
      parameter('request', 'notebook:linkCounts:request', () => OWNER_REQUEST),
    ], () => z.array(z.looseObject({ title: z.string(), count: z.number() }))),
    ...method('exportAll', 'Export one notebook as one portable markdown document.', 'exportAll', [
      parameter('request', 'notebook:exportAll:request', () => OWNER_REQUEST),
    ], () => z.looseObject({ count: z.number(), markdown: z.string() })),
  } as Record<string, never>,
}, z)
