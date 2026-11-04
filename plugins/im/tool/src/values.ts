/**
 * Tool-boundary values: JSON projection, argument guards, and the failure
 * envelope every tool shares.
 *
 * Every tool returns one JSON object. Failures are values, not thrown errors:
 * `{ ok: false, error: { code, message } }`. The code is a stable error value
 * (`IM_*` or the core-loop codes) so a model can branch without parsing prose.
 *
 * 工具边界值：JSON 投影、参数守卫，以及所有工具共享的失败信封。
 *
 * 每个工具都返回一个 JSON 对象。失败是值而不是抛出的错误：
 * `{ ok: false, error: { code, message } }`。code 是稳定的错误值（`IM_*` 或核心循环码），
 * 模型无需解析自然语言即可分支。
 *
 * @module @veren/im-tool/values
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ImError } from '@veren/im'

/** Project one plain record onto lossless JSON. */
/** 把普通记录投影成无损 JSON。 */
export function jsonOf(value: Record<string, unknown>): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/** Wrap a successful payload. */
/** 包一层成功载荷。 */
export function ok(value: Record<string, unknown>): JsonValue {
  return jsonOf({ ok: true, ...value })
}

/** One canonical tool value as model text. */
/** 以模型文本呈现的标准工具值。 */
export function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** The shared output face: one JSON value as model text. */
/** 共享的输出面：一个 JSON 值作为模型文本。 */
export const OUTPUT = { schema: { type: 'json' }, render: renderValue } as const

/** Turn any failure into the stable failure result. */
/** 把任何失败转成稳定的失败结果。 */
export function fail(error: unknown): JsonValue {
  const code = error instanceof ImError ? error.code : 'IM_INTERNAL'
  const message = error instanceof ImError ? error.message : 'the IM operation failed'
  const details = error instanceof ImError ? error.details : undefined
  return jsonOf({
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details: { ...details } }),
    },
  })
}

/** Run one tool body, converting failures into the failure result. */
/** 运行一个工具主体，把失败转成失败结果。 */
export async function run(work: () => Promise<JsonValue>): Promise<JsonValue> {
  try {
    return await work()
  } catch (error: unknown) {
    return fail(error)
  }
}

/** Require a non-empty string argument. */
/** 要求一个非空字符串参数。 */
export function requireString(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === '') {
    throw new ImError('IM_INVALID_REQUEST', `${field} is required`)
  }
  return value
}

/** The structured refusal for a call made outside any im-managed session. */
/** 在任何 im 托管会话之外调用时的结构化拒绝。 */
export function outsideRoom(): JsonValue {
  return jsonOf({
    ok: false,
    error: {
      code: 'IM_NOT_FOUND',
      message: 'this session is not an IM room session; the im tools only operate inside '
        + 'IM-managed rooms, so there is nothing to send to or remember against here',
    },
  })
}

/** One excerpted line for listings: trimmed, length-capped. */
/** 列表用的一条摘录：去空白、限长。 */
export function excerptOf(text: string, maxChars: number): string {
  return text.slice(0, maxChars)
}

/** The authorization method arguments one bind start carries. */
/** 一次授权发起携带的方式参数。 */
type BindMethodArgs = {
  token?: string
  username?: string
  password?: string
  label?: string
}

/** Build one ImBindRequest from the tool arguments. */
/** 由工具参数构造一个 ImBindRequest。 */
export function bindRequestOf(
  method: 'qrcode' | 'oauth' | 'token' | 'password',
  args: BindMethodArgs,
): import('@veren/im').ImBindRequest {
  if (method === 'token') {
    return { method, token: requireString(args.token, 'token'), ...(args.label === undefined ? {} : { label: args.label }) }
  }
  if (method === 'password') {
    return {
      method,
      username: requireString(args.username, 'username'),
      password: requireString(args.password, 'password'),
      ...(args.label === undefined ? {} : { label: args.label }),
    }
  }
  return { method, ...(args.label === undefined ? {} : { label: args.label }) }
}

/** Project one authorization attempt (and its account, when bound) for the model. */
/** 把一次授权尝试（及绑定后的账号）投影给模型。 */
export function bindView(attempt: import('@veren/im').ImBindAttempt, account?: import('@veren/im').ImAccount): JsonValue {
  const challenge = attempt.challenge
  return jsonOf({
    bindId: attempt.bindId,
    status: attempt.status,
    ...(challenge?.imagePath === undefined ? {} : { qrImagePath: challenge.imagePath }),
    ...(challenge?.userCode === undefined ? {} : { userCode: challenge.userCode }),
    ...(challenge?.expiresAt === undefined ? {} : { expiresAt: challenge.expiresAt }),
    ...(account === undefined ? {} : { account }),
  })
}
