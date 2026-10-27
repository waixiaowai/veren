/**
 * The browser-side Remote definition for the `im` namespace.
 *
 * The Web client reaches Host services through a Remote contribution mounted
 * with `ctx.remote.$mount`; the shipped contributions are generated inside the
 * Harness checkout and this package lives outside it, so `createTypertRemoteInfo`
 * builds the same contribution by hand. This file is the one client-side
 * counterpart of the host's `gateway-remote.ts` endpoints.
 *
 * `im` 命名空间的浏览器侧远端定义。
 *
 * Web 客户端通过 `ctx.remote.$mount` 挂载的 Remote contribution 访问宿主服务；随发行版
 * 交付的 contribution 在 Harness 检出仓库内生成，而本包在其之外，因此用
 * `createTypertRemoteInfo` 手工构造同样的 contribution。本文件是宿主 `gateway-remote.ts`
 * 端点的唯一客户端对应物。
 *
 * @module @veren/im-ui/client/remote
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * 视图类型只有一份：直接引宿主源码的那份声明，不再在此处抄一遍同形接口。
 * `import type` 在打包时被 esbuild 整条擦除，客户端不会因此把服务端代码打进来。
 *
 * The view types live in exactly one place — the Host source — so this module
 * forwards them instead of restating the same shapes. `import type` is erased
 * by esbuild at bundle time, so no server code reaches the client bundle.
 */
import type { ImAccount, ImPersonView } from '../../../core/src/index.ts'
import type { ImIntakeStatusView } from '../../../core/src/intake-types.ts'

export type { ImAccount, ImPersonView, ImIntakeStatusView }

/** One conversation's queue state as the conversations tab renders it. */
export interface ImConversationView {
  readonly accountId: string
  readonly conversationId: string
  readonly pending: number
  readonly lastStatus?: 'queued' | 'consuming' | 'replied' | 'failed' | 'dead'
  readonly lastReceivedAt?: number
  readonly lastExcerpt?: string
}

/** A Remote call result: the committed value, or the Host's structured refusal. */
export type ImRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** One authorization attempt as the bind wizard renders it. */
export interface BindWizardView {
  readonly bindId: string
  readonly status: 'pending' | 'scanned' | 'needs-code' | 'bound' | 'expired' | 'failed'
  readonly qrDataUrl?: string
  readonly expiresAt?: number
  readonly account?: ImAccount
  readonly error?: { readonly code: string; readonly message: string }
}

/** Everything the page renders from the Host in one read. */
export interface ImCatalog {
  readonly accounts: readonly ImAccount[]
  readonly conversations: readonly ImConversationView[]
  readonly people: readonly ImPersonView[]
  readonly intake: ImIntakeStatusView
}

/** The page's snapshot: the catalog plus the bind wizard's live state. */
export interface ImSnapshot {
  readonly catalog: ImCatalog
  /** `loading` is republished only before the first successful read. */
  readonly status: 'loading' | 'ready' | 'error'
  /** Whether an authoritative read has ever succeeded. */
  readonly settled: boolean
  readonly error: string
  /** The bind wizard; `active: false` means the card is closed. */
  readonly bind: BindWizardView | undefined
}

/** Everything the page's inject face supplies: one observable and callbacks. */
export interface ImPanelInjected {
  /** The IM observable, bound as `useIm`. */
  readonly hooks: {
    readonly im: HostObservable<ImSnapshot>
  }
  readonly onStartBind: () => void
  readonly onCloseBind: () => void
  readonly onSubmitCode: (code: string) => void
  readonly onUnbindAccount: (accountId: string) => void
  readonly onRenamePerson: (personId: string, displayName: string) => void
  readonly onRefresh: () => void
}

/** The mounted `ctx.remote.im` surface. */
export interface ImRemoteApi {
  readonly catalog: (request: { readonly intakeLimit?: number }) => Promise<ImRemoteResult<ImCatalog>>
  readonly beginBind: (request: { readonly provider?: string; readonly label?: string }) => Promise<ImRemoteResult<BindWizardView>>
  readonly pollBind: (request: { readonly bindId: string }) => Promise<ImRemoteResult<BindWizardView>>
  readonly submitBindCode: (request: { readonly bindId: string; readonly code: string }) => Promise<ImRemoteResult<BindWizardView>>
  readonly unbindAccount: (request: { readonly accountId: string }) => Promise<ImRemoteResult<{ readonly unbound: string }>>
  readonly people: (request: { readonly query?: string }) => Promise<ImRemoteResult<{ readonly people: readonly ImPersonView[] }>>
  readonly renamePerson: (request: {
    readonly personId: string
    readonly displayName: string
  }) => Promise<ImRemoteResult<{ readonly person: ImPersonView }>>
  readonly intakeStatus: (request: { readonly limit?: number }) => Promise<ImRemoteResult<{ readonly intake: ImIntakeStatusView }>>
}

// ---- 请求/结果 schema（looseObject：宿主加字段不弄挂客户端）----
// ---- request/result schemas (looseObject: host additions cannot break the page) ----

const CATALOG_REQUEST = z.looseObject({})
const BEGIN_REQUEST = z.looseObject({ provider: z.string().optional(), label: z.string().optional() })
const BINDID_REQUEST = z.looseObject({ bindId: z.string() })
const CODE_REQUEST = z.looseObject({ bindId: z.string(), code: z.string() })
const UNBIND_ACCOUNT_REQUEST = z.looseObject({ accountId: z.string() })
const PEOPLE_REQUEST = z.looseObject({ query: z.string().optional() })
const RENAME_REQUEST = z.looseObject({ personId: z.string(), displayName: z.string() })
const INTAKE_REQUEST = z.looseObject({ limit: z.number().optional() })

const ACCOUNT_SCHEMA = z.looseObject({
  id: z.string(), provider: z.string(), displayName: z.string(), status: z.string().optional(),
})
const CONVERSATION_SCHEMA = z.looseObject({
  accountId: z.string(), conversationId: z.string(), pending: z.number(),
  lastStatus: z.string().optional(), lastReceivedAt: z.number().optional(), lastExcerpt: z.string().optional(),
})
const PERSON_SCHEMA = z.looseObject({
  id: z.string(), displayName: z.string(), identityStatus: z.string().optional(),
  claimedName: z.string().optional(),
})
const INTAKE_SCHEMA = z.looseObject({
  enabled: z.boolean(), askText: z.string().optional(), counts: z.record(z.string(), z.number()).optional(),
  recent: z.array(z.looseObject({
    personId: z.string(), personName: z.string(), status: z.string(),
    askedAt: z.number(), accountAt: z.string().optional(), provider: z.string().optional(),
  })).optional(),
})
const CATALOG_SCHEMA = z.looseObject({
  accounts: z.array(ACCOUNT_SCHEMA),
  conversations: z.array(CONVERSATION_SCHEMA),
  people: z.array(PERSON_SCHEMA),
  intake: INTAKE_SCHEMA,
})
const BIND_SCHEMA = z.looseObject({
  bindId: z.string(), status: z.string(), qrDataUrl: z.string().optional(),
  expiresAt: z.number().optional(),
  account: ACCOUNT_SCHEMA.optional(),
  error: z.looseObject({ code: z.string(), message: z.string() }).optional(),
})
const PEOPLE_RESULT = z.looseObject({ people: z.array(PERSON_SCHEMA) })
const RENAME_RESULT = z.looseObject({ person: PERSON_SCHEMA })
const INTAKE_RESULT = z.looseObject({ intake: INTAKE_SCHEMA })

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
    [`im/${exportName}`]: {
      service: 'imGateway',
      description,
      invocation: { kind: 'direct' },
      parameters: [...parameters],
      result: codec(`im:${typeSymbol}:result`, result),
    },
  }
}

export const imRemote = createTypertRemoteInfo({
  package: '@veren/im',
  methods: {
    ...method('catalog', 'One snapshot: accounts, conversations, people, intake.', 'catalog', [
      parameter('request', 'im:catalog:request', () => CATALOG_REQUEST),
    ], () => CATALOG_SCHEMA),
    ...method('beginBind', 'Start a QR authorization; the QR rides back as a data URL.', 'beginBind', [
      parameter('request', 'im:beginBind:request', () => BEGIN_REQUEST),
    ], () => BIND_SCHEMA),
    ...method('pollBind', 'Poll one authorization attempt.', 'pollBind', [
      parameter('request', 'im:pollBind:request', () => BINDID_REQUEST),
    ], () => BIND_SCHEMA),
    ...method('submitBindCode', 'Submit a verify code for a needs-code attempt.', 'submitBindCode', [
      parameter('request', 'im:submitBindCode:request', () => CODE_REQUEST),
    ], () => BIND_SCHEMA),
    ...method('unbindAccount', 'Remove an account with its credential.', 'unbindAccount', [
      parameter('request', 'im:unbindAccount:request', () => UNBIND_ACCOUNT_REQUEST),
    ], () => z.looseObject({ unbound: z.string() })),
    ...method('people', 'List or search the people directory.', 'people', [
      parameter('request', 'im:people:request', () => PEOPLE_REQUEST),
    ], () => PEOPLE_RESULT),
    ...method('renamePerson', 'Set one person display name (manual completion).', 'renamePerson', [
      parameter('request', 'im:renamePerson:request', () => RENAME_REQUEST),
    ], () => RENAME_RESULT),
    ...method('intakeStatus', 'Read the stranger-intake switch, counts, and audit.', 'intakeStatus', [
      parameter('request', 'im:intakeStatus:request', () => INTAKE_REQUEST),
    ], () => INTAKE_RESULT),
  } as Record<string, never>,
}, z)
