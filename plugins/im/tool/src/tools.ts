/**
 * Model-facing `im_*` tools over the @veren/im router.
 *
 * Account authorization (`im_bind`) and conversation binding (`im_link`) are
 * separate tools on purpose: an authorization attempt must never guess a DSH
 * Session, and a binding must never start a QR flow. `im_send` always names its
 * target explicitly; it never falls back to the current active binding.
 *
 * 面向模型的 `im_*` 工具，作用于 @veren/im 路由。
 *
 * 账号授权（`im_bind`）与会话绑定（`im_link`）刻意分开：授权尝试绝不能猜 DSH Session，绑定也绝不
 * 发起扫码流程。`im_send` 永远显式指定 target，绝不回退到当前 active binding。
 *
 * @module @veren/im-tool/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ImError } from '@veren/im'
import type { ImBindRequest, ImRouter } from '@veren/im'
import {
  bindView, bindingView, fileContentOf, ok, requireString, run, settingsOf,
} from './values.ts'

/** One canonical tool value as model text. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const OUTPUT = { schema: { type: 'json' }, render: renderValue } as const

/** Build the method-specific bind request, rejecting missing credentials. */
function bindRequestOf(
  method: 'qrcode' | 'oauth' | 'token' | 'password',
  args: {
    token?: string
    username?: string
    password?: string
    label?: string
  },
): ImBindRequest {
  const label = args.label === undefined ? {} : { label: args.label }
  switch (method) {
    case 'qrcode':
    case 'oauth':
      return { method, ...label }
    case 'token':
      return { method, token: requireString(args.token, 'token'), ...label }
    case 'password':
      return {
        method,
        username: requireString(args.username, 'username'),
        password: requireString(args.password, 'password'),
        ...label,
      }
  }
}

/**
 * Register every IM tool in the mounting scope.
 * @param ctx - Context owning the `tools` registry.
 * @param router - the active-binding router.
 */
export function registerImTools(ctx: Context, router: ImRouter): void {
  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(defineTool({
        name: 'im_bind',
        description: 'Authorize an IM account. Start with method (qrcode, oauth, token, or password). '
          + 'QR flow returns bindId plus a local PNG path; poll later with bindId only. '
          + 'This never binds a conversation; use im_link for that.',
        parameters: {
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
        },
        output: OUTPUT,
        async execute(args) {
          return run(async () => {
            const hasBind = args.bindId !== undefined
            const hasMethod = args.method !== undefined
            if (hasBind === hasMethod) {
              throw new ImError('IM_INVALID_REQUEST', 'specify exactly one of method or bindId')
            }
            if (args.bindId !== undefined) {
              const polled = await router.pollBind(args.bindId)
              return bindView(polled.attempt, polled.account)
            }
            const provider = router.resolveProvider(args.provider)
            const attempt = await router.beginBind(
              provider.id,
              bindRequestOf(args.method as 'qrcode' | 'oauth' | 'token' | 'password', args),
            )
            return bindView(attempt)
          })
        },
      })),
      ctx.tools.register(defineTool({
        name: 'im_link',
        description: 'Bind or switch one IM conversation to a DSH Session. An active binding receives '
          + 'subsequent inbound messages; activating one turns the conversation\'s other bindings off. '
          + 'Omit sessionId to create a new Session. This never authorizes an account.',
        parameters: {
          accountId: { type: 'string', required: true, description: 'Authorized account id.' },
          conversationId: { type: 'string', required: true, description: 'Provider-scoped conversation id.' },
          sessionId: { type: 'string', description: 'Target Session; omit to create one.' },
          settings: { type: 'json', description: 'presetId, provider, model, reasoning.' },
          active: { type: 'boolean', description: 'Whether this binding receives inbound messages; default true.' },
        },
        output: OUTPUT,
        async execute(args) {
          return run(async () => {
            const binding = await router.link({
              accountId: requireString(args.accountId, 'accountId'),
              conversationId: requireString(args.conversationId, 'conversationId'),
              ...(args.sessionId === undefined ? {} : { sessionId: args.sessionId }),
              ...(args.settings === undefined ? {} : { settings: settingsOf(args.settings) }),
              ...(args.active === undefined ? {} : { active: args.active }),
            })
            return ok({ binding: bindingView(binding) })
          })
        },
      })),
      ctx.tools.register(defineTool({
        name: 'im_unbind',
        description: 'Remove one conversation binding, or remove an account entirely. Removing an account '
          + 'stops its runtime, deletes its credential, and deletes its bindings; remote revocation is '
          + 'reported honestly because not every provider supports it.',
        parameters: {
          bindingId: { type: 'string', description: 'Remove only this conversation binding.' },
          accountId: { type: 'string', description: 'Remove the account and all its bindings.' },
        },
        output: OUTPUT,
        async execute(args) {
          return run(async () => {
            if ((args.bindingId === undefined) === (args.accountId === undefined)) {
              throw new ImError('IM_INVALID_REQUEST', 'specify exactly one of bindingId or accountId')
            }
            if (args.bindingId !== undefined) {
              await router.unbindBinding(args.bindingId)
              return ok({ unbound: 'binding', bindingId: args.bindingId })
            }
            const accountId = requireString(args.accountId, 'accountId')
            return ok({ unbound: 'account', accountId, ...await router.unbindAccount(accountId) })
          })
        },
      })),
      ctx.tools.register(defineTool({
        name: 'im_send',
        description: 'Send one content block. Name exactly one target: person (id, exact nickname, real '
          + 'name, remark, contact, address, or a self-reported claimedName), bindingId, or accountId + '
          + 'conversationId. There is no implicit current conversation. With person, accountId/provider '
          + 'only narrow the address. The router sends only an exact, unique match; on IM_AMBIGUOUS or '
          + 'IM_NOT_FOUND it does NOT send. In that case show the candidates/suggestions and ask the user '
          + 'instead of guessing. A successful send returns recipient evidence (matchedBy/matchedValue '
          + 'plus identityStatus) to show the user: claimedName means the person called themselves that, '
          + 'not that the name was verified. Text is segmented by the provider limit; unsupported media '
          + 'fails with IM_UNSUPPORTED.',
        parameters: {
          person: {
            type: 'string',
            description: 'Recipient person: id, exact nickname, real name, alias/remark, contact, address, '
              + 'or an unverified claimedName. When matchedBy is claimedName, tell the user it is self-reported.',
          },
          provider: { type: 'string', description: 'With person: only this provider, for example wechat.' },
          bindingId: { type: 'string', description: 'Target binding.' },
          accountId: { type: 'string', description: 'Explicit target account, or a person address filter.' },
          conversationId: { type: 'string', description: 'Explicit target conversation.' },
          text: { type: 'string', description: 'Text to send.' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'One local file path; V1 WeChat rejects files.',
          },
          replyTo: { type: 'string', description: 'Message id to reply to.' },
        },
        output: OUTPUT,
        async execute(args) {
          return run(async () => {
            const files = args.files ?? []
            if ((args.text === undefined) === (files.length === 0)) {
              throw new ImError('IM_INVALID_REQUEST', 'specify exactly one of text or files')
            }
            if (files.length > 1) {
              throw new ImError('IM_UNSUPPORTED', 'only one file per send is supported')
            }
            const content = args.text !== undefined
              ? { type: 'text' as const, text: args.text }
              : await fileContentOf(requireString(files[0], 'files[0]'))
            const reply = args.replyTo === undefined ? {} : { replyToMessageId: args.replyTo }
            if (args.person !== undefined) {
              if (args.bindingId !== undefined || args.conversationId !== undefined) {
                throw new ImError(
                  'IM_INVALID_REQUEST',
                  'person cannot be combined with bindingId or conversationId; use accountId/provider to narrow it',
                )
              }
              const sent = await router.sendToPerson({
                person: requireString(args.person, 'person'),
                ...(args.provider === undefined ? {} : { provider: args.provider }),
                ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
                content,
                ...reply,
              })
              return ok({
                delivered: true,
                messageId: sent.result.id,
                sentAt: sent.result.sentAt,
                ...(sent.result.uncertain === undefined ? {} : { uncertain: sent.result.uncertain }),
                recipient: sent.recipient,
              })
            }
            if (args.provider !== undefined) {
              throw new ImError('IM_INVALID_REQUEST', 'provider is only valid together with person')
            }
            const result = await router.send({
              ...(args.bindingId === undefined ? {} : { bindingId: args.bindingId }),
              ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
              ...(args.conversationId === undefined ? {} : { conversationId: args.conversationId }),
              content,
              ...reply,
            })
            return ok({
              messageId: result.id,
              sentAt: result.sentAt,
              ...(result.uncertain === undefined ? {} : { uncertain: result.uncertain }),
            })
          })
        },
      })),
      ctx.tools.register(defineTool({
        name: 'im_settings',
        description: 'Change one binding\'s agent settings: presetId, provider, model, or reasoning. '
          + 'provider and model must be supplied together. Settings affect later turns only.',
        parameters: {
          bindingId: { type: 'string', required: true, description: 'Binding to update.' },
          presetId: { type: 'string', description: 'Agent preset id.' },
          provider: { type: 'string', description: 'Model provider route; pair with model.' },
          model: { type: 'string', description: 'Model id; pair with provider.' },
          reasoning: { type: 'string', description: 'Reasoning effort id.' },
        },
        output: OUTPUT,
        async execute(args) {
          return run(async () => {
            const binding = await router.settings(requireString(args.bindingId, 'bindingId'), {
              ...(args.presetId === undefined ? {} : { presetId: args.presetId }),
              ...(args.provider === undefined ? {} : { provider: args.provider }),
              ...(args.model === undefined ? {} : { model: args.model }),
              ...(args.reasoning === undefined ? {} : { reasoning: args.reasoning }),
            })
            return ok({ binding: bindingView(binding) })
          })
        },
      })),
      ctx.tools.register(defineTool({
        name: 'im_list',
        description: 'List IM accounts, bindings, or conversations without changing anything. Omit type '
          + 'to return all three.',
        parameters: {
          type: {
            type: 'string',
            enum: ['accounts', 'bindings', 'conversations'],
            description: 'Optional subset to list.',
          },
        },
        output: OUTPUT,
        async execute(args) {
          return run(async () => {
            const listed = await router.list(args.type)
            return ok({
              ...(listed.accounts === undefined ? {} : { accounts: listed.accounts }),
              ...(listed.bindings === undefined ? {} : { bindings: listed.bindings }),
              ...(listed.conversations === undefined ? {} : { conversations: listed.conversations }),
            })
          })
        },
      })),
    ]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'im:tools()')
}
