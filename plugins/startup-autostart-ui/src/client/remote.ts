/**
 * The browser-side Remote definition for the `startup` namespace.
 *
 * The Web client reaches Host services through a Remote contribution mounted
 * with `ctx.remote.$mount`. The shipped contributions are generated from each
 * Host package's type model by `scripts/generate-typert.ts`; this package lives
 * outside that workspace, so it builds the same contribution by hand with
 * `createTypertRemoteInfo`, the constructor the generated artifacts call. That
 * makes this file the one place mirroring the Host endpoints, so a Host
 * signature change has exactly one client-side counterpart to follow.
 *
 * One entry here per Host parameter, in the Host's declaration order, keyed by
 * the Host's parameter name: `startup/create` takes `request`, `startup/run`
 * takes `request`, and `startup/catalog` takes none. A Host method with a
 * trailing `AbortSignal` instead declares `cancellation`; none of these five do.
 *
 * 启动自启动的浏览器侧远端定义：`startup` 命名空间。
 *
 * Web 客户端通过 `ctx.remote.$mount` 挂载的 Remote contribution 访问宿主服务。随发行版
 * 交付的 contribution 由 `scripts/generate-typert.ts` 从各宿主包的类型模型生成；本包在
 * 检出仓库之外，因此用 `createTypertRemoteInfo`（生成工件所调用的同一个构造函数）手工
 * 构造同样的 contribution。于是本文件成为镜像宿主端点的唯一位置：宿主签名一变，客户端
 * 只有这一处要跟着改。
 *
 * 这里每个宿主参数对应一个条目，顺序取宿主的声明顺序，键名取宿主的参数名：
 * `startup/create` 收 `request`，`startup/run` 收 `request`，`startup/catalog` 不收参数。
 * 宿主方法末尾若是 `AbortSignal` 则改为声明 `cancellation`；这五个方法都没有。
 *
 * @module @veren/startup-autostart/client/remote
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'

/** The four actions an item can perform. */
export const STARTUP_ACTIONS = ['new_session', 'resume_session', 'message_session', 'queue_message'] as const

/** One action name. */
export type StartupAction = (typeof STARTUP_ACTIONS)[number]

/** A model target an item can pin for a session it creates. */
export interface StartupModelTarget {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** The retained result of one delivery attempt. */
export interface StartupOutcome {
  readonly status: 'ok' | 'failed'
  readonly detail: string
  readonly at: string
}

/** Fields accepted when registering or editing an item. */
export interface StartupItemRequest {
  readonly name?: string
  readonly enabled?: boolean
  readonly action?: StartupAction
  readonly model?: StartupModelTarget
  readonly message?: string
  readonly sessionId?: string
  readonly cwd?: string
  readonly workspaceId?: string
  readonly preset?: string
}

/** One item as the Host reports it and the panel renders it. */
export interface StartupItemView {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly action: StartupAction
  readonly cwd?: string
  readonly workspaceId?: string
  readonly sessionId?: string
  readonly preset?: string
  readonly model?: StartupModelTarget
  readonly message?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastRunAt?: string
  readonly lastOutcome?: StartupOutcome
  readonly runCount: number
}

/** A Remote call result: the committed value, or the Host's structured refusal. */
export type StartupRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The mounted `ctx.remote.startup` surface. */
export interface StartupRemoteApi {
  /** Read every stored item. */
  readonly catalog: () => Promise<StartupRemoteResult<readonly StartupItemView[]>>
  /** Register one item. */
  readonly create: (request: StartupItemRequest) => Promise<StartupRemoteResult<StartupItemView>>
  /** Edit one item in place; an omitted field keeps its stored value. */
  readonly update: (request: StartupItemRequest & { readonly id: string })
    => Promise<StartupRemoteResult<StartupItemView>>
  /** Delete one item. */
  readonly delete: (request: { readonly id: string })
    => Promise<StartupRemoteResult<{ readonly id: string; readonly deleted: boolean }>>
  /** Run one item immediately, without waiting for the next start. */
  readonly run: (request: { readonly id: string; readonly force?: boolean })
    => Promise<StartupRemoteResult<{ readonly id: string; readonly outcome?: StartupOutcome }>>
}

/**
 * Result and parameter schemas stay loose on purpose: the Host owns the fields,
 * and the panel must keep rendering after the Host adds one. A strict schema
 * here would turn an additive Host change into a client-side parse failure.
 */
const MODEL_SCHEMA = z.looseObject({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string().optional(),
})

const OUTCOME_SCHEMA = z.looseObject({
  status: z.union([z.literal('ok'), z.literal('failed')]),
  detail: z.string(),
  at: z.string(),
})

const ITEM_SCHEMA = z.looseObject({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  action: z.enum(STARTUP_ACTIONS),
  model: MODEL_SCHEMA.optional(),
  lastOutcome: OUTCOME_SCHEMA.optional(),
})

const REQUEST_SCHEMA = z.looseObject({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  action: z.enum(STARTUP_ACTIONS).optional(),
  model: MODEL_SCHEMA.optional(),
  message: z.string().optional(),
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  workspaceId: z.string().optional(),
  preset: z.string().optional(),
})

/** Host service key owning these endpoints; the wire namespace is `startup`. */
const SERVICE = 'startupAutostart'

/** One strict codec over a Zod factory. */
function codec(typeSymbol: string, create: () => z.ZodType): TypertRemoteCodecSpec {
  return { mode: 'strict', typeSymbol, create }
}

/** One required parameter, keyed by its Host parameter name. */
function parameter(name: string, typeSymbol: string, create: () => z.ZodType): TypertRemoteParameterSpec {
  const spec = codec(typeSymbol, create)
  return { name, wire: name, source: 'json', codec: spec, strictCodec: spec }
}

export const startupRemote = createTypertRemoteInfo({
  package: '@veren/startup-autostart',
  methods: {
    'startup/catalog': {
      service: SERVICE,
      description: 'Read every stored startup item. Never activates a session and never reads session history.',
      invocation: { kind: 'direct' },
      parameters: [],
      result: codec('startup:catalog:result', () => z.array(ITEM_SCHEMA)),
    },
    'startup/create': {
      service: SERVICE,
      description: 'Register one startup item that runs on every successful start, with no debounce.',
      invocation: { kind: 'direct' },
      parameters: [parameter('request', 'startup:create:request', () => REQUEST_SCHEMA)],
      result: codec('startup:create:result', () => ITEM_SCHEMA),
    },
    'startup/update': {
      service: SERVICE,
      description: 'Edit one stored startup item in place; an omitted field keeps its stored value.',
      invocation: { kind: 'direct' },
      parameters: [parameter('request', 'startup:update:request', () => REQUEST_SCHEMA.extend({ id: z.string() }))],
      result: codec('startup:update:result', () => ITEM_SCHEMA),
    },
    'startup/delete': {
      service: SERVICE,
      description: 'Delete one startup item so it never triggers again.',
      invocation: { kind: 'direct' },
      parameters: [parameter('request', 'startup:delete:request', () => z.looseObject({ id: z.string() }))],
      result: codec('startup:delete:result', () => z.looseObject({ id: z.string(), deleted: z.boolean() })),
    },
    'startup/run': {
      service: SERVICE,
      description: 'Run one startup item immediately instead of waiting for the next start.',
      invocation: { kind: 'direct' },
      parameters: [parameter('request', 'startup:run:request', () => z.looseObject({
        id: z.string(),
        force: z.boolean().optional(),
      }))],
      result: codec('startup:run:result', () => z.looseObject({ id: z.string(), outcome: OUTCOME_SCHEMA.optional() })),
    },
  },
}, z)
