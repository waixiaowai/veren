/**
 * Account-removal segment of the router: revoke the remote grant when the
 * provider still can, drop the credential, the durable rows, and the person
 * addresses, and keep going when the provider itself is already gone.
 *
 * Two removal paths exist: the preferred per-account removal touches only that
 * account's runtime and files; the legacy fallback wraps the removal in one
 * full runtime stop/restart. Person profiles and names are never deleted —
 * they stay for a later rebind.
 *
 * 路由的账号删除段：provider 还在时先吊销远端授权，再删凭据、持久化行与人员地址；provider
 * 已不在时也要继续删干净。
 *
 * 两条删除路径：首选的单账号删除只触碰该账号的运行时与本地文件；兼容回退在删除前后整体
 * stop/restart 一次。人员档案与名字永不删除——保留给日后重新绑定。
 *
 * @module @veren/im/router-accounts
 */

import { ImError } from './contract.ts'
import type { ImProvider, ImRegistry } from './contract.ts'
import { ImBindings } from './bindings.ts'
import { errorMessage } from './runtime-seams.ts'
import type { ImCredentialStore, ImLogger } from './runtime-seams.ts'
import { clearPersonAddresses } from './router-inbound.ts'
import type { ImPeople } from './people.ts'
import type { ImUnbindAccountResult } from './router-types.ts'

/** Collaborators the removal needs; all owned by the router facade. */
export interface UnbindAccountDeps {
  bindings: ImBindings
  registry: ImRegistry
  credentials: ImCredentialStore
  people: ImPeople
  logger: ImLogger
}

/** Remove an account, its runtime state, credential, and rows. */
export async function unbindAccount(deps: UnbindAccountDeps, accountId: string): Promise<ImUnbindAccountResult> {
  const { bindings, registry, credentials, people, logger } = deps
  const account = bindings.account(accountId)
  if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${accountId}`)
  let provider: ImProvider | undefined
  let warning: string | undefined
  try {
    provider = registry.get(account.provider)
  } catch {
    warning = 'the provider is not registered, so the remote grant could not be revoked'
  }
  if (provider?.service.removeAccount !== undefined) {
    // Preferred path: only this account's runtime and files are touched.
    // 首选路径：只触碰该账号的运行时与本地文件，其他账号不受影响。
    try {
      await provider.service.removeAccount(accountId)
    } catch (error: unknown) {
      throw new ImError('IM_INTERNAL', `the provider could not remove the account: ${errorMessage(error)}`)
    }
  } else if (provider !== undefined) {
    // Legacy fallback: a full runtime stop/restart around the removal.
    // 兼容回退：删除前后整体 stop/restart 一次。
    try {
      await provider.service.stop()
    } catch (error: unknown) {
      warning = `the provider runtime did not stop cleanly: ${errorMessage(error)}`
    }
    await credentials.remove(accountId)
    await bindings.removeAccountRows(accountId)
    await clearPersonAddresses(people, logger, accountId)
    try {
      await provider.service.start()
    } catch (error: unknown) {
      throw new ImError('IM_INTERNAL', `account removed but the provider did not restart: ${errorMessage(error)}`)
    }
    return { removed: true, revoked: false, ...(warning === undefined ? {} : { warning }) }
  }
  await credentials.remove(accountId)
  await bindings.removeAccountRows(accountId)
  await clearPersonAddresses(people, logger, accountId)
  return { removed: true, revoked: false, ...(warning === undefined ? {} : { warning }) }
}
