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
import type { ImPeople } from './people.ts'
import type { ImUnbindAccountResult } from './router-types.ts'

/**
 * Remove one account's addresses; profiles and names stay for a later rebind.
 * 清掉一个账号的全部地址；档案与名字保留，供日后重新绑定。
 */
async function clearPersonAddresses(people: ImPeople, logger: ImLogger, accountId: string): Promise<void> {
  try {
    await people.removeAddressesOf(accountId)
  } catch (error: unknown) {
    logger.warn(`[im:people] addresses of ${accountId} were not removed: ${errorMessage(error)}`)
  }
}

/** Collaborators the removal needs; all owned by the router facade. */
export interface UnbindAccountDeps {
  bindings: ImBindings
  registry: ImRegistry
  credentials: ImCredentialStore
  people: ImPeople
  logger: ImLogger
}

/**
 * Resolve the account's provider; an unregistered provider only warns — the
 * local rows are still removed.
 * 解析账号的 provider；provider 未注册时只告警——本地行仍然删除。
 */
function providerOf(
  registry: ImRegistry,
  providerId: string,
): { provider: ImProvider | undefined; warning: string | undefined } {
  try {
    return { provider: registry.get(providerId), warning: undefined }
  } catch {
    return {
      provider: undefined,
      warning: 'the provider is not registered, so the remote grant could not be revoked',
    }
  }
}

/** Preferred path: revoke through the provider's own per-account removal. */
/** 首选路径：走 provider 自带的单账号删除来吊销。 */
async function revokeViaService(provider: ImProvider, accountId: string): Promise<void> {
  try {
    await provider.service.removeAccount!(accountId)
  } catch (error: unknown) {
    throw new ImError('IM_INTERNAL', `the provider could not remove the account: ${errorMessage(error)}`)
  }
}

/**
 * Legacy fallback: a full runtime stop/restart around the local removal.
 * 兼容回退：在本地删除前后整体 stop/restart 一次。
 */
async function removeWithRestart(
  deps: UnbindAccountDeps,
  provider: ImProvider,
  accountId: string,
  warning: string | undefined,
): Promise<ImUnbindAccountResult> {
  let stopped = warning
  try {
    await provider.service.stop()
  } catch (error: unknown) {
    stopped = `the provider runtime did not stop cleanly: ${errorMessage(error)}`
  }
  await removeLocalRows(deps, accountId)
  try {
    await provider.service.start()
  } catch (error: unknown) {
    throw new ImError('IM_INTERNAL', `account removed but the provider did not restart: ${errorMessage(error)}`)
  }
  return { removed: true, revoked: false, ...(stopped === undefined ? {} : { warning: stopped }) }
}

/** Drop the credential, the durable rows, and the person addresses. */
/** 删除凭据、持久化行与人员地址。 */
async function removeLocalRows(deps: UnbindAccountDeps, accountId: string): Promise<void> {
  await deps.credentials.remove(accountId)
  await deps.bindings.removeAccountRows(accountId)
  await clearPersonAddresses(deps.people, deps.logger, accountId)
}

/** Remove an account, its runtime state, credential, and rows. */
/** 删除一个账号及其运行时状态、凭据与行。 */
export async function unbindAccount(deps: UnbindAccountDeps, accountId: string): Promise<ImUnbindAccountResult> {
  const { bindings, registry } = deps
  const account = bindings.account(accountId)
  if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${accountId}`)
  const { provider, warning } = providerOf(registry, account.provider)
  if (provider?.service.removeAccount !== undefined) {
    // Preferred path: only this account's runtime and files are touched.
    // 首选路径：只触碰该账号的运行时与本地文件，其他账号不受影响。
    await revokeViaService(provider, accountId)
  } else if (provider !== undefined) {
    return removeWithRestart(deps, provider, accountId, warning)
  }
  await removeLocalRows(deps, accountId)
  return { removed: true, revoked: false, ...(warning === undefined ? {} : { warning }) }
}
