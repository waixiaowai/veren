/**
 * The session-side tools: `im_unbind` (accounts only) and `im_list`.
 *
 * Conversation bindings are gone (2.1.8): sessions are private to the queue
 * consumer, so there is nothing for the model to link or reconfigure. What
 * remains is account removal and the read-only listing.
 *
 * 会话侧工具：`im_unbind`（仅账号）与 `im_list`。
 *
 * 会话绑定已删除（2.1.8）：会话对队列消费者私有，模型没有可 link 或可改配置的对象。
 * 留下的是账号移除与只读列表。
 *
 * @module @veren/im-tool/session-tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ImRouter } from '@veren/im'
import { OUTPUT, ok, requireString, run } from './values.ts'

/**
 * Build the `im_unbind` tool: remove one account entirely.
 * @param router - the IM router.
 */
export function imUnbindTool(router: ImRouter) {
  return defineTool({
    name: 'im_unbind',
    description: 'Remove an IM account entirely: its runtime stops, its credential and rows are deleted. '
      + 'Remote revocation is reported honestly because not every provider supports it.',
    parameters: {
      accountId: { type: 'string', required: true, description: 'Account to remove.' },
    },
    output: OUTPUT,
    async execute(args) {
      return run(async () => {
        const accountId = requireString(args.accountId, 'accountId')
        return ok({ unbound: 'account', accountId, ...await router.unbindAccount(accountId) })
      })
    },
  })
}

/**
 * Build the `im_list` tool: read accounts or per-conversation queue state.
 * @param router - the IM router.
 */
export function imListTool(router: ImRouter) {
  return defineTool({
    name: 'im_list',
    description: 'List IM accounts or the per-conversation message-queue state without changing '
      + 'anything. Omit type to return both.',
    parameters: {
      type: {
        type: 'string',
        enum: ['accounts', 'conversations'],
        description: 'Optional subset to list.',
      },
    },
    output: OUTPUT,
    async execute(args) {
      return run(async () => {
        const listed = await router.list(args.type)
        return ok({
          ...(listed.accounts === undefined ? {} : { accounts: listed.accounts }),
          ...(listed.conversations === undefined ? {} : { conversations: listed.conversations }),
        })
      })
    },
  })
}
