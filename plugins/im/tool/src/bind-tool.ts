/**
 * The `im_bind` tool: start an account authorization or follow one up.
 *
 * Starting and polling are one tool because a bind attempt is a single
 * conversation-level job: method starts it, bindId follows it, and code answers
 * a needs-code challenge. It never touches conversation bindings — `im_link`
 * owns those.
 *
 * `im_bind` 工具：发起账号授权或跟进一次进行中的授权。
 *
 * 发起与轮询合用一个工具，因为授权尝试是会话层面的同一件事：method 发起、bindId 跟进、
 * code 回答 needs-code 挑战。它绝不触碰会话绑定——那是 `im_link` 的职责。
 *
 * @module @veren/im-tool/bind-tool
 */

import { defineTool, type InferArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ImError, ImRegistry, ImBindings } from '@veren/im'
import type { ImProvider } from '@veren/im'
import { OUTPUT, bindRequestOf, bindView, run } from './values.ts'

/** `im_bind` description: one authorization attempt, started or polled. */
/** `im_bind` 描述：一次授权尝试，发起或轮询。 */
const IM_BIND_DESCRIPTION = 'Authorize an IM account. Start with method (qrcode, oauth, token, or password). '
  + 'QR flow returns bindId plus a local PNG path; poll later with bindId only. '
  + 'When a poll reports status needs-code, resend with bindId plus the code the user read '
  + 'from their phone; any other poll needs bindId only. '
  + 'This never binds a conversation; use im_link for that.'

/** `im_bind` parameters. */
/** `im_bind` 参数。 */
const IM_BIND_PARAMETERS = {
  provider: { type: 'string', description: 'Provider id; omit when exactly one provider is registered.' },
  method: {
    type: 'string',
    enum: ['qrcode', 'oauth', 'token', 'password'],
    description: 'Authorization method; mutually exclusive with bindId.',
  },
  token: { type: 'string', description: 'Token credential for method=token.' },
  username: { type: 'string', description: 'Account name for method=password.' },
  password: { type: 'string', description: 'Password for method=password.' },
  label: { type: 'string', description: 'Display name for the new account.' },
  bindId: { type: 'string', description: 'Poll an existing attempt; mutually exclusive with method.' },
  code: {
    type: 'string',
    description: 'Verification code shown by the user\'s phone when the last poll returned '
      + 'needs-code; requires bindId.',
  },
} as const satisfies ParameterSchemaSpec

/** Inferred argument shape of the bind tool, derived from the schema. */
/** bind 工具的参数形状，由 schema 推导而来。 */
type BindArgs = InferArgs<typeof IM_BIND_PARAMETERS>

/** Poll an existing attempt, with the verify code when one is due. */
/** 轮询一次进行中的授权；到期需要验证码时一并提交。 */
async function pollBind(deps: BindDeps, args: BindArgs): Promise<JsonValue> {
  const polled = args.code === undefined
    ? await deps.bindings.pollBind(args.bindId as string)
    : await deps.bindings.submitBindCode(args.bindId as string, args.code)
  return bindView(polled.attempt, polled.account)
}

/** Start one authorization attempt with the requested method. */
/** 以指定方式发起一次授权尝试。 */
async function startBind(deps: BindDeps, args: BindArgs): Promise<JsonValue> {
  const provider = resolveProvider(deps.registry, args.provider)
  const attempt = await deps.bindings.beginBind(
    provider.id,
    bindRequestOf(args.method as 'qrcode' | 'oauth' | 'token' | 'password', args),
  )
  return bindView(attempt)
}

/** The `im_bind` execution: exactly one of method (start) or bindId (poll). */
/** `im_bind` 执行：method（发起）与 bindId（轮询）二选一。 */
function bindExecute(deps: BindDeps): (args: BindArgs) => Promise<JsonValue> {
  return async args => run(async () => {
    const hasBind = args.bindId !== undefined
    const hasMethod = args.method !== undefined
    if (hasBind === hasMethod) {
      throw new ImError('IM_INVALID_REQUEST', 'specify exactly one of method or bindId')
    }
    if (args.code !== undefined && !hasBind) {
      throw new ImError('IM_INVALID_REQUEST', 'code requires bindId')
    }
    if (hasBind) return pollBind(deps, args)
    return startBind(deps, args)
  })
}

/** The account-authorization collaborators the tool needs. */
/** 账号授权工具需要的协作者。 */
export interface BindDeps {
  readonly bindings: ImBindings
  readonly registry: ImRegistry
}

/**
 * Resolve an optional provider id, defaulting only when exactly one exists
 * (the same rule the old router applied).
 * 解析可选的 provider id；仅当恰好注册了一个 provider 时才允许缺省（与旧 router 同一规则）。
 */
function resolveProvider(registry: ImRegistry, id?: string): ImProvider {
  if (id !== undefined) return registry.get(id)
  const providers = registry.list()
  const first = providers[0]
  if (providers.length === 1 && first !== undefined) return first
  if (providers.length === 0) {
    throw new ImError('IM_NOT_FOUND', 'no IM provider is registered')
  }
  throw new ImError('IM_INVALID_REQUEST', 'provider is required when more than one provider is registered')
}

/**
 * Build the `im_bind` tool over the authorization faces.
 * @param deps - bindings and registry.
 */
export function imBindTool(deps: BindDeps) {
  return defineTool({
    name: 'im_bind',
    description: IM_BIND_DESCRIPTION,
    parameters: IM_BIND_PARAMETERS,
    output: OUTPUT,
    execute: bindExecute(deps),
  })
}
