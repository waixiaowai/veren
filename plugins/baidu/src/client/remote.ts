/**
 * `baiduPan` 命名空间的浏览器侧远端定义。
 *
 * Web 客户端通过 `ctx.remote.$mount` 挂载的 Remote contribution 访问宿主服务；
 * 本包在 Harness 检出仓库之外，因此用 `createTypertRemoteInfo` 手工构造同样的
 * contribution。本文件是宿主 `src/gateway.ts` 端点的唯一客户端对应物——签名一
 * 变，只有这一处需要跟着改。视图类型只有一份：直接引服务端源码的那份声明，
 * `import type` 在打包时被 esbuild 整条擦除，客户端不会因此把服务端代码打进来。
 *
 * The browser-side Remote definition for the `baiduPan` namespace.
 *
 * The Web client reaches Host services through a Remote contribution mounted
 * with `ctx.remote.$mount`; this package lives outside the Harness checkout,
 * so `createTypertRemoteInfo` builds the same contribution by hand. This file
 * is the one client-side counterpart of the host's `src/gateway.ts` — a
 * signature change has exactly one counterpart to follow. View types live in
 * exactly one place — the server source — so this module forwards them instead
 * of restating shapes; `import type` is erased by esbuild at bundle time, so
 * no server code reaches the client bundle.
 *
 * @module @veren/baidu-pan/client/remote
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { RemoteResult, TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'
import type { AccountProfile, FileEntry, QuotaSnapshot, ShareReceipt } from '../types.ts'
import type { TransferJobSnapshot } from '../jobs.ts'
import type {
  AuthStateView, GatewayOutcome, JobStartedView, ListingView, SignInStartView, SignOutView,
} from '../gateway-views.ts'

export type { AccountProfile, FileEntry, QuotaSnapshot, ShareReceipt, TransferJobSnapshot }
export type { AuthStateView, GatewayOutcome, JobStartedView, ListingView, SignInStartView, SignOutView }

/**
 * 挂载后的 `ctx.remote.baiduPan` 面：载体信封（RemoteResult）之内再套一层
 * 业务信封（GatewayOutcome）——领域错误码折在内层，客户端两层都拆。
 * The mounted `ctx.remote.baiduPan` face: the carrier envelope (RemoteResult)
 * wraps the business envelope (GatewayOutcome) — domain codes fold into the
 * inner one, and the client unwraps both layers.
 */
export type BaiduApiResult<Value> = RemoteResult<GatewayOutcome<Value>>

/** The mounted `ctx.remote.baiduPan` surface. / 挂载后的 `ctx.remote.baiduPan` 面。 */
export interface BaiduPanRemoteApi {
  readonly authState: () => Promise<BaiduApiResult<AuthStateView>>
  readonly beginSignIn: () => Promise<BaiduApiResult<SignInStartView>>
  readonly submitSignInCode: (request: { readonly code: string }) => Promise<BaiduApiResult<AuthStateView>>
  readonly signOut: () => Promise<BaiduApiResult<SignOutView>>
  readonly whoami: () => Promise<BaiduApiResult<AccountProfile>>
  readonly quota: () => Promise<BaiduApiResult<QuotaSnapshot>>
  readonly list: (request: { readonly dir: string; readonly folderOnly?: boolean }) => Promise<BaiduApiResult<ListingView>>
  readonly search: (request: {
    readonly keyword: string
    readonly dir?: string
    readonly page?: number
    readonly num?: number
  }) => Promise<BaiduApiResult<{ readonly total: number; readonly entries: readonly FileEntry[] }>>
  readonly makeDir: (request: { readonly path: string }) => Promise<BaiduApiResult<{ readonly fsid: string; readonly path: string }>>
  readonly rename: (request: { readonly path: string; readonly newName: string }) => Promise<BaiduApiResult<{ readonly path: string }>>
  readonly transfer: (request: {
    readonly op: 'copy' | 'move'
    readonly sourcePath: string
    readonly destDir: string
    readonly newName?: string
  }) => Promise<BaiduApiResult<{ readonly path: string }>>
  readonly remove: (request: {
    readonly paths: readonly string[]
    readonly confirmPaths: readonly string[]
  }) => Promise<BaiduApiResult<{ readonly paths: readonly string[] }>>
  readonly share: (request: {
    readonly paths: readonly string[]
    readonly period?: number
    readonly password?: string
  }) => Promise<BaiduApiResult<ShareReceipt>>
  readonly startUpload: (request: {
    readonly localPath: string
    readonly remotePath: string
    readonly overwrite?: boolean
  }) => Promise<BaiduApiResult<JobStartedView>>
  readonly startDownload: (request: {
    readonly remotePath: string
    readonly localPath: string
  }) => Promise<BaiduApiResult<JobStartedView>>
  readonly job: (request: { readonly jobId: string }) => Promise<BaiduApiResult<TransferJobSnapshot>>
  readonly jobs: () => Promise<BaiduApiResult<{ readonly jobs: readonly TransferJobSnapshot[] }>>
}

// ---- 请求/结果 schema（looseObject：宿主加字段不弄挂客户端）----
// ---- request/result schemas (looseObject: host additions cannot break the page) ----

const CODE_REQUEST = z.looseObject({ code: z.string() })
const LIST_REQUEST = z.looseObject({ dir: z.string(), folderOnly: z.boolean().optional() })
const SEARCH_REQUEST = z.looseObject({
  keyword: z.string(), dir: z.string().optional(), page: z.number().optional(), num: z.number().optional(),
})
const PATH_REQUEST = z.looseObject({ path: z.string() })
const RENAME_REQUEST = z.looseObject({ path: z.string(), newName: z.string() })
const TRANSFER_REQUEST = z.looseObject({
  op: z.enum(['copy', 'move']), sourcePath: z.string(), destDir: z.string(), newName: z.string().optional(),
})
const REMOVE_REQUEST = z.looseObject({ paths: z.array(z.string()), confirmPaths: z.array(z.string()) })
const SHARE_REQUEST = z.looseObject({ paths: z.array(z.string()), period: z.number().optional(), password: z.string().optional() })
const UPLOAD_REQUEST = z.looseObject({ localPath: z.string(), remotePath: z.string(), overwrite: z.boolean().optional() })
const DOWNLOAD_REQUEST = z.looseObject({ remotePath: z.string(), localPath: z.string() })
const JOB_REQUEST = z.looseObject({ jobId: z.string() })

const FILE_ENTRY_SCHEMA = z.looseObject({
  fsid: z.string(), path: z.string(), name: z.string(), isDir: z.boolean(),
  size: z.number(), category: z.number(), md5: z.string(),
  serverMtime: z.number(), serverCtime: z.number(),
})
const AUTH_STATE_SCHEMA = z.looseObject({
  authorized: z.boolean(), expiresAt: z.string().optional(), expiring: z.boolean(), root: z.string(),
})
const SIGNIN_START_SCHEMA = z.looseObject({ url: z.string(), expiresInMinutes: z.number() })
const SIGNOUT_SCHEMA = z.looseObject({ signedOut: z.literal(true) })
const PROFILE_SCHEMA = z.looseObject({ uid: z.string(), displayName: z.string(), vipType: z.number() })
const QUOTA_SCHEMA = z.looseObject({
  totalBytes: z.number(), usedBytes: z.number(), freeBytes: z.number(), expireWithin7Days: z.boolean(),
})
const LISTING_SCHEMA = z.looseObject({ dir: z.string(), entries: z.array(FILE_ENTRY_SCHEMA) })
const SEARCH_SCHEMA = z.looseObject({ total: z.number(), entries: z.array(FILE_ENTRY_SCHEMA) })
const MKDIR_SCHEMA = z.looseObject({ fsid: z.string(), path: z.string() })
const PATH_RESULT_SCHEMA = z.looseObject({ path: z.string() })
const PATHS_RESULT_SCHEMA = z.looseObject({ paths: z.array(z.string()) })
const SHARE_SCHEMA = z.looseObject({
  link: z.string(), shortUrl: z.string().optional(), password: z.string(), period: z.number(),
})
const JOB_STARTED_SCHEMA = z.looseObject({ jobId: z.string() })
const JOB_SCHEMA = z.looseObject({
  id: z.string(), kind: z.string(), label: z.string(),
  phase: z.enum(['running', 'done', 'failed']),
  startedAt: z.number(), finishedAt: z.number().optional(),
  receipt: z.unknown().optional(),
  failure: z.looseObject({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
})
const JOBS_SCHEMA = z.looseObject({ jobs: z.array(JOB_SCHEMA) })

/**
 * 业务信封的运行时形状：ok 载 value，否则带稳定码的失败字段（全部可选，
 * 两分支共用一个 looseObject）。
 * The business envelope's runtime shape: ok carries value, otherwise the
 * stable-code failure fields (all optional; one looseObject for both arms).
 */
function outcomeSchema(value: () => z.ZodType): z.ZodType {
  return z.looseObject({
    ok: z.boolean(),
    value: value().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
    retryable: z.boolean().optional(),
  })
}

/** One strict codec over a Zod factory. */
function codec(typeSymbol: string, create: () => z.ZodType): TypertRemoteCodecSpec {
  return { mode: 'strict', typeSymbol, create }
}

/** One required parameter, keyed by its Host parameter name. */
function parameter(name: string, typeSymbol: string, create: () => z.ZodType): TypertRemoteParameterSpec {
  const spec = codec(typeSymbol, create)
  return { name, wire: name, source: 'json', codec: spec, strictCodec: spec }
}

/**
 * One direct invocation against the gateway. Zero-arg host methods MUST keep
 * an empty parameter table here, or zero-arg calls fail at runtime
 * ("expected 1 argument(s), got 0").
 * 面向网关服务的一次直接调用。宿主零参方法这里的参数表必须为空，否则零参
 * 调用在运行时报 "expected 1 argument(s), got 0"。
 */
function method(
  exportName: string,
  description: string,
  parameters: readonly TypertRemoteParameterSpec[],
  resultValue: () => z.ZodType,
): Record<string, unknown> {
  return {
    [`baiduPan/${exportName}`]: {
      service: 'baiduPanGateway',
      description,
      invocation: { kind: 'direct' },
      parameters: [...parameters],
      result: codec(`baiduPan:${exportName}:result`, () => outcomeSchema(resultValue)),
    },
  }
}

export const baiduPanRemote = createTypertRemoteInfo({
  package: '@veren/baidu-pan',
  methods: {
    ...method('authState', 'Local credential read: signed in or not, expiry, root.', [], () => AUTH_STATE_SCHEMA),
    ...method('beginSignIn', 'The authorize page URL for paste-code sign-in.', [], () => SIGNIN_START_SCHEMA),
    ...method('submitSignInCode', 'Exchange one pasted code, validate online, commit.', [
      parameter('request', 'baiduPan:submitSignInCode:request', () => CODE_REQUEST),
    ], () => AUTH_STATE_SCHEMA),
    ...method('signOut', 'Delete the credential record.', [], () => SIGNOUT_SCHEMA),
    ...method('whoami', 'The signed-in account profile.', [], () => PROFILE_SCHEMA),
    ...method('quota', 'The quota snapshot.', [], () => QUOTA_SCHEMA),
    ...method('list', 'One directory listing (guard-confined).', [
      parameter('request', 'baiduPan:list:request', () => LIST_REQUEST),
    ], () => LISTING_SCHEMA),
    ...method('search', 'Keyword search with server paging.', [
      parameter('request', 'baiduPan:search:request', () => SEARCH_REQUEST),
    ], () => SEARCH_SCHEMA),
    ...method('makeDir', 'Create a directory inside the root.', [
      parameter('request', 'baiduPan:makeDir:request', () => PATH_REQUEST),
    ], () => MKDIR_SCHEMA),
    ...method('rename', 'Rename one entry in place (bare name).', [
      parameter('request', 'baiduPan:rename:request', () => RENAME_REQUEST),
    ], () => PATH_RESULT_SCHEMA),
    ...method('transfer', 'Copy or move one entry into a destination directory.', [
      parameter('request', 'baiduPan:transfer:request', () => TRANSFER_REQUEST),
    ], () => PATH_RESULT_SCHEMA),
    ...method('remove', 'Guarded delete; the voucher must cover exactly the targets.', [
      parameter('request', 'baiduPan:remove:request', () => REMOVE_REQUEST),
    ], () => PATHS_RESULT_SCHEMA),
    ...method('share', 'Create one private share link.', [
      parameter('request', 'baiduPan:share:request', () => SHARE_REQUEST),
    ], () => SHARE_SCHEMA),
    ...method('startUpload', 'Accept an upload job; the id returns at once.', [
      parameter('request', 'baiduPan:startUpload:request', () => UPLOAD_REQUEST),
    ], () => JOB_STARTED_SCHEMA),
    ...method('startDownload', 'Accept a download job; the id returns at once.', [
      parameter('request', 'baiduPan:startDownload:request', () => DOWNLOAD_REQUEST),
    ], () => JOB_STARTED_SCHEMA),
    ...method('job', 'One transfer job snapshot.', [
      parameter('request', 'baiduPan:job:request', () => JOB_REQUEST),
    ], () => JOB_SCHEMA),
    ...method('jobs', 'Every transfer job snapshot (running first).', [], () => JOBS_SCHEMA),
  } as Record<string, never>,
}, z)
