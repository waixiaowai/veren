/**
 * The account-removal tool: `im_unbind`.
 *
 * The queue-era `im_list` is gone: `im_rooms` and `im_people` cover its read
 * faces against the conversation domain and the directory.
 *
 * 账号移除工具：`im_unbind`。
 *
 * 队列时代的 `im_list` 已删除：它的读取面由 `im_rooms` 与 `im_people` 分别对会话域与目录
 * 覆盖。
 *
 * @module @veren/im-tool/session-tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { ImBindings, ImPeople, ImRegistry, unbindAccount } from '@veren/im'
import type { ImCredentialStore, ImLogger } from '@veren/im'
import { OUTPUT, ok, requireString, run } from './values.ts'

/** The collaborators account removal needs (all core services). */
/** 账号删除需要的协作者（全是核心服务）。 */
export interface UnbindDeps {
  readonly bindings: ImBindings
  readonly registry: ImRegistry
  readonly credentials: ImCredentialStore
  readonly people: ImPeople
  readonly logger: ImLogger
}

/**
 * Build the `im_unbind` tool: remove one account entirely.
 * @param deps - the collaborators unbindAccount needs.
 */
export function imUnbindTool(deps: UnbindDeps) {
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
        return ok({ unbound: 'account', accountId, ...await unbindAccount(deps, accountId) })
      })
    },
  })
}
