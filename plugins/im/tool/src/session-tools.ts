/**
 * The session-side tools: `im_link`, `im_unbind`, `im_settings`, `im_list`.
 *
 * All four are pure router reads/writes over bindings — no authorization, no
 * sending. `im_link` and `im_settings` return the binding view so the model
 * always sees the post-write state.
 *
 * 会话侧工具：`im_link`、`im_unbind`、`im_settings`、`im_list`。
 *
 * 四者都是对绑定的纯 router 读写——不授权、不发送。`im_link` 与 `im_settings` 返回绑定视图，
 * 模型看到的永远是写入之后的状态。
 *
 * @module @veren/im-tool/session-tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { ImError } from '@veren/im'
import type { ImRouter } from '@veren/im'
import { OUTPUT, bindingView, ok, requireString, run, settingsOf } from './values.ts'

/**
 * Build the `im_link` tool: bind or switch one conversation to one Session.
 * @param router - the active-binding router.
 */
export function imLinkTool(router: ImRouter) {
  return defineTool({
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
  })
}

/**
 * Build the `im_unbind` tool: remove one binding or a whole account.
 * @param router - the active-binding router.
 */
export function imUnbindTool(router: ImRouter) {
  return defineTool({
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
  })
}

/**
 * Build the `im_settings` tool: change one binding's agent settings.
 * @param router - the active-binding router.
 */
export function imSettingsTool(router: ImRouter) {
  return defineTool({
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
  })
}

/**
 * Build the `im_list` tool: read accounts, bindings, or conversations.
 * @param router - the active-binding router.
 */
export function imListTool(router: ImRouter) {
  return defineTool({
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
  })
}
