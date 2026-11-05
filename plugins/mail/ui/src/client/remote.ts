/**
 * The browser-side Remote definition for the `mail` namespace.
 *
 * The Web client reaches Host services through a Remote contribution mounted
 * with `ctx.remote.$mount`; the shipped contributions are generated inside the
 * Harness checkout and this package lives outside it, so
 * `createTypertRemoteInfo` builds the same contribution by hand. This file is
 * the one client-side counterpart of the Host's `mail` gateway endpoints.
 *
 * `mail` 命名空间的浏览器侧远端定义。
 *
 * Web 客户端通过 `ctx.remote.$mount` 挂载的 Remote contribution 访问宿主服务；随发行版
 * 交付的 contribution 在 Harness 检出仓库内生成，而本包在其之外，因此用
 * `createTypertRemoteInfo` 手工构造同样的 contribution。本文件是宿主 `mail` 网关端点的
 * 唯一客户端对应物。
 *
 * @module @veren/mail-ui/client/remote
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * The view types live in exactly one place — the Host source — so this module
 * forwards them instead of restating the same shapes. `import type` is erased
 * by esbuild at bundle time, so no server code reaches the client bundle.
 *
 * 视图类型只有一份：直接引宿主源码的那份声明，因此本模块只做转发而不复述同形接口。
 * `import type` 在打包时被 esbuild 整条擦除，客户端不会因此把服务端代码打进来。
 */
import type { MessageView, RunView, StepView } from '../../../core/src/index.ts'

export type { MessageView, RunView, StepView }

/** One Remote call result: the committed value, or the Host's structured refusal. */
export type MailRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** What one snapshot holds. / 一份快照所持有的内容。 */
export interface MailSnapshot {
  /** The station inbox, newest first. / 站内收件箱，最新在前。 */
  readonly messages: readonly MessageView[]
  /** The execution chains, newest first. / 执行链，最新在前。 */
  readonly runs: readonly RunView[]
  /** Whether the snapshot has ever loaded successfully. / 快照是否曾成功加载过。 */
  readonly settled: boolean
  /** The load state. / 加载状态。 */
  readonly status: 'loading' | 'ready' | 'error'
  /** The last error message. / 最近一次错误消息。 */
  readonly error: string
}

/** Everything the page's inject face supplies: one observable and callbacks. */
export interface MailPanelInjected {
  /** The mail observable, bound as `useMail`. */
  readonly hooks: {
    readonly mail: HostObservable<MailSnapshot>
  }
  /** Re-read the snapshot. */
  readonly onRefresh: () => void
  /** Mark one message read, unread, archived, or unarchived. */
  readonly onMark: (messageId: string, action: 'read' | 'unread' | 'archive' | 'unarchive') => void
}

/** The mounted `ctx.remote.mail` surface. */
export interface MailRemoteApi {
  /** The messages and the execution chains, in one read. */
  readonly catalog: (request: { readonly limit?: number }) => Promise<MailRemoteResult<{ readonly messages: MessageView[]; readonly runs: RunView[] }>>
  /** One message's visible state, wrapped so an absent message stays representable. */
  readonly markMessage: (request: {
    readonly messageId: string
    readonly action: 'read' | 'unread' | 'archive' | 'unarchive'
  }) => Promise<MailRemoteResult<{ readonly message?: MessageView }>>
}

/** The request shape one method takes. / 一个方法所用的请求形状。 */
const EMPTY_REQUEST = z.looseObject({})

/** The message list result. / 消息列表结果。 */
const CATALOG_RESULT = z.looseObject({
  messages: z.array(z.looseObject({
    messageId: z.string(),
    subscriberId: z.string(),
    channel: z.string(),
    subject: z.string().optional(),
    content: z.string(),
    status: z.string(),
    seen: z.boolean(),
    read: z.boolean(),
    archived: z.boolean(),
    createdAt: z.number(),
  })),
  runs: z.array(z.looseObject({
    runId: z.string(),
    transactionId: z.string(),
    workflowName: z.string(),
    status: z.string(),
    recipientCount: z.number(),
    startedAt: z.number(),
    finishedAt: z.number().optional(),
    steps: z.array(z.looseObject({
      jobId: z.string(),
      subscriberId: z.string(),
      stepId: z.string(),
      state: z.string(),
      skipReason: z.string().optional(),
    })),
  })),
})

/** One marked message, wrapped so an absent message stays representable. / 一条被标记的消息；包裹形状使「消息不存在」可表示。 */
const MARK_RESULT = z.looseObject({
  message: z.looseObject({
    messageId: z.string(),
    subscriberId: z.string(),
    channel: z.string(),
    subject: z.string().optional(),
    content: z.string(),
    status: z.string(),
    seen: z.boolean(),
    read: z.boolean(),
    archived: z.boolean(),
    createdAt: z.number(),
  }).optional(),
})

/** The mark request. / 标记请求。 */
const MARK_REQUEST = z.looseObject({
  messageId: z.string(),
  action: z.enum(['read', 'unread', 'archive', 'unarchive']),
})

/** The service name the Host's gateway is registered under. / 宿主网关注册所用的服务名。 */
const SERVICE = 'mailGateway'

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
    [`mail/${exportName}`]: {
      service: SERVICE,
      description,
      invocation: { kind: 'direct' },
      parameters: [...parameters],
      result: codec(`mail:${typeSymbol}:result`, result),
    },
  }
}

export const mailRemote = createTypertRemoteInfo({
  package: '@veren/mail',
  methods: {
    ...method('catalog', 'The station inbox and the execution chains, in one read.', 'catalog', [
      parameter('request', 'mail:catalog:request', () => EMPTY_REQUEST),
    ], () => CATALOG_RESULT),
    ...method('markMessage', 'Change one message\'s visible state.', 'markMessage', [
      parameter('request', 'mail:markMessage:request', () => MARK_REQUEST),
    ], () => MARK_RESULT),
  } as Record<string, never>,
}, z)
