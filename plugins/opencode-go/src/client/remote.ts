/**
 * `opencodeGo` 命名空间的浏览器侧远端定义。
 *
 * 随发行版交付的 Remote contribution 在 Harness 检出仓库内生成，而本包在其
 * 之外，因此用 `createTypertRemoteInfo` 手工构造同样的 contribution——这是
 * 宿主 `gateway-remote.ts` 端点的唯一客户端对应物（im-ui 同款做法）。
 *
 * The browser-side Remote definition for the `opencodeGo` namespace.
 *
 * Shipped Remote contributions are generated inside the Harness checkout and
 * this package lives outside it, so `createTypertRemoteInfo` builds the same
 * contribution by hand — the one client-side counterpart of the host's
 * `gateway-remote.ts` endpoints (the im-ui approach).
 *
 * @module @veren/opencode-go/client/remote
 */
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'

/** 一次远端调用结果：提交值，或宿主的结构化拒绝。One Remote call result: the committed value, or the Host's structured refusal. */
export type OgRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly message: string; readonly code?: string } }

/** 登录面的自述。The sign-in face's describe. */
export interface OgDescribe {
  readonly provider: string
  readonly label: string
  readonly methods: readonly { readonly id: string; readonly label: string }[]
  readonly signedIn: boolean
  readonly inFlight: boolean
}

/** 轮询快照：累计通知 + 待答提问 + 终局 + 是否进行中。One poll: accumulated notices + the open prompt + the settlement + in-flight. */
export interface OgPoll {
  readonly notices: readonly { readonly message: string; readonly url?: string }[]
  readonly prompt?: { readonly kind: 'text' | 'secret' | 'select'; readonly message: string; readonly placeholder?: string }
  readonly settled?: { readonly status: 'authorized' | 'cancelled' }
  readonly inFlight: boolean
}

function codec(typeSymbol: string, create: () => z.ZodType): TypertRemoteCodecSpec {
  return { mode: 'strict', typeSymbol, create }
}

/** 一个必填参数，键为宿主参数名。One required parameter, keyed by its Host parameter name. */
function parameter(name: string, typeSymbol: string, create: () => z.ZodType): TypertRemoteParameterSpec {
  const spec = codec(typeSymbol, create)
  return { name, wire: name, source: 'json', codec: spec, strictCodec: spec }
}

/** 一次直接调用：一个参数、一个结果。One direct invocation with one parameter and one result. */
function method(
  exportName: string,
  description: string,
  typeSymbol: string,
  parameters: readonly TypertRemoteParameterSpec[],
  result: () => z.ZodType,
): Record<string, unknown> {
  return {
    [`opencodeGo/${exportName}`]: {
      service: 'opencodeGoGateway',
      description,
      invocation: { kind: 'direct' },
      parameters: [...parameters],
      result: codec(`opencodeGo:${typeSymbol}:result`, result),
    },
  }
}

const EMPTY_REQUEST = z.looseObject({})
const METHOD_REQUEST = z.looseObject({ method: z.string().optional() })
const ANSWER_REQUEST = z.looseObject({ value: z.string() })
const DESCRIBE_RESULT = z.looseObject({
  provider: z.string(),
  label: z.string(),
  methods: z.array(z.looseObject({ id: z.string(), label: z.string() })),
  signedIn: z.boolean(),
  inFlight: z.boolean(),
})
const POLL_RESULT = z.looseObject({
  notices: z.array(z.looseObject({ message: z.string(), url: z.string().optional() })),
  prompt: z.looseObject({
    kind: z.enum(['text', 'secret', 'select']),
    message: z.string(),
    placeholder: z.string().optional(),
  }).optional(),
  settled: z.looseObject({ status: z.enum(['authorized', 'cancelled']) }).optional(),
  inFlight: z.boolean(),
})
const BEGIN_RESULT = z.looseObject({ status: z.string() })
const ANSWER_RESULT = z.looseObject({ answered: z.boolean() })
const CANCEL_RESULT = z.looseObject({ cancelled: z.boolean() })
const SIGNOUT_RESULT = z.looseObject({ signedOut: z.boolean() })

/** 浏览器侧挂载的 `opencodeGo` contribution。The browser-mounted `opencodeGo` contribution. */
export const opencodeGoRemote = createTypertRemoteInfo({
  package: '@veren/opencode-go',
  methods: {
    ...method('describe', 'One describe: the flow, both methods, sign-in state, in-flight.', 'describe', [], () => DESCRIBE_RESULT),
    ...method('begin', 'Start one sign-in attempt, optionally naming a method.', 'begin', [
      parameter('request', 'opencodeGo:begin:request', () => METHOD_REQUEST),
    ], () => BEGIN_RESULT),
    ...method('poll', 'Poll one attempt: notices, the open prompt, the settlement.', 'poll', [], () => POLL_RESULT),
    ...method('answer', 'Answer the open prompt (the key enters one way).', 'answer', [
      parameter('request', 'opencodeGo:answer:request', () => ANSWER_REQUEST),
    ], () => ANSWER_RESULT),
    ...method('cancel', 'Withdraw the running attempt.', 'cancel', [], () => CANCEL_RESULT),
    ...method('signOut', 'Delete the stored credential record.', 'signOut', [], () => SIGNOUT_RESULT),
  } as Record<string, never>,
}, z)
