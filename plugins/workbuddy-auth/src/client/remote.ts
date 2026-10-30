/**
 * `workbuddyAuth` 命名空间的浏览器侧远端定义。
 * 随发行版交付的 Remote contribution 在 Harness 检出仓库内生成，本包在其外，
 * 因此用 `createTypertRemoteInfo` 手工构造同样的 contribution（im-ui 同款）。
 * The browser-side Remote definition for the `workbuddyAuth` namespace, built
 * by hand with `createTypertRemoteInfo` because shipped contributions are
 * generated inside the Harness checkout (the im-ui approach).
 *
 * @module @veren/workbuddy-auth/client/remote
 */
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'

/** 一次远端调用结果：提交值，或宿主的结构化拒绝。One Remote result: the value, or the Host's structured refusal. */
export type WbRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly message: string; readonly code?: string } }

/** 卡片账号行（宿主已脱敏）。One card account row (already masked host-side). */
export interface WbAccount {
  readonly uid: string
  readonly name: string
  readonly region: 'cn' | 'global'
  readonly disabled: boolean
  readonly expired: boolean
  readonly cooldownRemainMs: number
  readonly enterprise: boolean
}

/** 登录面的自述。The sign-in face's describe. */
export interface WbDescribe {
  readonly provider: string
  readonly label: string
  readonly methods: readonly { readonly id: string; readonly label: string }[]
  readonly signedIn: boolean
  readonly inFlight: boolean
  readonly accounts: readonly WbAccount[]
}

/** 轮询快照。One poll snapshot. */
export interface WbPoll {
  readonly notices: readonly { readonly message: string; readonly url?: string }[]
  readonly prompt?: { readonly kind: 'text'; readonly message: string }
  readonly settled?: { readonly status: 'authorized' | 'cancelled' }
  readonly failed?: { readonly code?: string; readonly message: string }
  readonly inFlight: boolean
}

/** 余额答案。A credits answer. */
export interface WbCredits {
  readonly total: number
  readonly unlimited?: true
  readonly cycleResetTime?: string
  readonly accounts: readonly { readonly packageName: string; readonly remain: number; readonly size: number }[]
}

/** 探测结论。A probe verdict. */
export interface WbProbeOutcome {
  readonly validation: 'validating' | 'non-validating' | 'unknown'
  readonly efforts: readonly string[]
  readonly requests: number
  readonly reason?: string
}

function codec(typeSymbol: string, create: () => z.ZodType): TypertRemoteCodecSpec {
  return { mode: 'strict', typeSymbol, create }
}

/** 一个必填参数。One required parameter. */
function parameter(name: string, typeSymbol: string, create: () => z.ZodType): TypertRemoteParameterSpec {
  const spec = codec(typeSymbol, create)
  return { name, wire: name, source: 'json', codec: spec, strictCodec: spec }
}

/** 一次直接调用。One direct invocation. */
function method(
  exportName: string,
  description: string,
  typeSymbol: string,
  parameters: readonly TypertRemoteParameterSpec[],
  result: () => z.ZodType,
): Record<string, unknown> {
  return {
    [`workbuddyAuth/${exportName}`]: {
      service: 'workbuddyAuthGateway',
      description,
      invocation: { kind: 'direct' },
      parameters: [...parameters],
      result: codec(`workbuddyAuth:${typeSymbol}:result`, result),
    },
  }
}

const EMPTY_REQUEST = z.looseObject({})
const METHOD_REQUEST = z.looseObject({ method: z.string().optional() })
const UID_REQUEST = z.looseObject({ uid: z.string() })
const TOGGLE_REQUEST = z.looseObject({ uid: z.string(), disabled: z.boolean() })
const PROBE_REQUEST = z.looseObject({ uid: z.string(), model: z.string() })
const DESCRIBE_RESULT = z.looseObject({
  provider: z.string(),
  label: z.string(),
  methods: z.array(z.looseObject({ id: z.string(), label: z.string() })),
  signedIn: z.boolean(),
  inFlight: z.boolean(),
  accounts: z.array(z.looseObject({
    uid: z.string(), name: z.string(),
    region: z.enum(['cn', 'global']),
    disabled: z.boolean(), expired: z.boolean(),
    cooldownRemainMs: z.number(), enterprise: z.boolean(),
  })),
})
const POLL_RESULT = z.looseObject({
  notices: z.array(z.looseObject({ message: z.string(), url: z.string().optional() })),
  prompt: z.looseObject({ kind: z.enum(['text']), message: z.string() }).optional(),
  settled: z.looseObject({ status: z.enum(['authorized', 'cancelled']) }).optional(),
  failed: z.looseObject({ code: z.string().optional(), message: z.string() }).optional(),
  inFlight: z.boolean(),
})
const BEGIN_RESULT = z.looseObject({ started: z.boolean(), reason: z.string().optional() })
const BOOLEAN_RESULTS = {
  cancel: z.looseObject({ cancelled: z.boolean() }),
  signOut: z.looseObject({ signedOut: z.boolean() }),
  toggle: z.looseObject({ disabled: z.boolean() }),
}
const CREDITS_RESULT = z.looseObject({
  total: z.number(),
  unlimited: z.boolean().optional(),
  cycleResetTime: z.string().optional(),
  accounts: z.array(z.looseObject({ packageName: z.string(), remain: z.number(), size: z.number() })),
})
const PROBE_RESULT = z.looseObject({
  validation: z.enum(['validating', 'non-validating', 'unknown']),
  efforts: z.array(z.string()),
  requests: z.number(),
  reason: z.string().optional(),
})

/** 浏览器侧挂载的 `workbuddyAuth` contribution。The browser-mounted contribution. */
export const workbuddyAuthRemote = createTypertRemoteInfo({
  package: '@veren/workbuddy-auth',
  methods: {
    ...method('describe', 'One describe: the flow, both methods, sign-in state, the masked account table.', 'describe', [], () => DESCRIBE_RESULT),
    ...method('begin', 'Start one sign-in attempt, naming the region method.', 'begin', [
      parameter('request', 'workbuddyAuth:begin:request', () => METHOD_REQUEST),
    ], () => BEGIN_RESULT),
    ...method('poll', 'Poll one attempt: notices, the settlement or failure.', 'poll', [], () => POLL_RESULT),
    ...method('cancel', 'Withdraw the running attempt.', 'cancel', [], () => BOOLEAN_RESULTS.cancel),
    ...method('signOut', 'Sign one account out (all four classes erased).', 'signOut', [
      parameter('request', 'workbuddyAuth:signOut:request', () => UID_REQUEST),
    ], () => BOOLEAN_RESULTS.signOut),
    ...method('toggle', 'Enable or disable one account.', 'toggle', [
      parameter('request', 'workbuddyAuth:toggle:request', () => TOGGLE_REQUEST),
    ], () => BOOLEAN_RESULTS.toggle),
    ...method('credits', 'Fetch one account\u2019s remaining credits.', 'credits', [
      parameter('request', 'workbuddyAuth:credits:request', () => UID_REQUEST),
    ], () => CREDITS_RESULT),
    ...method('probe', 'Probe one model\u2019s reasoning efforts (consumes real credits).', 'probe', [
      parameter('request', 'workbuddyAuth:probe:request', () => PROBE_REQUEST),
    ], () => PROBE_RESULT),
  } as Record<string, never>,
}, z)

export type { WbProbeOutcome, WbCredits, WbDescribe, WbPoll, WbAccount, WbRemoteResult }
